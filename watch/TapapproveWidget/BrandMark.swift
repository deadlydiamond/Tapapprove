import SwiftUI

/// The brand mark: a fingertip's tap that carries on into a check. `scripts/make-icon.swift`
/// draws the same mark for the app icon. Points are fractions of a square, y pointing down.
struct BrandMark: Shape {
    func path(in rect: CGRect) -> Path {
        let size = min(rect.width, rect.height)
        let origin = CGPoint(x: rect.midX - size / 2, y: rect.midY - size / 2)
        let point = { (x: CGFloat, y: CGFloat) in CGPoint(x: origin.x + x * size, y: origin.y + y * size) }
        let tap = point(0.335, 0.511)

        var check = Path()
        check.move(to: tap)
        check.addLine(to: point(0.485, 0.661))
        check.addLine(to: point(0.772, 0.339))

        var ring = Path()
        ring.addEllipse(in: CGRect(x: tap.x - 0.142 * size, y: tap.y - 0.142 * size, width: 0.284 * size, height: 0.284 * size))

        var mark = check.strokedPath(StrokeStyle(lineWidth: 0.099 * size, lineCap: .round, lineJoin: .round))
        mark.addPath(ring.strokedPath(StrokeStyle(lineWidth: 0.028 * size)))
        mark.addEllipse(in: CGRect(x: tap.x - 0.079 * size, y: tap.y - 0.079 * size, width: 0.158 * size, height: 0.158 * size))
        return mark
    }
}
