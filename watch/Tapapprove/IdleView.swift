import SwiftUI

struct IdleView: View {
    let computerName: String?
    let isOffline: Bool
    let onUnpair: () -> Void
    @State private var isConfirmingUnpair = false

    private var description: String {
        if isOffline { return "Trying to reach the relay." }
        if let computerName { return "Waiting for \(computerName)." }
        return "Waiting for your computer."
    }

    var body: some View {
        ContentUnavailableView {
            Label {
                Text(isOffline ? "Offline" : "All Clear")
                    .accessibilityIdentifier("idleTitle")
            } icon: {
                Image(systemName: isOffline ? "wifi.slash" : "checkmark.circle.fill")
                    .symbolRenderingMode(.hierarchical)
                    .foregroundStyle(isOffline ? Color.yellow : Color.accentColor)
            }
        } description: {
            Text(description)
                .lineLimit(2)
        }
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Options", systemImage: "ellipsis") { isConfirmingUnpair = true }
                    .accessibilityIdentifier("optionsButton")
            }
        }
        .confirmationDialog("Unpair this watch?", isPresented: $isConfirmingUnpair) {
            Button("Unpair", role: .destructive, action: onUnpair)
        }
    }
}
