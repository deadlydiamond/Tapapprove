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
    let model = AppModel()

    func applicationDidFinishLaunching() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self

        // Only someone able to unlock this watch can approve from it.
        let approve = UNNotificationAction(
            identifier: NotificationAnswer.approveAction,
            title: "Yes",
            options: .authenticationRequired
        )
        let session = UNNotificationAction(
            identifier: NotificationAnswer.sessionAction,
            title: "Yes, for this session",
            options: .authenticationRequired
        )
        let deny = UNNotificationAction(identifier: NotificationAnswer.denyAction, title: "No", options: .destructive)
        // Opens the app, where the answers wait after the end of the text.
        let review = UNNotificationAction(
            identifier: NotificationAnswer.reviewAction,
            title: "Read & Approve",
            options: .foreground
        )
        center.setNotificationCategories([
            // The computer picks a QUICK category only when the notification can show the whole
            // request, and the session one only when it can also show what that answer allows.
            UNNotificationCategory(identifier: SealedPreview.quickCategory, actions: [approve, deny], intentIdentifiers: []),
            UNNotificationCategory(
                identifier: SealedPreview.quickSessionCategory,
                actions: [approve, session, deny],
                intentIdentifiers: []
            ),
            UNNotificationCategory(identifier: SealedPreview.reviewCategory, actions: [review, deny], intentIdentifiers: []),
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
        let answer = NotificationAnswer.resolve(
            action: response.actionIdentifier,
            content: response.notification.request.content,
            keys: TokenStore.loadKeys(),
            shownFor: Date.now.timeIntervalSince(response.notification.date)
        )
        switch answer {
        case .send(let requestID, let answer): await model.decide(requestID: requestID, answer: answer)
        case .refuse: await model.refuseNotification()
        case .nothing: break
        }
    }
}
