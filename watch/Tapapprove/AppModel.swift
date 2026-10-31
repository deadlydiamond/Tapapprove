import Foundation
import Observation
import UserNotifications
import WatchKit

@MainActor
@Observable
final class AppModel {
    enum Phase: Equatable {
        case loading
        case pairing(code: String, expiresAt: Date)
        case pairingFailed
        case paired(computerName: String?)
    }

    private(set) var phase: Phase = .loading
    private(set) var requests: [PendingRequest] = []
    private(set) var isOffline = false
    private(set) var notice: String?
    private(set) var outcome: Outcome?

    /// Held in memory until the computer claims the code, so an abandoned pairing leaves nothing behind.
    private var pairingToken: String?
    private var apnsToken: String?
    private var inFlight: Set<String> = []

    init() {
        if Config.isUITest { TokenStore.delete() }
    }

    /// Polls for as long as the calling task lives. The view ties that to the app being active.
    func run() async {
        while !Task.isCancelled {
            await tick()
            try? await Task.sleep(for: Config.pollInterval)
        }
    }

    func retryPairing() {
        phase = .loading
    }

    func decide(requestID: String, answer: Answer) async {
        guard let token = TokenStore.load(), inFlight.insert(requestID).inserted else { return }
        defer { inFlight.remove(requestID) }
        requests.removeAll { $0.id == requestID }
        outcome = Outcome(answer: answer)
        do {
            try await RelayClient(token: token).decide(requestID: requestID, answer: answer)
            outcome?.isSending = false
            WKInterfaceDevice.current().play(answer.decision == .allow ? .success : .failure)
            try? await Task.sleep(for: Config.outcomeDuration)
            outcome = nil
        } catch RelayError.alreadyClosed {
            outcome = nil
            show(notice: "That request already ended.")
        } catch {
            // The request stays open on the relay, so the next poll brings it back.
            outcome = nil
            show(notice: "Could not send that. Try again.")
        }
    }

    func unpair() async {
        guard let token = TokenStore.load() else { return }
        try? await RelayClient(token: token).unpair()
        forgetPairing()
    }

    func didReceive(apnsToken: String) {
        self.apnsToken = apnsToken
        Task { await registerDevice() }
    }

    // MARK: - Polling

    private func tick() async {
        if let token = TokenStore.load() {
            await refresh(token: token)
            return
        }
        switch phase {
        case .pairing(_, let expiresAt) where Date() < expiresAt:
            await checkPairingClaimed()
        case .pairingFailed:
            break
        default:
            await startPairing()
        }
    }

    private func startPairing() async {
        do {
            let start = try await RelayClient().startPairing(name: WKInterfaceDevice.current().name)
            pairingToken = start.watchToken
            phase = .pairing(code: start.code, expiresAt: Date().addingTimeInterval(start.expiresIn))
        } catch {
            pairingToken = nil
            phase = .pairingFailed
        }
    }

    private func checkPairingClaimed() async {
        guard let token = pairingToken else {
            phase = .loading
            return
        }
        do {
            let status = try await RelayClient(token: token).status()
            guard status.paired else { return }
            TokenStore.save(token)
            pairingToken = nil
            phase = .paired(computerName: status.peerName)
            await setUpPush()
        } catch RelayError.unauthorized {
            pairingToken = nil
            phase = .loading
        } catch {
            // A blip while waiting. The code is still good, so keep showing it.
        }
    }

    private func refresh(token: String) async {
        let client = RelayClient(token: token)
        do {
            if case .paired = phase {} else {
                phase = .paired(computerName: try await client.status().peerName)
                await setUpPush()
            }
            let list = try await client.pending()
            isOffline = false
            apply(list)
        } catch RelayError.unauthorized {
            forgetPairing()
        } catch {
            isOffline = true
        }
    }

    private func apply(_ list: PendingList) {
        let now = Date()
        let known = Set(requests.map(\.id))
        let fresh = list.requests
            .filter { !inFlight.contains($0.id) }
            .map { request in
                PendingRequest(
                    id: request.id,
                    tool: request.tool,
                    title: request.title,
                    detail: request.detail,
                    project: request.project,
                    // Count down from the relay's clock, so a skewed watch clock cannot mislead.
                    expiresAt: now.addingTimeInterval((request.expiresAt - list.serverTime) / 1000),
                    isTruncated: request.truncated,
                    sessionOptions: request.options ?? []
                )
            }
        if fresh.contains(where: { !known.contains($0.id) }) {
            WKInterfaceDevice.current().play(.notification)
        }
        requests = fresh
    }

    private func forgetPairing() {
        TokenStore.delete()
        requests = []
        phase = .loading
    }

    private func show(notice text: String) {
        notice = text
        Task {
            try? await Task.sleep(for: .seconds(3))
            if notice == text { notice = nil }
        }
    }

    // MARK: - Push

    private func setUpPush() async {
        guard !Config.isUITest else { return }
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
        WKApplication.shared().registerForRemoteNotifications()
        await registerDevice()
    }

    private func registerDevice() async {
        guard let apnsToken, let token = TokenStore.load() else { return }
        try? await RelayClient(token: token).registerDevice(apnsToken: apnsToken, environment: Config.apnsEnvironment)
    }
}
