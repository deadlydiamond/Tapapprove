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

    let model = AppModel()

    func applicationDidFinishLaunching() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self

        let approve = UNNotificationAction(identifier: Self.approveAction, title: "Approve")
        let deny = UNNotificationAction(identifier: Self.denyAction, title: "Deny", options: .destructive)
        center.setNotificationCategories([
            // The relay picks QUICK only when the notification can show the whole request.
            UNNotificationCategory(identifier: "TAPAPPROVE_QUICK", actions: [approve, deny], intentIdentifiers: []),
            UNNotificationCategory(identifier: "TAPAPPROVE_REVIEW", actions: [deny], intentIdentifiers: []),
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
        let decision: Decision
        switch action {
        case Self.approveAction: decision = .allow
        case Self.denyAction: decision = .deny
        default: return
        }
        await model.decide(requestID: requestID, decision: decision)
    }
}
