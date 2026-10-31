import CommonCrypto
import CryptoKit
import Foundation

/// The keys shared with the computer. The relay never sees them.
struct ChannelKeys: Codable, Sendable {
    let requestKey: Data
    let answerKey: Data
    let proofKey: Data
}

enum ChannelCryptoError: Error {
    case badKey
    case badTag
    case badText
}

/// End-to-end protection between the watch and the computer. The relay only ever carries
/// sealed text, and it cannot make an approval: every answer carries a proof only this watch
/// can make. `cli/lib/e2e.mjs` mirrors this file, byte for byte.
enum ChannelCrypto {
    private static let secretAlphabet = Array("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")
    // 16 characters of 32 kinds is 80 bits. During a pairing a hacked relay holds a value it can
    // test guesses against offline, so this has to be out of reach of any amount of guessing.
    private static let secretLength = 16
    private static let pbkdf2Rounds: UInt32 = 100_000
    // The relay sees how long sealed text is, so a message's size comes in steps.
    private static let messageStep = 256

    /// The part of the pairing code the relay never sees.
    static func randomSecret() -> String {
        String((0..<secretLength).map { _ in secretAlphabet.randomElement()! })
    }

    /// The code the person types: the relay's part, then the part only these devices know.
    static func pairingCode(lookup: String, secret: String) -> String {
        let groups = stride(from: 0, to: secret.count, by: 4).map { start in
            String(secret.dropFirst(start).prefix(4))
        }
        return ([lookup] + groups).joined(separator: "-")
    }

    /// Every request ID is a UUID the computer made. The fields of a proof are joined into one
    /// text, so a made-up ID holding a line break could make a No prove something else.
    static func isRequestID(_ id: String) -> Bool {
        id.wholeMatch(of: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/) != nil
    }

    /// The computer trims these spaces, which mean nothing at the end of a message.
    static func padded(message: String) -> String {
        let extra = (messageStep - message.utf8.count % messageStep) % messageStep
        return message + String(repeating: " ", count: extra)
    }

    static func tagKey(secret: String) throws -> Data {
        var output = Data(count: 32)
        let salt = Array("tapapprove-pair-v1".utf8)
        let password = Array(secret.utf8)
        let status = output.withUnsafeMutableBytes { bytes in
            CCKeyDerivationPBKDF(
                CCPBKDFAlgorithm(kCCPBKDF2),
                password.map { CChar(bitPattern: $0) },
                password.count,
                salt,
                salt.count,
                CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
                pbkdf2Rounds,
                bytes.bindMemory(to: UInt8.self).baseAddress,
                32
            )
        }
        // All zeros would be a key the relay could work out for itself.
        guard status == kCCSuccess else { throw ChannelCryptoError.badKey }
        return output
    }

    private static func hmac(key: Data, _ parts: Data...) -> Data {
        var mac = HMAC<SHA256>(key: SymmetricKey(data: key))
        for part in parts { mac.update(data: part) }
        return Data(mac.finalize())
    }

    /// Checks that the computer typed the whole code, for exactly this public key.
    static func verifyCLITag(_ tag: Data, tagKey: Data, cliPublicKey: Data) -> Bool {
        HMAC<SHA256>.isValidAuthenticationCode(
            tag,
            authenticating: Data("cli".utf8) + cliPublicKey,
            using: SymmetricKey(data: tagKey)
        )
    }

    static func watchTag(tagKey: Data, cliPublicKey: Data, watchPublicKey: Data) -> Data {
        hmac(key: tagKey, Data("watch".utf8), watchPublicKey, cliPublicKey)
    }

    static func deriveKeys(
        tagKey: Data,
        cliPublicKey: Data,
        privateKey: Curve25519.KeyAgreement.PrivateKey
    ) throws -> ChannelKeys {
        let peer = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: cliPublicKey)
        let shared = try privateKey.sharedSecretFromKeyAgreement(with: peer)
        let info = Data("tapapprove-v1".utf8) + cliPublicKey + privateKey.publicKey.rawRepresentation
        let derived = shared.withUnsafeBytes { secret in
            HKDF<SHA256>.deriveKey(
                inputKeyMaterial: SymmetricKey(data: Data(secret)),
                salt: tagKey,
                info: info,
                outputByteCount: 96
            )
        }
        let bytes = derived.withUnsafeBytes { Data($0) }
        return ChannelKeys(
            requestKey: bytes.subdata(in: 0..<32),
            answerKey: bytes.subdata(in: 32..<64),
            proofKey: bytes.subdata(in: 64..<96)
        )
    }

    /// `label` ties the text to one request, so the relay cannot move it to another.
    static func seal(_ text: String, key: Data, label: String) throws -> String {
        let box = try AES.GCM.seal(Data(text.utf8), using: SymmetricKey(data: key), authenticating: Data(label.utf8))
        guard let combined = box.combined else { throw ChannelCryptoError.badText }
        return combined.base64EncodedString()
    }

    static func open(_ sealed: String, key: Data, label: String) throws -> Data {
        guard let bytes = Data(base64Encoded: sealed) else { throw ChannelCryptoError.badText }
        let box = try AES.GCM.SealedBox(combined: bytes)
        return try AES.GCM.open(box, using: SymmetricKey(data: key), authenticating: Data(label.utf8))
    }

    static func proof(proofKey: Data, requestID: String, decision: Decision, option: Int?, sealedMessage: String?) -> String {
        let option = option.map(String.init) ?? ""
        let text = "decision\n\(requestID)\n\(decision.rawValue)\n\(option)\n\(sealedMessage ?? "")"
        return hmac(key: proofKey, Data(text.utf8)).base64EncodedString()
    }
}
