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
                if request.isTruncated {
                    Label("Too long to approve here. Use your computer.", systemImage: "exclamationmark.triangle")
                        .font(.footnote)
                        .foregroundStyle(.yellow)
                        .padding(.bottom, 6)
                        .accessibilityIdentifier("truncatedNotice")
                } else if !hasReachedEnd {
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
        .overlay(alignment: .bottom) {
            // Text scrolling under the floating controls fades out instead of colliding with them.
            if !hasReachedEnd {
                LinearGradient(colors: [.clear, .black], startPoint: .top, endPoint: .bottom)
                    .frame(height: 64)
                    .ignoresSafeArea(edges: .bottom)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
        }
        .needsDecisionBackground()
        .toolbar {
            // While reading, No stays one tap away and the arrow says where the other answers are.
            if !hasReachedEnd {
                ToolbarItemGroup(placement: .bottomBar) {
                    Button("No", systemImage: "xmark", role: .destructive, action: deny)
                        .labelStyle(.iconOnly)
                        .buttonBorderShape(.circle)
                        .glassButton()
                        .disabled(!isArmed)
                        .accessibilityIdentifier("quickDenyButton")
                    Spacer()
                    Button("Scroll to the end", systemImage: "arrow.down") {}
                        .labelStyle(.iconOnly)
                        .buttonBorderShape(.circle)
                        .glassButton()
                        .disabled(true)
                }
            }
        }
        .sensoryFeedback(.selection, trigger: hasReachedEnd) { _, reached in reached && isArmed }
        .task(arm)
    }
}
