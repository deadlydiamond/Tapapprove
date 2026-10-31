import SwiftUI

struct OutcomeView: View {
    let outcome: Outcome

    var body: some View {
        VStack(spacing: 8) {
            if outcome.isSending {
                ProgressView()
            } else {
                Image(systemName: outcome.symbolName)
                    .font(.largeTitle)
                    .symbolRenderingMode(.hierarchical)
                    .foregroundStyle(outcome.answer.decision == .allow ? Color.green : Color.secondary)
                    .transition(.opacity)
                    .accessibilityHidden(true)
            }
            Text(outcome.title)
                .font(.headline)
                .multilineTextAlignment(.center)
                .accessibilityIdentifier("outcomeTitle")
        }
    }
}
