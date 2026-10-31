import Foundation
import UserNotifications

/// What the computer sealed for a request's notification. The relay can neither read nor make one.
struct SealedPreview: Decodable, Equatable, Sendable {
    static let quickCategory = "TAPAPPROVE_QUICK"
    static let quickSessionCategory = "TAPAPPROVE_QUICK_SESSION"
    static let reviewCategory = "TAPAPPROVE_REVIEW"

    let title: String
    let subtitle: String?
    let body: String
    let category: String

    /// `nil` unless the push carries a preview sealed for the very request it points at.
    static func open(userInfo: [AnyHashable: Any], keys: ChannelKeys) -> SealedPreview? {
        guard let requestID = userInfo["requestId"] as? String,
              let sealed = userInfo["preview"] as? String,
              let opened = try? ChannelCrypto.open(sealed, key: keys.requestKey, label: "preview:\(requestID)")
        else { return nil }
        return try? JSONDecoder().decode(SealedPreview.self, from: opened)
    }

    /// Whether a notification shows this and nothing else. A real preview can travel beside text
    /// the relay wrote, so opening one says nothing about what the person is looking at.
    func isShown(by content: UNNotificationContent) -> Bool {
        content.title == title
            && content.subtitle == (subtitle ?? "")
            && content.body == body
            && content.categoryIdentifier == category
    }
}
