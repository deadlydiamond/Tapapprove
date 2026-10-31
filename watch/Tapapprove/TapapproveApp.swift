import SwiftUI
import UserNotifications
import WatchKit

@main
struct TapapproveApp: App {
    @WKApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    var body: some Scene {
        WindowGroup {
            RootView(model: delegate.model)
        }
    }
}

@MainActor
final class AppDelegate: NSObject, WKApplicationDelegate, UNUserNotificationCenterDelegate {
    private static let approveAction = "APPROVE"
    private static let denyAction = "DENY"
    private static let reviewAction = "REVIEW"
    private static let sessionAction = "ALLOW_SESSION"

    let model = AppModel()

    func applicationDidFinishLaunching() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self

        let approve = UNNotificationAction(identifier: Self.approveAction, title: "Yes")
        let session = UNNotificationAction(identifier: Self.sessionAction, title: "Yes, for this session")
        let deny = UNNotificationAction(identifier: Self.denyAction, title: "No", options: .destructive)
        // Opens the app, where the answers wait after the end of the text.
        let review = UNNotificationAction(identifier: Self.reviewAction, title: "Read & Approve", options: .foreground)
        center.setNotificationCategories([
            // The relay picks a QUICK category only when the notification can show the whole
            // request, and the session one only when it can also show what that answer allows.
            UNNotificationCategory(identifier: "TAPAPPROVE_QUICK", actions: [approve, deny], intentIdentifiers: []),
            UNNotificationCategory(
                identifier: "TAPAPPROVE_QUICK_SESSION",
                actions: [approve, session, deny],
                intentIdentifiers: []
            ),
            UNNotificationCategory(identifier: "TAPAPPROVE_REVIEW", actions: [review, deny], intentIdentifiers: []),
        ])
    }

    func didRegisterForRemoteNotifications(withDeviceToken deviceToken: Data) {
        model.didReceive(apnsToken: deviceToken.map { String(format: "%02x", $0) }.joined())
    }

    func didFailToRegisterForRemoteNotificationsWithError(_ error: any Error) {
        // Without push the app still works while open, and the CLI reports the request as not pushed.
        print("Push registration failed: \(error.localizedDescription)")
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        // The open app shows the request itself and plays its own haptic.
        []
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let action = response.actionIdentifier
        guard let requestID = response.notification.request.content.userInfo["requestId"] as? String else { return }
        let answer: Answer
        switch action {
        case Self.approveAction: answer = Answer(decision: .allow)
        case Self.sessionAction: answer = Answer(decision: .allow, option: 0)
        case Self.denyAction: answer = Answer(decision: .deny)
        default: return
        }
        await model.decide(requestID: requestID, answer: answer)
    }
}
