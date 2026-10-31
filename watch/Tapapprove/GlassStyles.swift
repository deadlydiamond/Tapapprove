import SwiftUI

extension View {
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
    func noticeBackground() -> some View {
        if #available(watchOS 26, *) {
            glassEffect(.regular, in: .rect(cornerRadius: 16))
        } else {
            background(.ultraThinMaterial, in: .rect(cornerRadius: 16))
        }
    }
}
