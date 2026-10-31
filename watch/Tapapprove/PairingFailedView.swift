import SwiftUI

struct PairingFailedView: View {
    let onRetry: () -> Void

    var body: some View {
        ContentUnavailableView {
            Label("Can't Reach the Relay", systemImage: "wifi.slash")
        } description: {
            Text("Check the connection and try again.")
        } actions: {
            Button("Try Again", action: onRetry)
                .glassButton()
        }
    }
}
