import SwiftUI

struct IdleView: View {
    let isOffline: Bool
    let onSample: () -> Void
    let onUnpair: () -> Void
    @State private var isConfirmingUnpair = false
    @Environment(\.openURL) private var openURL

    var body: some View {
        ContentUnavailableView {
            Label {
                Text(isOffline ? "Offline" : "All Clear")
                    .accessibilityIdentifier("idleTitle")
            } icon: {
                Image(systemName: isOffline ? "wifi.slash" : "checkmark.circle.fill")
                    .symbolRenderingMode(.hierarchical)
                    .foregroundStyle(isOffline ? Color.secondary : Color.primary)
            }
        } description: {
            Text(isOffline ? "Trying to reach the relay." : "Waiting for your computer.")
                .lineLimit(2)
        }
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Options", systemImage: "ellipsis") { isConfirmingUnpair = true }
                    .accessibilityIdentifier("optionsButton")
            }
        }
        .confirmationDialog("Options", isPresented: $isConfirmingUnpair) {
            Button("Try a Sample Request", action: onSample)
            Button("Privacy Policy") { openURL(Config.privacyPolicyURL) }
            Button("Unpair This Watch", role: .destructive, action: onUnpair)
        }
    }
}
