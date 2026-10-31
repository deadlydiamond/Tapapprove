/// The brief confirmation shown after answering a request.
struct Outcome: Equatable {
    let answer: Answer
    var isSending = true

    var title: String {
        switch answer.decision {
        case .allow: answer.option == nil ? "Approved" : "Approved for this session"
        case .deny: answer.message == nil ? "Denied" : "Sent to Claude"
        }
    }

    var symbolName: String {
        switch answer.decision {
        case .allow: "checkmark.circle.fill"
        case .deny: answer.message == nil ? "xmark.circle.fill" : "arrow.up.circle.fill"
        }
    }
}
