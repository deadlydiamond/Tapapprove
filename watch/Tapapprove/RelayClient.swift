import Foundation

enum Decision: String, Codable, Sendable {
    case allow
    case deny
}

/// An answer to a request. `option` picks a "for this session" answer, and `message` says
/// what to do instead of a denied request.
struct Answer: Encodable, Equatable, Sendable {
    let decision: Decision
    var option: Int?
    var message: String?
}

enum RelayError: Error {
    /// The token is no longer valid, so the pairing was revoked.
    case unauthorized
    /// The request ended before this decision arrived.
    case alreadyClosed
    case http(Int)
}

struct PairingStart: Decodable, Sendable {
    let code: String
    let watchToken: String
    let expiresIn: Double
}

struct RelayStatus: Decodable, Sendable {
    let paired: Bool
    let peerName: String?
}

struct ApprovalRequest: Decodable, Sendable {
    let id: String
    let tool: String
    let title: String
    let detail: String
    let project: String?
    let expiresAt: Double
    let truncated: Bool
    let options: [String]?
}

struct PendingList: Decodable, Sendable {
    let requests: [ApprovalRequest]
    let serverTime: Double
}

struct RelayClient: Sendable {
    var baseURL = Config.relayURL
    var token: String?

    func startPairing(name: String) async throws -> PairingStart {
        try await send("POST", "/v1/pair/start", body: ["name": name])
    }

    func status() async throws -> RelayStatus {
        try await send("GET", "/v1/status")
    }

    func pending() async throws -> PendingList {
        try await send("GET", "/v1/requests")
    }

    func decide(requestID: String, answer: Answer) async throws {
        let _: Empty = try await send("POST", "/v1/requests/\(requestID)/decision", body: answer)
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

        let (data, response) = try await URLSession.shared.data(for: request)
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
