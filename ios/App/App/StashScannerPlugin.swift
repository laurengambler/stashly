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

/// Pulls card fields out of recognized text. Pure and nonisolated so the
/// live scanner (main actor) and the Vision still pass (background queue)
/// can both use it, and so the two paths can never disagree about what a
/// PIN looks like.
enum CardTextParser {

    static func digits(_ s: String) -> String {
        String(s.filter { $0.isNumber })
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

    /// The card number. A barcode payload is authoritative when present —
    /// it is the number, precisely, and it keeps any letters (some gift
    /// cards are alphanumeric). Otherwise the longest digit run in the text.
    static func number(barcode: String?, lines: [String], pin: String) -> String {
        if let b = barcode, !b.isEmpty { return b }
        let pinDigits = digits(pin)
        let best = lines
            .map { digits($0) }
            .filter { $0.count >= 8 && (pinDigits.isEmpty || $0 != pinDigits) }
            .max(by: { $0.count < $1.count })
        return best ?? ""
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

/// Everything a scan resolved. Built live, then topped up from the still
/// frame for anything the live pass never saw.
struct ScanFields {
    var number = ""
    var pin = ""
    var barcode = ""
    var barcodeFormat = ""
    var merchantGuess = ""
    var textLines: [String] = []

    var hasAnything: Bool {
        !number.isEmpty || !pin.isEmpty || !barcode.isEmpty
    }

    /// Fill only what is still empty. Live wins over the still frame.
    func merging(fallback: ScanFields) -> ScanFields {
        var out = self
        if out.number.isEmpty { out.number = fallback.number }
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

            // OCR lines in reading order (top to bottom) so the "PIN label
            // sits above the code" rule in CardTextParser.pin works here too.
            // Vision's origin is bottom-left, hence the descending sort.
            let observations = (textReq.results ?? []).sorted {
                $0.boundingBox.origin.y > $1.boundingBox.origin.y
            }
            let lines: [String] = observations.compactMap {
                guard let t = $0.topCandidates(1).first?.string else { return nil }
                let trimmed = t.trimmingCharacters(in: .whitespacesAndNewlines)
                return trimmed.isEmpty ? nil : trimmed
            }

            var fields = ScanFields()
            fields.textLines = lines
            fields.barcode = barcode
            fields.barcodeFormat = barcodeFormat
            fields.pin = CardTextParser.pin(in: lines, excluding: barcode)
            fields.number = CardTextParser.number(barcode: barcode, lines: lines, pin: fields.pin)
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
        var texts: [(String, CGFloat, CGFloat)] = [] // transcript, y, x
        var barcode = ""
        var barcodeFormat = ""

        for item in items.values {
            switch item {
            case .text(let t):
                let s = t.transcript.trimmingCharacters(in: .whitespacesAndNewlines)
                if !s.isEmpty {
                    texts.append((s, item.bounds.topLeft.y, item.bounds.topLeft.x))
                }
            case .barcode(let b):
                if let payload = b.payloadStringValue, !payload.isEmpty, barcode.isEmpty {
                    barcode = payload
                    barcodeFormat = b.observation.symbology.rawValue
                }
            @unknown default:
                break
            }
        }

        // Reading order: top to bottom, then left to right. The PIN rule
        // depends on a label line preceding its code.
        texts.sort { $0.1 == $1.1 ? $0.2 < $1.2 : $0.1 < $1.1 }
        let lines = texts.map { $0.0 }

        var f = ScanFields()
        f.textLines = lines
        f.barcode = barcode
        f.barcodeFormat = barcodeFormat
        f.pin = CardTextParser.pin(in: lines, excluding: barcode)
        f.number = numberOverride ?? CardTextParser.number(barcode: barcode, lines: lines, pin: f.pin)
        f.merchantGuess = CardTextParser.merchantGuess(from: lines)
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
