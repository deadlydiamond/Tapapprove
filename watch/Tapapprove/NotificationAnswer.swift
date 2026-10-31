import UserNotifications

/// What a tap on a notification may do. The relay decides what a push looks like and which
/// request it points at, so a Yes only counts when the notification shows exactly what the
/// computer sealed for that request, and has been up long enough to be what the finger aimed at.
/// A No needs less, since the relay can drop a request anyway.
enum NotificationAnswer: Equatable {
    case send(requestID: String, Answer)
    /// A Yes that cannot be trusted. Nothing is sent, and the person should know.
    case refuse
    case nothing

    static let approveAction = "APPROVE"
    static let sessionAction = "ALLOW_SESSION"
    static let denyAction = "DENY"
    static let reviewAction = "REVIEW"

    static func resolve(
        action: String,
        content: UNNotificationContent,
        keys: ChannelKeys?,
        shownFor: TimeInterval
    ) -> NotificationAnswer {
        // The relay could replace a notification just as the person taps it.
        guard action == denyAction || shownFor >= Config.armInterval else {
            return action == approveAction || action == sessionAction ? .refuse : .nothing
        }
        let requestID = (content.userInfo["requestId"] as? String).flatMap { ChannelCrypto.isRequestID($0) ? $0 : nil }
        switch action {
        case denyAction:
            return requestID.map { .send(requestID: $0, Answer(decision: .deny)) } ?? .nothing
        case approveAction:
            return allow(
                Answer(decision: .allow),
                requestID: requestID,
                content: content,
                keys: keys,
                categories: [SealedPreview.quickCategory, SealedPreview.quickSessionCategory]
            )
        case sessionAction:
            return allow(
                Answer(decision: .allow, option: 0),
                requestID: requestID,
                content: content,
                keys: keys,
                categories: [SealedPreview.quickSessionCategory]
            )
        default:
            return .nothing
        }
    }

    private static func allow(
        _ answer: Answer,
        requestID: String?,
        content: UNNotificationContent,
        keys: ChannelKeys?,
        categories: Set<String>
    ) -> NotificationAnswer {
        guard let requestID, let keys,
              let preview = SealedPreview.open(userInfo: content.userInfo, keys: keys),
              preview.isShown(by: content),
              categories.contains(preview.category)
        else { return .refuse }
        return .send(requestID: requestID, answer)
    }
}
