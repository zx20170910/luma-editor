import AppKit
import Foundation

let destination = CommandLine.arguments[1]
try FileManager.default.createDirectory(atPath: destination, withIntermediateDirectories: true)
for (name, pixels) in [("icon_16x16",16),("icon_16x16@2x",32),("icon_32x32",32),("icon_32x32@2x",64),("icon_128x128",128),("icon_128x128@2x",256),("icon_256x256",256),("icon_256x256@2x",512),("icon_512x512",512),("icon_512x512@2x",1024)] {
    let size = CGFloat(pixels)
    let image = NSImage(size: NSSize(width: size, height: size))
    image.lockFocus()
    let context = NSGraphicsContext.current!.cgContext
    context.scaleBy(x: size / 1024, y: size / 1024)
    let outer = NSBezierPath(roundedRect: NSRect(x: 60, y: 60, width: 904, height: 904), xRadius: 202, yRadius: 202)
    NSGradient(starting: NSColor(calibratedRed: 0.17, green: 0.21, blue: 0.27, alpha: 1), ending: NSColor(calibratedRed: 0.09, green: 0.11, blue: 0.15, alpha: 1))!.draw(in: outer, angle: -65)
    NSColor(calibratedWhite: 0.65, alpha: 0.17).setStroke()
    outer.lineWidth = 3
    outer.stroke()
    let shape = NSBezierPath()
    shape.move(to: NSPoint(x: 385, y: 768))
    shape.line(to: NSPoint(x: 535, y: 768))
    shape.line(to: NSPoint(x: 432, y: 380))
    shape.line(to: NSPoint(x: 711, y: 380))
    shape.line(to: NSPoint(x: 676, y: 255))
    shape.line(to: NSPoint(x: 249, y: 255))
    shape.close()
    NSGradient(starting: NSColor(calibratedRed: 0.72, green: 0.91, blue: 0.82, alpha: 1), ending: NSColor(calibratedRed: 0.45, green: 0.72, blue: 0.64, alpha: 1))!.draw(in: shape, angle: -70)
    let spark = NSBezierPath()
    spark.move(to: NSPoint(x: 720, y: 759)); spark.line(to: NSPoint(x: 738, y: 711)); spark.line(to: NSPoint(x: 786, y: 693)); spark.line(to: NSPoint(x: 738, y: 675)); spark.line(to: NSPoint(x: 720, y: 627)); spark.line(to: NSPoint(x: 702, y: 675)); spark.line(to: NSPoint(x: 654, y: 693)); spark.line(to: NSPoint(x: 702, y: 711)); spark.close()
    NSColor(calibratedRed: 0.78, green: 0.93, blue: 0.85, alpha: 1).setFill(); spark.fill()
    image.unlockFocus()
    let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!
    try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "\(destination)/\(name).png"))
}
