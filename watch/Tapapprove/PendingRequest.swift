import Foundation

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
    let isTruncated: Bool
    let sessionOptions: [String]

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
