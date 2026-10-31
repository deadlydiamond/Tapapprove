import SwiftUI

struct PairingView: View {
    let code: String
    let expiresAt: Date

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                Text(code)
                    .font(.system(.title2, design: .monospaced).bold())
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                    .accessibilityIdentifier("pairCode")
                Text("On your computer, run:")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Text("npx tapapprove pair \(code)")
                    .font(.system(.footnote, design: .monospaced))
                    .multilineTextAlignment(.center)
                    .padding(8)
                    .frame(maxWidth: .infinity)
                    .background(.quaternary, in: .rect(cornerRadius: 12))
                Text("Expires in \(Text(timerInterval: Date.now...max(expiresAt, Date.now), countsDown: true))")
                    .font(.footnote.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Pair")
        .navigationBarTitleDisplayMode(.inline)
    }
}
