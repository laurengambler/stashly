//
//  tools/scan-probe/make-fixtures.swift
//  Render SYNTHETIC gift-card images to run the scan pipeline against.
//
//  Every number here is invented. No real card data belongs in this repo,
//  so the checked-in fixtures are drawn rather than photographed — which
//  also makes them deterministic, unlike a photo.
//
//  The layouts reproduce the ones that broke on device:
//    acct-label     "ACCT#: 70123456 789 0123456" — label plus a number
//                   split into runs by wide gaps, over fine print
//    number-and-pin "Card #1234567890        18934" — two fields, one line
//    grouped        "6011 5000 1234 5678" — one number, single-spaced
//    wide-grouped   "1234  5678  9012  3456" — one number, wide-spaced
//    fineprint-only no number at all, to prove the field stays blank
//
//  Usage: tools/scan-probe/make-fixtures.sh [outdir]
//

import Foundation
import AppKit

struct Line {
    let text: String
    let size: CGFloat
    let bold: Bool
    init(_ text: String, size: CGFloat = 34, bold: Bool = false) {
        self.text = text
        self.size = size
        self.bold = bold
    }
}

/// Render a real Code 128 barcode, so a fixture can carry a payload that
/// Vision actually decodes — which is the only way to test what happens when
/// the barcode disagrees with the printed card number.
func barcodeImage(_ payload: String, width: CGFloat, height: CGFloat) -> NSImage? {
    guard let filter = CIFilter(name: "CICode128BarcodeGenerator") else { return nil }
    filter.setValue(payload.data(using: .ascii), forKey: "inputMessage")
    filter.setValue(0.0, forKey: "inputQuietSpace")
    guard let out = filter.outputImage else { return nil }
    let scaled = out.transformed(by: CGAffineTransform(
        scaleX: width / out.extent.width,
        y: height / out.extent.height
    ))
    let rep = NSCIImageRep(ciImage: scaled)
    let img = NSImage(size: rep.size)
    img.addRepresentation(rep)
    return img
}

func render(_ lines: [Line], to url: URL, width: Int = 1200, height: Int = 760, barcode: String? = nil) {
    let image = NSImage(size: NSSize(width: width, height: height))
    image.lockFocus()

    NSColor.white.setFill()
    NSRect(x: 0, y: 0, width: width, height: height).fill()

    // A tint band at the top so the image is not pure white; Vision copes
    // either way, but it keeps the fixtures looking like cards.
    NSColor(calibratedRed: 0.93, green: 0.96, blue: 0.88, alpha: 1).setFill()
    NSRect(x: 0, y: CGFloat(height) - 150, width: CGFloat(width), height: 150).fill()

    var y = CGFloat(height) - 100
    for line in lines {
        let font = line.bold
            ? NSFont.monospacedSystemFont(ofSize: line.size, weight: .bold)
            : NSFont.systemFont(ofSize: line.size)
        let attrs: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: NSColor.black,
        ]
        (line.text as NSString).draw(at: NSPoint(x: 60, y: y), withAttributes: attrs)
        y -= line.size * 1.9
    }

    if let payload = barcode,
       let bc = barcodeImage(payload, width: CGFloat(width) * 0.55, height: 120) {
        bc.draw(in: NSRect(x: CGFloat(width) * 0.08, y: y - 40, width: CGFloat(width) * 0.55, height: 120))
        y -= 190
    }

    image.unlockFocus()

    guard let tiff = image.tiffRepresentation,
          let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:]) else {
        FileHandle.standardError.write("could not encode \(url.lastPathComponent)\n".data(using: .utf8)!)
        return
    }
    try? png.write(to: url)
    print("wrote \(url.path)")
}

let outDir = CommandLine.arguments.count > 1
    ? URL(fileURLWithPath: CommandLine.arguments[1])
    : URL(fileURLWithPath: "fixtures")
try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

let fineprint = [
    Line("This card is not redeemable for cash except where", size: 21),
    Line("required by law. Terms and conditions apply.", size: 21),
    Line("For balance visit example.com/balance", size: 21),
]

render([
    Line("STASH MARKET", size: 40, bold: false),
    Line("ACCT#: 70123456 789 0123456", size: 34, bold: true),
] + fineprint, to: outDir.appendingPathComponent("acct-label.png"))

render([
    Line("STASH MARKET", size: 40),
    Line("Card #1234567890        18934", size: 34, bold: true),
] + fineprint, to: outDir.appendingPathComponent("number-and-pin.png"))

render([
    Line("STASH MARKET", size: 40),
    Line("6011 5000 1234 5678", size: 36, bold: true),
    Line("PIN 4821", size: 28, bold: true),
] + fineprint, to: outDir.appendingPathComponent("grouped.png"))

render([
    Line("STASH MARKET", size: 40),
    Line("1234  5678  9012  3456", size: 36, bold: true),
] + fineprint, to: outDir.appendingPathComponent("wide-grouped.png"))

render([Line("STASH MARKET", size: 40)] + fineprint,
       to: outDir.appendingPathComponent("fineprint-only.png"))

// A cinema-style card whose BARCODE IS NOT ITS CARD NUMBER: the barcode
// carries a retail UPC plus an internal serial, while the card prints and
// labels the real number, which ends in a letter. The labeled number must
// win, the letter must survive, and the dashes must close up.
render([
    Line("STASH CINEMA", size: 40),
    Line("CARD#: 41230-8856-2274Q        PIN: 4412238", size: 30, bold: true),
    Line("0125        2048576        0-12345-67890", size: 24),
] + fineprint,
       to: outDir.appendingPathComponent("barcode-vs-label.png"),
       height: 900,
       barcode: "012345678905000000411223")
