// Draws the app icon: a fingertip's tap that carries on into a check.
// Usage: swiftc -O scripts/make-icon.swift -o /tmp/make-icon && /tmp/make-icon watch/Tapapprove/Assets.xcassets/AppIcon.appiconset/icon.png
// watch/TapapproveWidget/BrandMark.swift draws the same mark for the watch face.
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let size = 1024
let space = CGColorSpace(name: CGColorSpace.sRGB)!
let top = CGColor(red: 0.871, green: 0.494, blue: 0.369, alpha: 1)
let bottom = CGColor(red: 0.722, green: 0.361, blue: 0.247, alpha: 1)
let white = CGColor(red: 1, green: 1, blue: 1, alpha: 1)

let context = CGContext(
    data: nil,
    width: size,
    height: size,
    bitsPerComponent: 8,
    bytesPerRow: 0,
    space: space,
    bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
)!

let gradient = CGGradient(colorsSpace: space, colors: [top, bottom] as CFArray, locations: [0, 1])!
context.drawLinearGradient(gradient, start: CGPoint(x: 0, y: size), end: .zero, options: [])

let tap = CGPoint(x: 343, y: 501)
context.setStrokeColor(white)
context.setLineWidth(101)
context.setLineCap(.round)
context.setLineJoin(.round)
context.beginPath()
context.move(to: tap)
context.addLine(to: CGPoint(x: 497, y: 347))
context.addLine(to: CGPoint(x: 791, y: 677))
context.strokePath()

context.setFillColor(white)
context.fillEllipse(in: CGRect(x: tap.x - 81, y: tap.y - 81, width: 162, height: 162))

context.setStrokeColor(white.copy(alpha: 0.5)!)
context.setLineWidth(29)
context.strokeEllipse(in: CGRect(x: tap.x - 145, y: tap.y - 145, width: 290, height: 290))

let destination = CGImageDestinationCreateWithURL(
    URL(fileURLWithPath: CommandLine.arguments[1]) as CFURL,
    UTType.png.identifier as CFString,
    1,
    nil
)!
CGImageDestinationAddImage(destination, context.makeImage()!, nil)
CGImageDestinationFinalize(destination)
