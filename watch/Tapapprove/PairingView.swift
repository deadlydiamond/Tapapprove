import SwiftUI

struct PairingView: View {
    let code: String
    let expiresAt: Date
    let onSample: () -> Void

    // Five groups do not fit one line, so the break falls between two of them.
    private var rows: String {
        let groups = code.split(separator: "-")
        return [groups.prefix(3), groups.dropFirst(3)]
            .map { $0.joined(separator: "-") }
            .joined(separator: "\n")
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                Text("On your computer, run:")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                VStack(spacing: 4) {
                    Text("npx tapapprove pair")
                        .font(.system(.footnote, design: .monospaced))
                    Text(rows)
                        .font(.system(.title3, design: .monospaced).bold())
                        .minimumScaleFactor(0.5)
                        .lineLimit(2)
                        .multilineTextAlignment(.center)
                        .accessibilityLabel(code)
                        .accessibilityIdentifier("pairCode")
                }
                .padding(8)
                .frame(maxWidth: .infinity)
                .background(.quaternary, in: .rect(cornerRadius: 12))
                Text("Expires in \(Text(timerInterval: Date.now...max(expiresAt, Date.now), countsDown: true))")
                    .font(.footnote.monospacedDigit())
                    .foregroundStyle(.secondary)
                Button("Try a Sample Request", action: onSample)
                    .font(.footnote)
                    .glassButton()
                    .accessibilityIdentifier("sampleButton")
                Link("Privacy Policy", destination: Config.privacyPolicyURL)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
