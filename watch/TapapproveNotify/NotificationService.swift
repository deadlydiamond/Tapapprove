import Foundation
import UserNotifications

/// Replaces the relay's generic text with the real request, which only this watch can open.
/// If it does not open, whatever the relay wrote is replaced as well, and the notification only
/// offers opening the app or No.
final class NotificationService: UNNotificationServiceExtension {
    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        guard let content = request.content.mutableCopy() as? UNMutableNotificationContent else {
            contentHandler(request.content)
            return
        }
        if let keys = TokenStore.loadKeys(), let preview = SealedPreview.open(userInfo: request.content.userInfo, keys: keys) {
            content.title = preview.title
            content.subtitle = preview.subtitle ?? ""
            content.body = preview.body
            content.categoryIdentifier = preview.category
        } else {
            content.title = "Tapapprove"
            content.subtitle = ""
            content.body = "A request is waiting."
            content.categoryIdentifier = SealedPreview.reviewCategory
        }
        contentHandler(content)
    }
}
