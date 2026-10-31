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
                    .padding(6)
                    .background(.black.opacity(0.85), in: RoundedRectangle(cornerRadius: 8))
            }
        }
        .task(id: scenePhase) {
            if scenePhase == .active { await model.run() }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            ProgressView()
        case .pairing(let code, _):
            PairingView(code: code)
        case .pairingFailed:
            PairingFailedView { model.retryPairing() }
        case .paired(let computerName):
            if let request = model.requests.first {
                RequestView(
                    request: request,
                    queued: model.requests.count - 1,
                    onDecide: { decision in
                        Task { await model.decide(requestID: request.id, decision: decision) }
                    }
                )
                // A new identity resets the view's state, which re-arms the safety checks.
                .id(request.id)
            } else {
                IdleView(computerName: computerName, isOffline: model.isOffline) {
                    Task { await model.unpair() }
                }
            }
        }
    }
}

private extension View {
    /// Marks a screen as needing a decision. Every other screen stays on black, so the
    /// color means something when it appears.
    func needsDecisionBackground() -> some View {
        containerBackground(
            LinearGradient(colors: [Color.accentColor.opacity(0.45), .black], startPoint: .top, endPoint: .bottom),
            for: .navigation
        )
    }

    /// Liquid Glass on watchOS 26 and later, the closest older style before that.
    @ViewBuilder
    func glassButton() -> some View {
        if #available(watchOS 26, *) {
            buttonStyle(.glass)
        } else {
            buttonStyle(.bordered)
        }
    }

    @ViewBuilder
    func prominentGlassButton() -> some View {
        if #available(watchOS 26, *) {
            buttonStyle(.glassProminent)
        } else {
            buttonStyle(.borderedProminent)
        }
    }
}

struct PairingView: View {
    let code: String

    var body: some View {
        ScrollView {
            VStack(spacing: 6) {
                Text(code)
                    .font(.system(.title2, design: .monospaced).weight(.semibold))
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                    .accessibilityIdentifier("pairCode")
                Text("On your computer, run:")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Text("npx tapapprove pair \(code)")
                    .font(.system(.footnote, design: .monospaced))
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
        }
        .navigationTitle("Pair")
    }
}

struct PairingFailedView: View {
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "wifi.slash")
                .font(.title3)
                .foregroundStyle(.yellow)
            Text("Could not reach the relay.")
                .font(.footnote)
                .multilineTextAlignment(.center)
            Button("Try Again", action: onRetry)
                .glassButton()
        }
        .navigationTitle("Pair")
    }
}

struct IdleView: View {
    let computerName: String?
    let isOffline: Bool
    let onUnpair: () -> Void
    @State private var isConfirmingUnpair = false

    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: isOffline ? "wifi.slash" : "checkmark.seal.fill")
                .font(.title)
                .foregroundStyle(isOffline ? Color.yellow : Color.accentColor)
            Text(isOffline ? "Offline" : "All clear")
                .font(.headline)
                .accessibilityIdentifier("idleTitle")
            if let computerName {
                Text(computerName)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .navigationTitle("Tapapprove")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Options", systemImage: "ellipsis") { isConfirmingUnpair = true }
                    .accessibilityIdentifier("optionsButton")
            }
        }
        .confirmationDialog("Unpair this watch?", isPresented: $isConfirmingUnpair) {
            Button("Unpair", role: .destructive, action: onUnpair)
        }
    }
}

struct RequestView: View {
    let request: PendingRequest
    let queued: Int
    let onDecide: (Decision) -> Void
    @State private var isArmed = false
    @State private var hasReachedEnd = false

    var body: some View {
        ScrollView {
            // Lazy on purpose: the marker below only appears once the reader reaches the end.
            LazyVStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline) {
                    Text(request.title)
                        .font(.headline)
                        .accessibilityIdentifier("requestTitle")
                    Spacer(minLength: 4)
                    Text(timerInterval: Date.now...max(request.expiresAt, Date.now), countsDown: true)
                        .font(.footnote.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .fixedSize()
                        .accessibilityLabel("Time left")
                }
                if request.isTruncated {
                    Label("Too long to approve here. Use your computer.", systemImage: "exclamationmark.triangle")
                        .font(.footnote)
                        .foregroundStyle(.yellow)
                        .accessibilityIdentifier("truncatedNotice")
                } else if !hasReachedEnd {
                    Label("Scroll to the end to approve", systemImage: "arrow.down")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("scrollHint")
                }
                Text(request.detail)
                    .font(.system(.footnote, design: .monospaced))
                    .accessibilityIdentifier("requestDetail")
                if queued > 0 {
                    Text("+\(queued) more waiting")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Color.clear
                    .frame(height: 1)
                    .onAppear { hasReachedEnd = true }
            }
        }
        .navigationTitle(request.project ?? "Tapapprove")
        .needsDecisionBackground()
        .toolbar {
            ToolbarItemGroup(placement: .bottomBar) {
                Button("Deny", systemImage: "xmark", role: .destructive) { onDecide(.deny) }
                    .labelStyle(.iconOnly)
                    .buttonBorderShape(.circle)
                    .tint(.red)
                    .glassButton()
                    .disabled(!isArmed)
                    .accessibilityIdentifier("denyButton")
                Spacer()
                // Floating controls would let anyone approve a command they never read,
                // so Approve waits for the end of the text. Deny never has to.
                if !request.isTruncated {
                    Button("Approve", systemImage: "checkmark") { onDecide(.allow) }
                        .labelStyle(.iconOnly)
                        .buttonBorderShape(.circle)
                        .tint(.green)
                        .prominentGlassButton()
                        .disabled(!isArmed || !hasReachedEnd)
                        .accessibilityIdentifier("approveButton")
                }
            }
        }
        .task {
            try? await Task.sleep(for: Config.armDelay)
            isArmed = true
        }
    }
}
