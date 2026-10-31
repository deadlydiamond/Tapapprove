import SwiftUI

struct RootView: View {
    let model: AppModel
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        NavigationStack {
            content
        }
        .overlay(alignment: .bottom) {
            if let notice = model.notice {
                Text(notice)
                    .font(.footnote)
                    .multilineTextAlignment(.center)
                    .padding(10)
                    .noticeBackground()
                    .transition(.opacity)
            }
        }
        .animation(.smooth(duration: 0.3), value: model.notice)
        .animation(.smooth(duration: 0.3), value: model.outcome)
        .animation(.smooth(duration: 0.3), value: model.requests.first?.id)
        .task(id: scenePhase) {
            if scenePhase == .active { await model.run() }
        }
    }

    @ViewBuilder
    private var content: some View {
        // The next request waits for the confirmation to end, so its safety delay starts
        // only once it can be seen, and a tap aimed at the last answer cannot reach it.
        if let outcome = model.outcome {
            OutcomeView(outcome: outcome)
        } else if let sample = model.sample {
            RequestView(request: sample, queued: 0) { answer in
                Task { await model.answerSample(answer) }
            }
        } else {
            screen
        }
    }

    @ViewBuilder
    private var screen: some View {
        switch model.phase {
        case .loading:
            ProgressView()
                .tint(.white)
        case .pairing(let code, let expiresAt):
            PairingView(code: code, expiresAt: expiresAt) { model.showSample() }
        case .pairingFailed:
            PairingFailedView { model.retryPairing() }
        case .paired:
            if let request = model.requests.first {
                RequestView(
                    request: request,
                    queued: model.requests.count - 1,
                    onAnswer: { answer in
                        Task { await model.decide(requestID: request.id, answer: answer) }
                    }
                )
                // A new identity resets the view's state, which re-arms the safety checks.
                .id(request.id)
            } else {
                IdleView(
                    isOffline: model.isOffline,
                    onSample: { model.showSample() },
                    onUnpair: { Task { await model.unpair() } }
                )
            }
        }
    }
}
