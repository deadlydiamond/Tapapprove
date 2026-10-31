import SwiftUI

extension View {
    /// Marks a screen as needing a decision. Every other screen stays on black, so the
    /// color means something when it appears.
    func needsDecisionBackground() -> some View {
        containerBackground(
            LinearGradient(colors: [Color.accentColor.opacity(0.35), .black], startPoint: .top, endPoint: .center),
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

    @ViewBuilder
    func noticeBackground() -> some View {
        if #available(watchOS 26, *) {
            glassEffect(.regular, in: .rect(cornerRadius: 16))
        } else {
            background(.ultraThinMaterial, in: .rect(cornerRadius: 16))
        }
    }
}
