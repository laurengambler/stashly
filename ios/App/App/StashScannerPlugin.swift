//
//  StashScannerPlugin.swift
//  Stashly — on-device card scanner (Apple Vision / VisionKit ONLY).
//
//  Exposes to JS (registerPlugin('StashScanner')):
//    isAvailable() -> { available: Bool }
//    scanLive()    -> live VisionKit scanner; resolves a scan result,
//                     rejects "cancelled" if the user backs out.
//    scanImage({ base64 }) -> runs Vision over a picked image.
//
//  Result shape (all optional; the JS flow degrades to empty fields):
//    { merchantGuess, number, pin, barcode, barcodeFormat,
//      imageBase64, textLines }
//
//  Nothing leaves the device: all recognition is local Vision/VisionKit.
//
//  LIVE, NOT BLIND. The scanner reads fields continuously off the camera
//  feed and shows the user what it has found — VisionKit's own highlights
//  sit on the number / PIN / barcode, and a status readout names each one
//  — before the user commits. This replaced an earlier design that looked
//  live but was not: it auto-captured on the first barcode it saw, threw
//  the live recognition away, and re-ran Vision over a still frame. The
//  highlights were decorative and the user had no way to confirm the
//  right number had been read.
//
//  So: no auto-capture. The user commits. Live values win; the still
//  frame captured at commit time only supplies the card photo and fills
//  in any field the live pass never resolved.
//
//  Concurrency: VisionKit's DataScannerViewController is @MainActor, so
//  every touch of it happens on the main actor (Task { @MainActor } here,
//  and LiveScanCoordinator is @MainActor). The Vision framework requests
//  (VNImageRequestHandler etc.) are NOT main-actor and run on a
//  background queue in analyze().
//
//  NOTE: this file must be a member of the "App" target in Xcode (it
//  auto-registers with Capacitor via CAPBridgedPlugin once compiled).
//

import Foundation
import Capacitor
import Vision
import VisionKit
import UIKit
import AVFoundation
import CoreGraphics

// MARK: - Field parsing (shared by the live pass and the still pass)

/// A recognized string with its place on the card, normalized to a
/// top-left origin in 0...1 so the live and still paths can be reduced to
/// the same thing.
struct PositionedText {
    let text: String
    let rect: CGRect
}

/// Pulls card fields out of recognized text. Pure and nonisolated so the
/// live scanner (main actor) and the Vision still pass (background queue)
/// can both use it, and so the two paths can never disagree about what a
/// PIN looks like.
///
/// THE LAYOUT PROBLEM. Cards print more than one field on a line:
///
///     Card #1234567890        18934
///
/// Reducing that line to its digits — which this used to do — fuses the
/// card number and the PIN into 123456789018934, a number that matches no
/// card. Worse, the two capture paths used to disagree about it: VisionKit
/// hands the live scanner ONE RecognizedItem per visual line, so the live
/// path saw that whole string at once, while VNRecognizeTextRequest splits
/// a still image at wide gaps and handed the still path two separate
/// observations. The still path got the number right by luck of
/// segmentation, not because it understood the layout — and it dropped the
/// PIN entirely, there being no PIN label.
///
/// So both paths now go through visualLines(), which rebuilds lines from
/// bounding boxes and preserves wide gaps, and then through parseFields(),
/// which treats a wide gap as a field boundary. Same input shape, same
/// answer, whichever path produced it.
///
/// Mirrors src/lib/scanParse.js; test/scanParse.test.mjs is the spec for
/// both. Change a rule in one and change it in the other.
enum CardTextParser {

    static func digits(_ s: String) -> String {
        String(s.filter { $0.isNumber })
    }

    // MARK: Visual lines

    /// Rebuild visual lines from positioned text: group fragments that sit
    /// at the same height, order them left to right, and preserve a wide
    /// horizontal gap as a run of spaces so parseFields can see it.
    static func visualLines(from items: [PositionedText]) -> [String] {
        let clean = items.filter { !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        guard !clean.isEmpty else { return [] }

        let sorted = clean.sorted { $0.rect.midY < $1.rect.midY }
        var groups: [[PositionedText]] = []

        for item in sorted {
            if var last = groups.last,
               let ref = last.first,
               sharesLine(ref.rect, item.rect, others: last) {
                last.append(item)
                groups[groups.count - 1] = last
            } else {
                groups.append([item])
            }
        }

        return groups.map { group -> String in
            let ordered = group.sorted { $0.rect.minX < $1.rect.minX }
            var line = ordered[0].text.trimmingCharacters(in: .whitespaces)
            for i in 1..<ordered.count {
                let gap = ordered[i].rect.minX - ordered[i - 1].rect.maxX
                // A gap wider than a few percent of the card is a field
                // boundary; anything tighter is ordinary word spacing.
                line += (gap > 0.035 ? "   " : " ")
                line += ordered[i].text.trimmingCharacters(in: .whitespaces)
            }
            return line
        }
    }

    /// Two fragments are on the same visual line when their vertical extents
    /// overlap by more than half the shorter one.
    private static func sharesLine(_ a: CGRect, _ b: CGRect, others: [PositionedText]) -> Bool {
        let top = max(a.minY, b.minY)
        let bottom = min(a.maxY, b.maxY)
        let overlap = bottom - top
        guard overlap > 0 else { return false }
        let shorter = min(a.height, b.height)
        guard shorter > 0 else { return false }
        return overlap / shorter > 0.5
    }

    /// Labels that mean "what follows is a PIN". Deliberately narrow — we
    /// only ever prefill a PIN the card itself clearly labels as one.
    /// Mirrors PIN_LABEL in src/lib/scanParse.js; keep the two in step.
    private static let pinLabel = try? NSRegularExpression(
        pattern:
            "\\b(?:p\\s*i\\s*n|pin\\s*(?:no|number|code|#)|access\\s*(?:code|number|#)"
            + "|security\\s*code|scratch\\s*(?:off\\s*)?code|redemption\\s*code)\\b[\\s:#.\\-]*",
        options: [.caseInsensitive]
    )

    /// 3-10 alphanumerics, mostly digits. Longer runs are card numbers.
    static func isPlausiblePin(_ raw: String) -> Bool {
        let s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard s.count >= 3, s.count <= 10,
              s.allSatisfy({ $0.isLetter || $0.isNumber }) else { return false }
        let d = digits(s).count
        return d >= 3 && d * 2 >= s.count
    }

    /// The whole leading alphanumeric run. Deliberately uncapped: stopping
    /// at 10 characters would truncate a 16-digit card number into
    /// something that then passes isPlausiblePin.
    private static func leadingCode(_ s: String) -> String? {
        var out = ""
        for ch in s {
            if ch.isLetter || ch.isNumber { out.append(ch) } else { break }
        }
        return out.isEmpty ? nil : out
    }

    /// Find a clearly labeled PIN. Looks for the label and takes the code
    /// after it on the same line ("PIN: 4821"), or the whole of the next
    /// line, which is how it lands when the label sits above a scratch-off
    /// panel. `excluding` keeps us from returning the card number itself.
    static func pin(in lines: [String], excluding number: String) -> String {
        guard let rx = pinLabel else { return "" }
        let exclude = digits(number)

        for (i, line) in lines.enumerated() {
            let ns = line as NSString
            guard let m = rx.firstMatch(
                in: line, options: [],
                range: NSRange(location: 0, length: ns.length)
            ) else { continue }

            let tailStart = m.range.location + m.range.length
            if tailStart < ns.length {
                let tail = ns.substring(from: tailStart)
                    .trimmingCharacters(in: .whitespaces)
                if let code = leadingCode(tail), isPlausiblePin(code),
                   exclude.isEmpty || digits(code) != exclude {
                    return code
                }
            }

            if i + 1 < lines.count {
                let next = lines[i + 1].trimmingCharacters(in: .whitespaces)
                if isPlausiblePin(next),
                   exclude.isEmpty || digits(next) != exclude {
                    return next
                }
            }
        }
        return ""
    }

    // MARK: Segmentation

    /// Labels meaning "the number after me is the CARD number". When a card
    /// says so, believe it over any length heuristic.
    private static let cardLabel = try? NSRegularExpression(
        pattern: "\\b(?:card|acct|account|gift\\s*card)\\s*(?:#|№|nos?\\b|no\\.|number|num\\b)",
        options: [.caseInsensitive]
    )

    private static func matches(_ rx: NSRegularExpression?, _ s: String) -> Bool {
        guard let rx else { return false }
        return rx.firstMatch(in: s, options: [], range: NSRange(location: 0, length: (s as NSString).length)) != nil
    }

    /// If `s` is nothing but equal-length digit groups of at most 5
    /// ("1234", "1234 5678"), the group length; otherwise 0. This is what
    /// separates a card number printed with airy tracking from two fields.
    private static func groupLength(_ s: String) -> Int {
        let parts = s.split(separator: " ", omittingEmptySubsequences: false).map(String.init)
        guard !parts.isEmpty else { return 0 }
        guard parts.allSatisfy({ !$0.isEmpty && $0.allSatisfy(\.isNumber) }) else { return 0 }
        let n = parts[0].count
        guard n <= 5, parts.allSatisfy({ $0.count == n }) else { return 0 }
        return n
    }

    /// Split one visual line into fields at wide gaps, then re-join runs
    /// that are really one grouped number.
    static func segmentLine(_ line: String) -> [String] {
        // Two or more spaces is a field boundary, and so is a tab. A single
        // space is grouping inside one number ("6011 5000 1234 5678").
        var raw: [String] = []
        var current = ""
        var run = 0
        for ch in line {
            if ch == "\t" || ch == " " || ch.isWhitespace {
                run += (ch == "\t") ? 2 : 1
                continue
            }
            if run >= 2 {
                if !current.isEmpty { raw.append(current) }
                current = ""
            } else if run == 1, !current.isEmpty {
                current += " "
            }
            run = 0
            current.append(ch)
        }
        if !current.isEmpty { raw.append(current) }

        var out: [String] = []
        for seg in raw {
            let trimmed = seg.trimmingCharacters(in: .whitespaces)
            guard !trimmed.isEmpty else { continue }
            let g = groupLength(trimmed)
            if g > 0, let prev = out.last, groupLength(prev) == g {
                out[out.count - 1] = prev + " " + trimmed
            } else {
                out.append(trimmed)
            }
        }
        return out
    }

    struct ParsedFields {
        var number = ""
        var pin = ""
        var numberFromLabel = false
    }

    private struct Segment {
        let text: String
        let digits: String
        let lineIndex: Int
        let position: Int
    }

    /// Resolve the card number and PIN together — segmentation decides both,
    /// so they cannot be worked out independently.
    ///
    /// Number precedence: a barcode payload, then a run the card labels
    /// "Card #", then the longest remaining digit run.
    /// PIN precedence: a labeled PIN, then a separate shorter run sitting
    /// after the number on the same line.
    static func parseFields(barcode: String?, lines rawLines: [String]) -> ParsedFields {
        let lines = rawLines
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        var segs: [Segment] = []
        for (li, line) in lines.enumerated() {
            for (pos, text) in segmentLine(line).enumerated() {
                segs.append(Segment(text: text, digits: digits(text), lineIndex: li, position: pos))
            }
        }

        func isCardLabeled(_ i: Int) -> Bool {
            let s = segs[i]
            if matches(cardLabel, s.text) { return true }
            // "Card #" can also sit in its own segment before the digits.
            guard i > 0 else { return false }
            let prev = segs[i - 1]
            return prev.lineIndex == s.lineIndex && prev.digits.isEmpty && matches(cardLabel, prev.text)
        }

        let pinLabeled = pin(in: lines, excluding: "")
        let pinLabeledDigits = digits(pinLabeled)

        // Resolve where the number sits even when a barcode supplies the
        // value: we still need its position to spot a trailing PIN beside it.
        var numberSeg: Segment?
        var fromLabel = false

        if let idx = segs.indices.first(where: { segs[$0].digits.count >= 6 && isCardLabeled($0) }) {
            numberSeg = segs[idx]
            fromLabel = true
        } else {
            for s in segs where s.digits.count >= 8 {
                if !pinLabeledDigits.isEmpty && s.digits == pinLabeledDigits { continue }
                if numberSeg == nil || s.digits.count > numberSeg!.digits.count { numberSeg = s }
            }
        }

        var out = ParsedFields()
        out.numberFromLabel = fromLabel
        if let b = barcode, !b.isEmpty {
            out.number = b
        } else if let seg = numberSeg {
            out.number = seg.digits
        }

        out.pin = pinLabeled
        if out.pin.isEmpty, let seg = numberSeg {
            // A separate, shorter run after the number on the same line. On
            // a card reading "Card #1234567890   18934" this is the PIN, and
            // the gap is the only thing that says so.
            if let trailing = segs.first(where: {
                $0.lineIndex == seg.lineIndex
                    && $0.position > seg.position
                    && $0.digits.count >= 3
                    && $0.digits.count <= 10
                    && $0.digits.count < seg.digits.count
            }) {
                out.pin = trailing.digits
            }
        }

        if !out.pin.isEmpty, !out.number.isEmpty, digits(out.pin) == digits(out.number) {
            out.pin = ""
        }
        return out
    }

    /// A hint only. JS gates this through the known-merchant list before
    /// anything reaches the merchant field, so a fine-print line here is
    /// harmless — it simply will not match.
    static func merchantGuess(from lines: [String]) -> String {
        lines
            .filter { line in
                let d = digits(line).count
                return line.count >= 3 && d * 2 <= line.count
            }
            .max(by: { $0.count < $1.count }) ?? ""
    }
}

/// Everything a scan resolved. Built live, then reconciled against the
/// still frame taken at commit time.
struct ScanFields {
    /// Where the number came from, which decides whether the still frame is
    /// allowed to overrule it.
    enum NumberSource {
        case none
        case text      // longest digit run — a guess, and overrulable
        case label     // "Card #…" — still a reading of one frame
        case barcode   // exact payload
        case userTap   // the user pointed at it
    }

    var number = ""
    var pin = ""
    var barcode = ""
    var barcodeFormat = ""
    var merchantGuess = ""
    var textLines: [String] = []
    var numberSource: NumberSource = .none

    var hasAnything: Bool {
        !number.isEmpty || !pin.isEmpty || !barcode.isEmpty
    }

    /// Reconcile the live reading with the still frame captured on commit.
    ///
    /// The still frame gets a full-resolution, motion-free look at the card,
    /// so when the two disagree about the NUMBER it is the better witness
    /// and wins. Two exceptions: a barcode payload is exact, and a number
    /// the user tapped is an explicit choice — neither is second-guessed.
    ///
    /// Segmentation decides the number and the PIN together, so a disagreement
    /// carries the still frame's PIN across with it. A PIN the still frame
    /// simply did not see is kept rather than cleared: it is far more likely
    /// a recognition miss than a segmentation disagreement, and the field is
    /// visible and optional, so the user can clear it. Silently losing a
    /// correct PIN is the worse failure.
    func merging(fallback: ScanFields) -> ScanFields {
        var out = self

        let overrulable = out.numberSource == .text || out.numberSource == .label
        if overrulable, !fallback.number.isEmpty, fallback.number != out.number {
            out.number = fallback.number
            out.numberSource = fallback.numberSource
            if !fallback.pin.isEmpty { out.pin = fallback.pin }
        }

        if out.number.isEmpty {
            out.number = fallback.number
            out.numberSource = fallback.numberSource
        }
        if out.pin.isEmpty { out.pin = fallback.pin }
        if out.barcode.isEmpty { out.barcode = fallback.barcode }
        if out.barcodeFormat.isEmpty { out.barcodeFormat = fallback.barcodeFormat }
        if out.merchantGuess.isEmpty { out.merchantGuess = fallback.merchantGuess }
        if out.textLines.isEmpty { out.textLines = fallback.textLines }
        return out
    }

    func asDictionary(imageBase64: String?) -> [String: Any] {
        var r: [String: Any] = ["textLines": textLines]
        if !number.isEmpty { r["number"] = number }
        if !pin.isEmpty { r["pin"] = pin }
        if !barcode.isEmpty { r["barcode"] = barcode }
        if !barcodeFormat.isEmpty { r["barcodeFormat"] = barcodeFormat }
        if !merchantGuess.isEmpty { r["merchantGuess"] = merchantGuess }
        if let b64 = imageBase64 { r["imageBase64"] = b64 }
        return r
    }
}

// MARK: - Plugin

@objc(StashScannerPlugin)
public class StashScannerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StashScannerPlugin"
    public let jsName = "StashScanner"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scanLive", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scanImage", returnType: CAPPluginReturnPromise)
    ]

    // Prints once at startup if the plugin registered with Capacitor.
    override public func load() {
        print("📇 StashScanner: plugin loaded ✅")
    }

    @objc func isAvailable(_ call: CAPPluginCall) {
        guard #available(iOS 16.0, *) else {
            call.resolve(["available": false])
            return
        }
        Task { @MainActor in
            let ok = DataScannerViewController.isSupported && DataScannerViewController.isAvailable
            call.resolve(["available": ok])
        }
    }

    @objc func scanImage(_ call: CAPPluginCall) {
        guard let b64 = call.getString("base64"),
              let data = Data(base64Encoded: b64),
              let image = UIImage(data: data) else {
            call.reject("Invalid image")
            return
        }
        analyze(image: image) { fields, b64 in
            call.resolve(fields.asDictionary(imageBase64: b64))
        }
    }

    @objc func scanLive(_ call: CAPPluginCall) {
        print("📇 StashScanner: scanLive() called")
        guard #available(iOS 16.0, *) else {
            call.reject("Live scan requires iOS 16")
            return
        }
        Task { @MainActor in
            guard DataScannerViewController.isSupported else {
                print("📇 StashScanner: DataScanner NOT supported on this device")
                call.reject("Scanner not supported on this device")
                return
            }

            // Explicitly request camera permission FIRST — this is what
            // triggers the iOS prompt (and adds the Camera row in Settings).
            // DataScannerViewController.isAvailable stays false until this is
            // granted, so we must not gate on it before asking.
            let status = AVCaptureDevice.authorizationStatus(for: .video)
            print("📇 StashScanner: camera auth status = \(status.rawValue) (0=notDetermined,1=restricted,2=denied,3=authorized)")
            if status == .notDetermined {
                let granted = await AVCaptureDevice.requestAccess(for: .video)
                print("📇 StashScanner: camera permission granted = \(granted)")
                if !granted { call.reject("Camera permission denied"); return }
            } else if status == .denied || status == .restricted {
                call.reject("Camera permission denied")
                return
            }

            guard DataScannerViewController.isAvailable else {
                print("📇 StashScanner: DataScanner not available even after permission")
                call.reject("Scanner unavailable")
                return
            }
            guard let presenter = self.bridge?.viewController else {
                call.reject("No presenter view controller")
                return
            }

            print("📇 StashScanner: presenting live scanner")
            // The coordinator keeps itself alive while presented.
            let coordinator = LiveScanCoordinator(
                // `live` is what the user watched being highlighted. The
                // still frame is only a backstop for fields the live pass
                // never resolved, plus the card photo.
                onCommit: { [weak self] live, still in
                    guard let self else { return }
                    guard let still else {
                        call.resolve(live.asDictionary(imageBase64: nil))
                        return
                    }
                    self.analyze(image: still) { fallback, b64 in
                        call.resolve(live.merging(fallback: fallback).asDictionary(imageBase64: b64))
                    }
                },
                onCancel: {
                    call.reject("cancelled", "cancelled")
                }
            )
            coordinator.present(from: presenter)
        }
    }

    // MARK: - Still-frame Vision analysis (barcode + OCR)
    // Used by the "From photos" path, and as the backstop at commit time.

    private func analyze(image: UIImage, completion: @escaping (ScanFields, String?) -> Void) {
        guard let cg = image.cgImage else {
            completion(ScanFields(), jpegBase64(image))
            return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            let barcodeReq = VNDetectBarcodesRequest()
            let textReq = VNRecognizeTextRequest()
            textReq.recognitionLevel = .accurate
            textReq.usesLanguageCorrection = false

            let handler = VNImageRequestHandler(cgImage: cg, options: [:])
            try? handler.perform([barcodeReq, textReq])

            // Best barcode by confidence.
            var barcode = ""
            var barcodeFormat = ""
            if let best = barcodeReq.results?.max(by: { $0.confidence < $1.confidence }),
               let payload = best.payloadStringValue, !payload.isEmpty {
                barcode = payload
                barcodeFormat = best.symbology.rawValue
            }

            // Rebuild visual lines from the observations rather than taking
            // each one as a line of its own. Vision splits a still image at
            // wide gaps, so "Card #1234567890   18934" arrives as two
            // observations; regrouping them by position and preserving the
            // gap is what lets the parser see one line with two fields —
            // and is what makes this path agree with the live one.
            // Vision's origin is bottom-left, so flip y to top-down.
            let positioned: [PositionedText] = (textReq.results ?? []).compactMap { obs in
                guard let t = obs.topCandidates(1).first?.string else { return nil }
                let trimmed = t.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !trimmed.isEmpty else { return nil }
                let bb = obs.boundingBox
                let rect = CGRect(x: bb.minX, y: 1 - bb.maxY, width: bb.width, height: bb.height)
                return PositionedText(text: trimmed, rect: rect)
            }
            let lines = CardTextParser.visualLines(from: positioned)
            let parsed = CardTextParser.parseFields(barcode: barcode, lines: lines)

            var fields = ScanFields()
            fields.textLines = lines
            fields.barcode = barcode
            fields.barcodeFormat = barcodeFormat
            fields.pin = parsed.pin
            fields.number = parsed.number
            fields.numberSource = !barcode.isEmpty
                ? .barcode
                : (parsed.number.isEmpty ? .none : (parsed.numberFromLabel ? .label : .text))
            fields.merchantGuess = CardTextParser.merchantGuess(from: lines)

            let b64 = self.jpegBase64(image)
            DispatchQueue.main.async { completion(fields, b64) }
        }
    }

    // Downscale + JPEG-encode the captured card image (kept small for storage).
    private func jpegBase64(_ image: UIImage, maxDim: CGFloat = 1400, quality: CGFloat = 0.8) -> String? {
        let size = image.size
        guard size.width > 0, size.height > 0 else { return nil }
        let scale = min(1, maxDim / max(size.width, size.height))
        let newSize = CGSize(width: size.width * scale, height: size.height * scale)
        let renderer = UIGraphicsImageRenderer(size: newSize)
        let resized = renderer.image { _ in image.draw(in: CGRect(origin: .zero, size: newSize)) }
        return resized.jpegData(compressionQuality: quality)?.base64EncodedString()
    }
}

// MARK: - Card framing guide

/// Dims everything outside a card-shaped window and draws corner brackets
/// on it, so the user knows where to hold the card. Purely decorative and
/// non-interactive — taps pass through to the scanner so tapping a
/// highlighted item still works.
@available(iOS 16.0, *)
final class CardGuideView: UIView {
    // ISO/IEC 7810 ID-1: 85.60mm x 53.98mm.
    private let cardAspect: CGFloat = 85.60 / 53.98

    private let dimLayer = CAShapeLayer()
    private let frameLayer = CAShapeLayer()

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        backgroundColor = .clear

        dimLayer.fillRule = .evenOdd
        dimLayer.fillColor = UIColor.black.withAlphaComponent(0.45).cgColor
        layer.addSublayer(dimLayer)

        frameLayer.fillColor = UIColor.clear.cgColor
        frameLayer.strokeColor = UIColor(red: 0.698, green: 0.953, blue: 0.196, alpha: 0.95).cgColor // Stash Lime
        frameLayer.lineWidth = 3
        frameLayer.lineCap = .round
        layer.addSublayer(frameLayer)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    /// The card window, in this view's coordinates. Sat a little above
    /// centre so it clears the status readout and capture button.
    var cardRect: CGRect {
        let inset: CGFloat = 24
        let w = min(bounds.width - inset * 2, 440)
        let h = w / cardAspect
        let x = (bounds.width - w) / 2
        let y = (bounds.height - h) / 2 - bounds.height * 0.08
        return CGRect(x: x, y: max(y, inset), width: w, height: h)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let radius: CGFloat = 16
        let card = cardRect

        let dim = UIBezierPath(rect: bounds)
        dim.append(UIBezierPath(roundedRect: card, cornerRadius: radius))
        dimLayer.path = dim.cgPath
        dimLayer.frame = bounds

        // Corner brackets rather than a full outline: less visual noise
        // over the card, and it still reads as "put it here".
        let len = min(card.width, card.height) * 0.16
        let p = UIBezierPath()
        let corners: [(CGPoint, CGPoint, CGPoint)] = [
            (CGPoint(x: card.minX, y: card.minY + len), CGPoint(x: card.minX, y: card.minY), CGPoint(x: card.minX + len, y: card.minY)),
            (CGPoint(x: card.maxX - len, y: card.minY), CGPoint(x: card.maxX, y: card.minY), CGPoint(x: card.maxX, y: card.minY + len)),
            (CGPoint(x: card.maxX, y: card.maxY - len), CGPoint(x: card.maxX, y: card.maxY), CGPoint(x: card.maxX - len, y: card.maxY)),
            (CGPoint(x: card.minX + len, y: card.maxY), CGPoint(x: card.minX, y: card.maxY), CGPoint(x: card.minX, y: card.maxY - len)),
        ]
        for (a, b, c) in corners {
            p.move(to: a)
            p.addLine(to: b)
            p.addLine(to: c)
        }
        frameLayer.path = p.cgPath
        frameLayer.frame = bounds
    }
}

// MARK: - Live scanner (VisionKit DataScannerViewController)

@available(iOS 16.0, *)
@MainActor
final class LiveScanCoordinator: NSObject, DataScannerViewControllerDelegate {
    private let onCommit: (ScanFields, UIImage?) -> Void
    private let onCancel: () -> Void

    private var scanner: DataScannerViewController?
    private var handled = false
    private var selfRetain: LiveScanCoordinator?

    /// Everything currently on screen, keyed by VisionKit's stable id.
    private var items: [RecognizedItem.ID: RecognizedItem] = [:]
    /// Set when the user taps a highlight to correct what we picked.
    private var numberOverride: String?
    private var live = ScanFields()

    // Overlay
    private let guideView = CardGuideView()
    private let hintLabel = UILabel()
    private let statusStack = UIStackView()
    private let numberRow = UILabel()
    private let pinRow = UILabel()
    private let barcodeRow = UILabel()
    private let captureButton = UIButton(type: .system)

    init(onCommit: @escaping (ScanFields, UIImage?) -> Void, onCancel: @escaping () -> Void) {
        self.onCommit = onCommit
        self.onCancel = onCancel
        super.init()
    }

    func present(from presenter: UIViewController) {
        selfRetain = self // stay alive while on screen

        let scanner = DataScannerViewController(
            recognizedDataTypes: [.barcode(), .text()],
            // .accurate: the fields we care about include fine print PINs.
            qualityLevel: .accurate,
            // Multiple items is the point now — number, PIN and barcode are
            // tracked and highlighted at the same time.
            recognizesMultipleItems: true,
            isHighFrameRateTrackingEnabled: true,
            isPinchToZoomEnabled: true,
            // Our own card guide and status readout replace VisionKit's
            // guidance, which would otherwise collide with them on screen.
            isGuidanceEnabled: false,
            isHighlightingEnabled: true
        )
        scanner.delegate = self
        self.scanner = scanner
        addOverlay(to: scanner)
        presenter.present(scanner, animated: true) {
            do {
                try scanner.startScanning()
            } catch {
                print("📇 StashScanner: startScanning failed — \(error)")
            }
        }
    }

    // MARK: Overlay

    private func addOverlay(to scanner: DataScannerViewController) {
        // The guide goes into overlayContainerView at index 0 so VisionKit's
        // own item highlights continue to draw above it.
        guideView.translatesAutoresizingMaskIntoConstraints = false
        scanner.overlayContainerView.insertSubview(guideView, at: 0)
        NSLayoutConstraint.activate([
            guideView.topAnchor.constraint(equalTo: scanner.overlayContainerView.topAnchor),
            guideView.bottomAnchor.constraint(equalTo: scanner.overlayContainerView.bottomAnchor),
            guideView.leadingAnchor.constraint(equalTo: scanner.overlayContainerView.leadingAnchor),
            guideView.trailingAnchor.constraint(equalTo: scanner.overlayContainerView.trailingAnchor),
        ])

        hintLabel.text = "Line up the card"
        hintLabel.font = .systemFont(ofSize: 15, weight: .medium)
        hintLabel.textColor = .white
        hintLabel.textAlignment = .center
        hintLabel.numberOfLines = 2
        hintLabel.translatesAutoresizingMaskIntoConstraints = false

        for row in [numberRow, pinRow, barcodeRow] {
            row.font = .monospacedDigitSystemFont(ofSize: 15, weight: .semibold)
            row.textColor = .white
            row.numberOfLines = 1
            row.lineBreakMode = .byTruncatingMiddle
            row.isHidden = true
        }

        statusStack.axis = .vertical
        statusStack.spacing = 4
        statusStack.alignment = .leading
        statusStack.isLayoutMarginsRelativeArrangement = true
        statusStack.layoutMargins = UIEdgeInsets(top: 12, left: 16, bottom: 12, right: 16)
        statusStack.backgroundColor = UIColor.black.withAlphaComponent(0.55)
        statusStack.layer.cornerRadius = 14
        statusStack.translatesAutoresizingMaskIntoConstraints = false
        statusStack.addArrangedSubview(numberRow)
        statusStack.addArrangedSubview(pinRow)
        statusStack.addArrangedSubview(barcodeRow)
        statusStack.isHidden = true

        captureButton.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
        captureButton.setTitleColor(UIColor(red: 0.098, green: 0.071, blue: 0.239, alpha: 1), for: .normal) // #19123D
        captureButton.backgroundColor = UIColor(red: 0.698, green: 0.953, blue: 0.196, alpha: 1) // Stash Lime
        captureButton.layer.cornerRadius = 26
        captureButton.translatesAutoresizingMaskIntoConstraints = false
        captureButton.addTarget(self, action: #selector(captureTapped), for: .touchUpInside)

        let close = UIButton(type: .system)
        close.setTitle("Cancel", for: .normal)
        close.titleLabel?.font = .systemFont(ofSize: 17, weight: .medium)
        close.setTitleColor(.white, for: .normal)
        close.translatesAutoresizingMaskIntoConstraints = false
        close.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)

        scanner.view.addSubview(hintLabel)
        scanner.view.addSubview(statusStack)
        scanner.view.addSubview(captureButton)
        scanner.view.addSubview(close)

        let g = scanner.view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            close.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 18),
            close.topAnchor.constraint(equalTo: g.topAnchor, constant: 12),

            captureButton.centerXAnchor.constraint(equalTo: g.centerXAnchor),
            captureButton.bottomAnchor.constraint(equalTo: g.bottomAnchor, constant: -28),
            captureButton.heightAnchor.constraint(equalToConstant: 52),
            captureButton.widthAnchor.constraint(equalToConstant: 240),

            statusStack.centerXAnchor.constraint(equalTo: g.centerXAnchor),
            statusStack.bottomAnchor.constraint(equalTo: captureButton.topAnchor, constant: -14),
            statusStack.leadingAnchor.constraint(greaterThanOrEqualTo: g.leadingAnchor, constant: 20),
            statusStack.trailingAnchor.constraint(lessThanOrEqualTo: g.trailingAnchor, constant: -20),

            hintLabel.centerXAnchor.constraint(equalTo: g.centerXAnchor),
            hintLabel.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 32),
            hintLabel.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -32),
            hintLabel.bottomAnchor.constraint(equalTo: statusStack.topAnchor, constant: -12),
        ])

        refresh()
    }

    // MARK: Live recognition

    func dataScanner(_ dataScanner: DataScannerViewController,
                     didAdd addedItems: [RecognizedItem],
                     allItems: [RecognizedItem]) {
        for item in addedItems { items[item.id] = item }
        refresh()
    }

    func dataScanner(_ dataScanner: DataScannerViewController,
                     didUpdate updatedItems: [RecognizedItem],
                     allItems: [RecognizedItem]) {
        for item in updatedItems { items[item.id] = item }
        refresh()
    }

    func dataScanner(_ dataScanner: DataScannerViewController,
                     didRemove removedItems: [RecognizedItem],
                     allItems: [RecognizedItem]) {
        for item in removedItems { items.removeValue(forKey: item.id) }
        refresh()
    }

    /// Tapping a highlight corrects our pick. This is the escape hatch for
    /// a card where the longest digit run is not the number the user wants.
    func dataScanner(_ dataScanner: DataScannerViewController, didTapOn item: RecognizedItem) {
        switch item {
        case .text(let text):
            numberOverride = text.transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        case .barcode(let code):
            numberOverride = code.payloadStringValue
        @unknown default:
            break
        }
        UISelectionFeedbackGenerator().selectionChanged()
        refresh()
    }

    /// Recompute the live fields from everything currently recognized and
    /// push that into the status readout.
    private func refresh() {
        // VisionKit hands us ONE item per visual line, so a line carrying
        // both a number and a PIN arrives as a single transcript. Position
        // each item and rebuild lines the same way the still path does; the
        // wide gap inside the transcript survives into segmentLine.
        let viewSize = scanner?.view.bounds.size ?? .zero
        let w = max(viewSize.width, 1)
        let h = max(viewSize.height, 1)

        var positioned: [PositionedText] = []
        var barcode = ""
        var barcodeFormat = ""

        for item in items.values {
            let b = item.bounds
            let minX = min(b.topLeft.x, b.bottomLeft.x)
            let maxX = max(b.topRight.x, b.bottomRight.x)
            let minY = min(b.topLeft.y, b.topRight.y)
            let maxY = max(b.bottomLeft.y, b.bottomRight.y)
            let rect = CGRect(x: minX / w, y: minY / h,
                              width: max(maxX - minX, 0) / w,
                              height: max(maxY - minY, 0) / h)

            switch item {
            case .text(let t):
                let s = t.transcript.trimmingCharacters(in: .whitespacesAndNewlines)
                if !s.isEmpty { positioned.append(PositionedText(text: s, rect: rect)) }
            case .barcode(let code):
                if let payload = code.payloadStringValue, !payload.isEmpty, barcode.isEmpty {
                    barcode = payload
                    barcodeFormat = code.observation.symbology.rawValue
                }
            @unknown default:
                break
            }
        }

        let lines = CardTextParser.visualLines(from: positioned)
        let parsed = CardTextParser.parseFields(barcode: barcode, lines: lines)

        var f = ScanFields()
        f.textLines = lines
        f.barcode = barcode
        f.barcodeFormat = barcodeFormat
        f.pin = parsed.pin
        f.merchantGuess = CardTextParser.merchantGuess(from: lines)

        if let override = numberOverride, !override.isEmpty {
            f.number = override
            f.numberSource = .userTap
        } else {
            f.number = parsed.number
            f.numberSource = !barcode.isEmpty
                ? .barcode
                : (parsed.number.isEmpty ? .none : (parsed.numberFromLabel ? .label : .text))
        }
        live = f

        render(f)
    }

    private func render(_ f: ScanFields) {
        numberRow.text = f.number.isEmpty ? nil : "✓ Number  \(f.number)"
        numberRow.isHidden = f.number.isEmpty

        pinRow.text = f.pin.isEmpty ? nil : "✓ PIN  \(f.pin)"
        pinRow.isHidden = f.pin.isEmpty

        barcodeRow.text = f.barcode.isEmpty ? nil : "✓ Barcode  \(f.barcode)"
        barcodeRow.isHidden = f.barcode.isEmpty

        statusStack.isHidden = !f.hasAnything

        if f.hasAnything {
            hintLabel.text = "Check the highlighted number — tap a different one to correct it."
            captureButton.setTitle("Use these details", for: .normal)
        } else {
            hintLabel.text = "Line up the card"
            captureButton.setTitle("Capture anyway", for: .normal)
        }
    }

    // MARK: Commit / cancel

    @objc private func captureTapped() { commit() }

    @objc private func cancelTapped() {
        guard !handled else { return }
        handled = true
        scanner?.stopScanning()
        scanner?.dismiss(animated: true)
        onCancel()
        selfRetain = nil
    }

    /// Only ever called from the capture button — never automatically. The
    /// user decides when the right values are on screen.
    private func commit() {
        guard !handled, let scanner = scanner else { return }
        handled = true
        let fields = live
        Task { @MainActor in
            let image = try? await scanner.capturePhoto()
            scanner.stopScanning()
            scanner.dismiss(animated: true)
            self.onCommit(fields, image)
            self.selfRetain = nil
        }
    }
}
