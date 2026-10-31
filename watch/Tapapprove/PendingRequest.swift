import Foundation

/// What the computer sealed for the watch. The relay cannot read any of this.
struct SealedRequest: Decodable, Sendable {
    let tool: String
    let title: String
    let detail: String
    let project: String?
    let options: [String]?
}

struct PendingRequest: Identifiable, Equatable {
    /// The computer puts this line first when a command leaves the sandbox.
    static let sandboxWarning = "Runs outside the sandbox"
    private static let maxPieceLength = 400

    let id: String
    let tool: String
    let title: String
    let detail: String
    let project: String?
    let expiresAt: Date
    let sessionOptions: [String]

    private static let sampleID = "sample"

    /// Real requests have UUIDs, so nothing the computer sends can pass for this.
    var isSample: Bool { id == Self.sampleID }

    /// Shows how a request works without a computer, for anyone trying the app first.
    static func sample(now: Date = .now) -> PendingRequest {
        PendingRequest(
            id: sampleID,
            tool: "Bash",
            title: "Run command",
            detail: "git push origin main",
            project: nil,
            expiresAt: now.addingTimeInterval(90),
            sessionOptions: ["Yes, allow git push for this session"]
        )
    }

    var symbolName: String {
        switch tool {
        case "Bash": "terminal.fill"
        case "Edit", "MultiEdit", "NotebookEdit": "pencil"
        case "Write": "square.and.pencil"
        case "WebFetch": "globe"
        case "WebSearch": "magnifyingglass"
        case "Task", "Agent": "person.2.fill"
        default: tool.hasPrefix("mcp__") ? "puzzlepiece.extension.fill" : "hand.raised.fill"
        }
    }

    /// One huge Text is too much for a watch to lay out, so a long request renders in pieces.
    var detailPieces: [String] {
        var pieces: [String] = []
        for line in detail.split(separator: "\n", omittingEmptySubsequences: false) {
            var rest = line
            repeat {
                pieces.append(rest.isEmpty ? " " : String(rest.prefix(Self.maxPieceLength)))
                rest = rest.dropFirst(Self.maxPieceLength)
            } while !rest.isEmpty
        }
        return pieces
    }
}
