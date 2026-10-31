import CryptoKit
import Foundation
import Observation
import UserNotifications
import WatchKit

@MainActor
@Observable
final class AppModel {
    enum Phase: Equatable {
        case loading
        case pairing(code: String, expiresAt: Date)
        case pairingFailed
        case paired
    }

    private(set) var phase: Phase = .loading
    private(set) var requests: [PendingRequest] = []
    private(set) var isOffline = false
    private(set) var notice: String?
    private(set) var outcome: Outcome?
    private(set) var sample: PendingRequest?

    /// Held in memory until the computer claims the code, so an abandoned pairing leaves nothing behind.
    private var pairingToken: String?
    private var pairingSecret: String?
    private var pairingKey: Curve25519.KeyAgreement.PrivateKey?
    /// Requests already opened, so polling does not decrypt a long one again every time.
    private var opened: [String: SealedRequest] = [:]
    private var apnsToken: String?
    private var inFlight: Set<String> = []

    init() {
        if Config.isUITest { TokenStore.delete() }
    }

    /// Polls for as long as the calling task lives. The view ties that to the app being active.
    func run() async {
        while !Task.isCancelled {
            await tick()
            try? await Task.sleep(for: Config.pollInterval)
        }
    }

    func retryPairing() {
        phase = .loading
    }

    func showSample() {
        sample = .sample()
    }

    func answerSample(_ answer: Answer) async {
        sample = nil
        outcome = Outcome(answer: answer, isSending: false)
        WKInterfaceDevice.current().play(answer.decision == .allow ? .success : .failure)
        try? await Task.sleep(for: Config.outcomeDuration)
        outcome = nil
    }

    /// A Yes on a notification that could not be trusted. Whatever it claimed to be, the real
    /// request is still waiting here and on the computer.
    func refuseNotification() {
        WKInterfaceDevice.current().play(.failure)
        show(notice: "Could not verify that notification, so nothing was sent.")
    }

    func decide(requestID: String, answer: Answer) async {
        guard ChannelCrypto.isRequestID(requestID),
              let token = TokenStore.load(),
              let keys = TokenStore.loadKeys(),
              inFlight.insert(requestID).inserted
        else { return }
        defer { inFlight.remove(requestID) }
        requests.removeAll { $0.id == requestID }
        outcome = Outcome(answer: answer)
        do {
            let signed = try Self.sign(answer, requestID: requestID, keys: keys)
            try await RelayClient(token: token).decide(requestID: requestID, answer: signed)
            outcome?.isSending = false
            WKInterfaceDevice.current().play(answer.decision == .allow ? .success : .failure)
            try? await Task.sleep(for: Config.outcomeDuration)
            outcome = nil
        } catch RelayError.alreadyClosed {
            outcome = nil
            show(notice: "That request already ended.")
        } catch {
            // The request stays open on the relay, so the next poll brings it back.
            outcome = nil
            show(notice: "Could not send that. Try again.")
        }
    }

    private static func sign(_ answer: Answer, requestID: String, keys: ChannelKeys) throws -> SignedAnswer {
        let sealedMessage = try answer.message.map {
            try ChannelCrypto.seal(ChannelCrypto.padded(message: $0), key: keys.answerKey, label: "msg:\(requestID)")
        }
        return SignedAnswer(
            decision: answer.decision,
            option: answer.option,
            proof: ChannelCrypto.proof(
                proofKey: keys.proofKey,
                requestID: requestID,
                decision: answer.decision,
                option: answer.option,
                sealedMessage: sealedMessage
            ),
            sealedMessage: sealedMessage
        )
    }

    func unpair() async {
        guard let token = TokenStore.load() else { return }
        try? await RelayClient(token: token).unpair()
        forgetPairing()
    }

    func didReceive(apnsToken: String) {
        self.apnsToken = apnsToken
        Task { await registerDevice() }
    }

    // MARK: - Polling

    private func tick() async {
        if let token = TokenStore.load() {
            await refresh(token: token)
            return
        }
        switch phase {
        case .pairing(_, let expiresAt) where Date() < expiresAt:
            await checkPairingClaimed()
        case .pairingFailed:
            break
        default:
            await startPairing()
        }
    }

    private func startPairing() async {
        do {
            let start = try await RelayClient().startPairing()
            guard start.isWellFormed else {
                pairingToken = nil
                phase = .pairingFailed
                return
            }
            let secret = ChannelCrypto.randomSecret()
            pairingToken = start.watchToken
            pairingSecret = secret
            pairingKey = Curve25519.KeyAgreement.PrivateKey()
            // Only the first part ever reached the relay. The rest stays on this screen.
            phase = .pairing(
                code: ChannelCrypto.pairingCode(lookup: start.code, secret: secret),
                expiresAt: Date().addingTimeInterval(start.expiresIn)
            )
        } catch {
            pairingToken = nil
            phase = .pairingFailed
        }
    }

    private func checkPairingClaimed() async {
        guard let token = pairingToken, let secret = pairingSecret, let privateKey = pairingKey else {
            phase = .loading
            return
        }
        let client = RelayClient(token: token)
        do {
            let status = try await client.status()
            guard status.paired, let peerKey = status.peerKey else { return }
            let keys = try await finishKeyExchange(client: client, secret: secret, peerKey: peerKey, privateKey: privateKey)
            TokenStore.save(token: token, keys: keys)
            forgetPairingAttempt()
            phase = .paired
            await setUpPush()
        } catch RelayError.unauthorized {
            forgetPairingAttempt()
            phase = .loading
        } catch is ChannelCryptoError {
            // Whoever claimed the code does not know all of it, so this pairing is over.
            try? await client.unpair()
            forgetPairingAttempt()
            phase = .pairingFailed
        } catch {
            // A blip while waiting. The code is still good, so keep showing it.
        }
    }

    private func finishKeyExchange(
        client: RelayClient,
        secret: String,
        peerKey: PairKey,
        privateKey: Curve25519.KeyAgreement.PrivateKey
    ) async throws -> ChannelKeys {
        guard let cliPublicKey = Data(base64Encoded: peerKey.publicKey),
              let tag = Data(base64Encoded: peerKey.tag)
        else { throw ChannelCryptoError.badKey }
        let tagKey = try ChannelCrypto.tagKey(secret: secret)
        guard ChannelCrypto.verifyCLITag(tag, tagKey: tagKey, cliPublicKey: cliPublicKey) else {
            throw ChannelCryptoError.badTag
        }
        let keys = try ChannelCrypto.deriveKeys(tagKey: tagKey, cliPublicKey: cliPublicKey, privateKey: privateKey)
        let publicKey = privateKey.publicKey.rawRepresentation
        let watchTag = ChannelCrypto.watchTag(tagKey: tagKey, cliPublicKey: cliPublicKey, watchPublicKey: publicKey)
        do {
            try await client.publishKey(PairKey(publicKey: publicKey.base64EncodedString(), tag: watchTag.base64EncodedString()))
        } catch RelayError.alreadyClosed {
            // A retry after a lost response. The relay already holds this same key.
        }
        return keys
    }

    private func forgetPairingAttempt() {
        pairingToken = nil
        pairingSecret = nil
        pairingKey = nil
    }

    private func refresh(token: String) async {
        let client = RelayClient(token: token)
        // A pairing from before encryption has no keys, so it has to start again.
        guard let keys = TokenStore.loadKeys() else {
            try? await client.unpair()
            forgetPairing()
            return
        }
        do {
            if phase != .paired {
                phase = .paired
                await setUpPush()
            }
            let list = try await client.pending()
            isOffline = false
            apply(list, keys: keys)
        } catch RelayError.unauthorized {
            forgetPairing()
        } catch {
            isOffline = true
        }
    }

    private func apply(_ list: PendingList, keys: ChannelKeys) {
        let now = Date()
        let known = Set(requests.map(\.id))
        // Text that does not open did not come from the computer, so it is never shown.
        let fresh = list.requests
            .filter { !inFlight.contains($0.id) }
            .compactMap { request -> PendingRequest? in
                guard let sealed = open(request, keys: keys) else { return nil }
                return PendingRequest(
                    id: request.id,
                    tool: sealed.tool,
                    title: sealed.title,
                    detail: sealed.detail,
                    project: sealed.project,
                    // Count down from the relay's clock, so a skewed watch clock cannot mislead.
                    expiresAt: now.addingTimeInterval((request.expiresAt - list.serverTime) / 1000),
                    sessionOptions: sealed.options ?? []
                )
            }
        opened = opened.filter { entry in list.requests.contains { $0.id == entry.key } }
        if fresh.contains(where: { !known.contains($0.id) }) {
            WKInterfaceDevice.current().play(.notification)
        }
        requests = fresh
    }

    private func open(_ request: ApprovalRequest, keys: ChannelKeys) -> SealedRequest? {
        if let cached = opened[request.id] { return cached }
        guard let data = try? ChannelCrypto.open(request.sealed, key: keys.requestKey, label: "req:\(request.id)"),
              let sealed = try? JSONDecoder().decode(SealedRequest.self, from: data)
        else { return nil }
        opened[request.id] = sealed
        return sealed
    }

    private func forgetPairing() {
        TokenStore.delete()
        requests = []
        opened = [:]
        phase = .loading
    }

    private func show(notice text: String) {
        notice = text
        Task {
            try? await Task.sleep(for: .seconds(3))
            if notice == text { notice = nil }
        }
    }

    // MARK: - Push

    private func setUpPush() async {
        guard !Config.isUITest else { return }
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
        WKApplication.shared().registerForRemoteNotifications()
        await registerDevice()
    }

    private func registerDevice() async {
        guard let apnsToken, let token = TokenStore.load() else { return }
        try? await RelayClient(token: token).registerDevice(apnsToken: apnsToken, environment: Config.apnsEnvironment)
    }
}
