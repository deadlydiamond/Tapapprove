import SwiftUI

struct RequestView: View {
    let request: PendingRequest
    let queued: Int
    let onAnswer: (Answer) -> Void
    @State private var isArmed = false
    @State private var hasReachedEnd = false

    private func deny() {
        onAnswer(Answer(decision: .deny))
    }

    private func arm() async {
        try? await Task.sleep(for: Config.armDelay)
        isArmed = true
    }

    var body: some View {
        ScrollView {
            // Lazy on purpose: the answers only appear once the reader reaches the end of the text.
            LazyVStack(alignment: .leading, spacing: 0) {
                RequestHeader(request: request, queued: queued)
                    .padding(.bottom, 8)
                if !hasReachedEnd {
                    Label("Scroll to the end to answer", systemImage: "arrow.down")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .padding(.bottom, 6)
                        .accessibilityIdentifier("scrollHint")
                }
                ForEach(Array(request.detailPieces.enumerated()), id: \.offset) { _, piece in
                    Text(piece)
                        .font(.system(.footnote, design: .monospaced))
                        .foregroundStyle(piece == PendingRequest.sandboxWarning ? Color.yellow : Color.primary)
                        .accessibilityIdentifier("requestDetail")
                }
                Color.clear
                    .frame(height: 1)
                    .onAppear { hasReachedEnd = true }
                RequestAnswers(request: request, isArmed: isArmed, onAnswer: onAnswer)
                    .padding(.top, 10)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        // While reading, No stays one tap away and the arrow says where the other answers are.
        // Text scrolls up behind this bar's fade, so it never runs under the buttons.
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if !hasReachedEnd {
                HStack {
                    Button("No", systemImage: "xmark", action: deny)
                        .labelStyle(.iconOnly)
                        .buttonBorderShape(.circle)
                        .glassButton()
                        .controlSize(.small)
                        .fixedSize()
                        .disabled(!isArmed)
                        .accessibilityIdentifier("quickDenyButton")
                    Spacer()
                    Image(systemName: "arrow.down")
                        .foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                        .padding(.trailing, 14)
                }
                // The bar sits down in the screen's corners, leaving the room for the text.
                .padding(.bottom, -22)
                .padding(.top, 8)
                .background {
                    LinearGradient(
                        stops: [.init(color: .clear, location: 0), .init(color: .black, location: 0.35)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                    .ignoresSafeArea(edges: .bottom)
                }
            }
        }
        .sensoryFeedback(.selection, trigger: hasReachedEnd) { _, reached in reached && isArmed }
        .task(arm)
    }
}
