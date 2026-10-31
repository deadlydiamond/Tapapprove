import SwiftUI

/// The same answers, in the same order and words, as Claude Code's own dialog.
struct RequestAnswers: View {
    let request: PendingRequest
    let isArmed: Bool
    let onAnswer: (Answer) -> Void

    private func answerText(_ text: String) -> some View {
        Text(text)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
    }

    private func sendInstead(_ text: String) {
        let message = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !message.isEmpty { onAnswer(Answer(decision: .deny, message: message)) }
    }

    var body: some View {
        VStack(spacing: 6) {
            Button {
                onAnswer(Answer(decision: .allow))
            } label: {
                answerText("Yes")
                    .bold()
            }
            .glassButton()
            .accessibilityIdentifier("approveButton")

            ForEach(Array(request.sessionOptions.enumerated()), id: \.offset) { index, label in
                Button {
                    onAnswer(Answer(decision: .allow, option: index))
                } label: {
                    answerText(label)
                        .font(.footnote)
                }
                .glassButton()
                .accessibilityIdentifier("sessionOption\(index)")
            }

            Button {
                onAnswer(Answer(decision: .deny))
            } label: {
                answerText("No")
            }
            .glassButton()
            .accessibilityIdentifier("denyButton")

            TextFieldLink(prompt: Text("What should Claude do?")) {
                answerText("Tell Claude what to do instead")
                    .font(.footnote)
            } onSubmit: { text in
                sendInstead(text)
            }
            .glassButton()
            .accessibilityIdentifier("insteadButton")
        }
        .frame(maxWidth: .infinity)
        .disabled(!isArmed)
    }
}
