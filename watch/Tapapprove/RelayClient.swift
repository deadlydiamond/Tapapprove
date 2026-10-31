import Foundation

/// An answer to a request. `option` picks a "for this session" answer, and `message` says
/// what to do instead of a denied request.
struct Answer: Equatable, Sendable {
    let decision: Decision
    var option: Int?
    var message: String?
}

/// What the relay carries back to the computer, which checks the proof before believing it.
struct SignedAnswer: Encodable, Sendable {
    let decision: Decision
    let option: Int?
    let proof: String
    let sealedMessage: String?
}

/// One side of the key exchange, as the relay carries it.
struct PairKey: Codable, Sendable {
    let publicKey: String
    let tag: String
}

enum RelayError: Error {
    /// The token is no longer valid, so the pairing was revoked.
    case unauthorized
    /// The request ended before this decision arrived.
    case alreadyClosed
    case http(Int)
}

struct PairingStart: Decodable, Sendable {
    private static let longestWait: Double = 600

    let code: String
    let watchToken: String
    let expiresIn: Double

    /// The watch shows `code` for the person to type into a terminal, so the relay must not be
    /// able to put anything there but the four characters it is for. Any more could turn what
    /// they type into a different command, or send the secret part of the code to the relay.
    var isWellFormed: Bool {
        code.wholeMatch(of: /[A-HJ-NP-Z2-9]{4}/) != nil && expiresIn > 0 && expiresIn <= Self.longestWait
    }
}

struct RelayStatus: Decodable, Sendable {
    let paired: Bool
    let peerKey: PairKey?
}

struct ApprovalRequest: Decodable, Sendable {
    let id: String
    let sealed: String
    let expiresAt: Double
}

struct PendingList: Decodable, Sendable {
    let requests: [ApprovalRequest]
    let serverTime: Double
}

/// Requests are for the relay alone, so a hacked relay must not be able to aim them elsewhere.
private final class RefuseRedirects: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest
    ) async -> URLRequest? {
        nil
    }
}

struct RelayClient: Sendable {
    var baseURL = Config.relayURL
    var token: String?

    func startPairing() async throws -> PairingStart {
        try await send("POST", "/v1/pair/start")
    }

    func status() async throws -> RelayStatus {
        try await send("GET", "/v1/status")
    }

    func pending() async throws -> PendingList {
        try await send("GET", "/v1/requests")
    }

    func decide(requestID: String, answer: SignedAnswer) async throws {
        let _: Empty = try await send("POST", "/v1/requests/\(requestID)/decision", body: answer)
    }

    func publishKey(_ key: PairKey) async throws {
        let _: Empty = try await send("PUT", "/v1/pair/key", body: key)
    }

    func registerDevice(apnsToken: String, environment: String) async throws {
        let _: Empty = try await send("PUT", "/v1/device", body: ["apnsToken": apnsToken, "env": environment])
    }

    func unpair() async throws {
        let _: Empty = try await send("DELETE", "/v1/pair")
    }

    private struct Empty: Decodable {}

    private func send<Response: Decodable>(
        _ method: String,
        _ path: String,
        body: (any Encodable)? = nil
    ) async throws -> Response {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = method
        request.timeoutInterval = 15
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }

        let (data, response) = try await URLSession.shared.data(for: request, delegate: RefuseRedirects())
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        switch status {
        case 200..<300:
            return try JSONDecoder().decode(Response.self, from: data)
        case 401:
            throw RelayError.unauthorized
        case 409:
            throw RelayError.alreadyClosed
        default:
            throw RelayError.http(status)
        }
    }
}
