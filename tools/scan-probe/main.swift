//
//  tools/scan-probe/main.swift
//  Run the card-scan still pipeline over an image ON A MAC.
//
//  It compiles ios/App/App/CardTextParser.swift — the same source the app
//  ships — and drives it with the same Vision requests StashScannerPlugin
//  uses. So a card photo can be checked without a device build, and a
//  reported misread can be reproduced from the photo that caused it.
//
//  Usage:
//      tools/scan-probe/run.sh <image> [<image> ...]
//
//  Prints the recognized fragments, the grouped visual lines with their
//  segments, and the resolved fields.
//
//  PRIVACY: this reads whatever image you point it at. Do not commit real
//  card photos or the output of running it over one — the repo carries only
//  synthetic fixtures (tools/scan-probe/make-fixtures.swift).
//

import Foundation
import Vision
import AppKit

func loadCGImage(_ path: String) -> CGImage? {
    guard let data = FileManager.default.contents(atPath: path),
          let src = CGImageSourceCreateWithData(data as CFData, nil),
          let cg = CGImageSourceCreateImageAtIndex(src, 0, nil) else { return nil }
    return cg
}

func quoted(_ s: String) -> String {
    "\"\(s.replacingOccurrences(of: "\"", with: "\\\""))\""
}

func probe(path: String) {
    let name = (path as NSString).lastPathComponent
    print("\n════════ \(name) ════════")

    guard let cg = loadCGImage(path) else {
        print("  ✗ could not read image")
        return
    }
    print("  \(cg.width)x\(cg.height)")

    let barcodeReq = VNDetectBarcodesRequest()
    let textReq = VNRecognizeTextRequest()
    textReq.recognitionLevel = .accurate
    textReq.usesLanguageCorrection = false

    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    do {
        try handler.perform([barcodeReq, textReq])
    } catch {
        print("  ✗ Vision failed: \(error)")
        return
    }

    var barcode = ""
    if let best = barcodeReq.results?.max(by: { $0.confidence < $1.confidence }),
       let payload = best.payloadStringValue, !payload.isEmpty {
        barcode = payload
    }

    // Exactly what StashScannerPlugin.analyze does.
    let positioned: [PositionedText] = (textReq.results ?? []).compactMap { obs in
        guard let t = obs.topCandidates(1).first?.string else { return nil }
        let trimmed = t.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let bb = obs.boundingBox
        return PositionedText(
            text: trimmed,
            rect: CGRect(x: bb.minX, y: 1 - bb.maxY, width: bb.width, height: bb.height)
        )
    }

    print("\n  ── raw fragments (\(positioned.count)) ──")
    for f in positioned.sorted(by: { $0.rect.midY < $1.rect.midY }) {
        let r = f.rect
        print(String(format: "    y=%.3f x=%.3f..%.3f  %@", r.midY, r.minX, r.maxX, quoted(f.text)))
    }

    let lines = CardTextParser.visualLines(from: positioned)
    print("\n  ── visual lines (\(lines.count)) ──")
    for (i, l) in lines.enumerated() {
        print("    [\(i)] \(quoted(l))")
        let segs = CardTextParser.segmentLine(l)
        if segs.count > 1 {
            print("         segments: \(segs.map(quoted).joined(separator: " | "))")
        }
    }

    let parsed = CardTextParser.parseFields(barcode: barcode, lines: lines)
    print("\n  ── resolved ──")
    print("    barcode: \(barcode.isEmpty ? "(none)" : quoted(barcode))")
    print("    number:  \(parsed.number.isEmpty ? "(none)" : parsed.number)\(parsed.numberFromLabel ? "  [from label]" : "")")
    if !parsed.rejectedNumber.isEmpty {
        print("    number REJECTED by guard: \(quoted(parsed.rejectedNumber))")
    }
    print("    pin:     \(parsed.pin.isEmpty ? "(none)" : parsed.pin)")
    print("    merchantGuess: \(quoted(CardTextParser.merchantGuess(from: lines)))")
}

let paths = Array(CommandLine.arguments.dropFirst())
guard !paths.isEmpty else {
    print("usage: run.sh <image> [<image> ...]")
    exit(2)
}
for p in paths { probe(path: p) }
print("")
