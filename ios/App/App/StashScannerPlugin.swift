//
//  StashScannerPlugin.swift
//  Stashly — on-device card scanner (Apple Vision / VisionKit ONLY).
//
//  Exposes to JS (registerPlugin('StashScanner')):
//    isAvailable() -> { available: Bool }
//    scanLive()    -> live viewfinder; resolves a scan result, rejects
//                     "cancelled" if the user backs out.
//    scanImage({ base64 }) -> runs the pipeline over a picked image.
//
//  Result shape (all optional; the JS flow degrades to empty fields):
//    { merchantGuess, number, pin, barcode, barcodeFormat,
//      imageBase64, textLines }
//
//  Nothing leaves the device: all recognition is local Vision/VisionKit.
//
//  ONE PIPELINE. The live viewfinder is GUIDANCE ONLY — highlights and a
//  card-shaped guide, to help the user frame the card. It resolves nothing.
//  On capture we take a full-resolution still and run it through analyze(),
//  the exact same function "From photos" uses. Live recognition never
//  contributes to and never overrides the result.
//
//  This replaced two earlier designs that both failed on real cards:
//
//    1. Auto-capture on the first barcode, then re-analyze a still. The
//       highlights were decorative and the user could not confirm anything
//       before it fired.
//    2. Live results as the answer, with the still as a fallback. VisionKit
//       hands the live scanner one RecognizedItem per visual line and
//       reports bounds in view coordinates, where the card is an unknown
//       fraction of the screen; Vision on a still reports normalized
//       coordinates of a frame the card fills. The same gap threshold
//       therefore meant different things in the two paths, so live capture
//       and photo upload disagreed about the very same card, and live
//       capture disagreed with itself between tries. There was no threshold
//       that fixed that — only one pipeline does.
//
//  Tapping a highlight to override the number is gone with it. It wrote the
//  tapped item's RAW TRANSCRIPT into the number field ("ACCT#: 70123456 789
//  0123456"), was easy to trigger by accident while framing, and was marked
//  as a user choice so nothing downstream would correct it. Mapping a tap on
//  the viewfinder to a region of a separately captured still is not
//  something we can do reliably, so the feature is dropped rather than
//  papered over. CardTextParser.validatedNumber is now the only way any
//  value reaches the number field, and raw line text cannot pass it.
//
//  Concurrency: VisionKit's DataScannerViewController is @MainActor, so
//  every touch of it happens on the main actor. The Vision requests are NOT
//  main-actor and run on a background queue in analyze().
//
//  NOTE: this file and CardTextParser.swift must both be members of the
//  "App" target in Xcode.
//

import Foundation
import Capacitor
import Vision
import VisionKit
import UIKit
import AVFoundation
import CoreGraphics

/// Device-debug logging for the scan pipeline: prints the grouped visual
/// lines, their segments, the chosen fields, and any candidate the number
/// guard rejected — so a device test shows exactly what the parser saw.
///
/// OFF for shipping builds. Flip to true and rebuild when diagnosing a
/// misread on device; the console then carries everything needed to
/// reproduce it, and tools/scan-probe can replay the same photo on a Mac.
///
/// Note what this prints when enabled: real card numbers and PINs, to the
/// Xcode console. That is fine on your own device while debugging and is
/// the other reason it stays off by default.
enum ScanLog {
    static var enabled = false

    static func line(_ s: String) {
        guard enabled else { return }
        print("📇 StashScanner: \(s)")
    }

    static func dump(context: String, lines: [String], parsed: CardTextParser.ParsedFields, barcode: String) {
        guard enabled else { return }
        line("── \(context) ──")
        line("visual lines (\(lines.count)):")
        for (i, l) in lines.enumerated() {
            line("  [\(i)] \(JSONEscaped(l))")
            let segs = CardTextParser.segmentLine(l)
            if segs.count > 1 {
                line("       segments: \(segs.map { JSONEscaped($0) }.joined(separator: " | "))")
            }
        }
        line("barcode: \(barcode.isEmpty ? "(none)" : JSONEscaped(barcode))")
        line("number:  \(parsed.number.isEmpty ? "(none)" : parsed.number)\(parsed.numberFromLabel ? "  [from label]" : "")")
        if !parsed.rejectedNumber.isEmpty {
            line("number REJECTED by guard: \(JSONEscaped(parsed.rejectedNumber))")
        }
        line("pin:     \(parsed.pin.isEmpty ? "(none)" : parsed.pin)")
        line("────────")
    }

    /// Quote a string so trailing spaces and gaps are visible in the log.
    private static func JSONEscaped(_ s: String) -> String {
        "\"\(s.replacingOccurrences(of: "\"", with: "\\\""))\""
    }
}

@objc(StashScannerPlugin)
public class StashScannerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StashScannerPlugin"
    public let jsName = "StashScanner"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scanLive", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scanImage", returnType: CAPPluginReturnPromise)
    ]

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
        analyze(image: image, context: "scanImage (from photos)") { fields, b64 in
            call.resolve(fields.asDictionary(imageBase64: b64))
        }
    }

    @objc func scanLive(_ call: CAPPluginCall) {
        ScanLog.line("scanLive() called")
        guard #available(iOS 16.0, *) else {
            call.reject("Live scan requires iOS 16")
            return
        }
        Task { @MainActor in
            guard DataScannerViewController.isSupported else {
                ScanLog.line("DataScanner NOT supported on this device")
                call.reject("Scanner not supported on this device")
                return
            }

            // Request camera permission FIRST — this is what triggers the iOS
            // prompt. DataScannerViewController.isAvailable stays false until
            // it is granted, so we must not gate on it before asking.
            let status = AVCaptureDevice.authorizationStatus(for: .video)
            ScanLog.line("camera auth status = \(status.rawValue) (0=notDetermined,1=restricted,2=denied,3=authorized)")
            if status == .notDetermined {
                let granted = await AVCaptureDevice.requestAccess(for: .video)
                ScanLog.line("camera permission granted = \(granted)")
                if !granted { call.reject("Camera permission denied"); return }
            } else if status == .denied || status == .restricted {
                call.reject("Camera permission denied")
                return
            }

            guard DataScannerViewController.isAvailable else {
                ScanLog.line("DataScanner not available even after permission")
                call.reject("Scanner unavailable")
                return
            }
            guard let presenter = self.bridge?.viewController else {
                call.reject("No presenter view controller")
                return
            }

            ScanLog.line("presenting live scanner (guidance only)")
            let coordinator = LiveScanCoordinator(
                // The still is the ONLY input to the result.
                onCapture: { [weak self] still in
                    guard let self else { return }
                    guard let still else {
                        ScanLog.line("capturePhoto returned no image — resolving empty")
                        call.resolve(ScanFields().asDictionary(imageBase64: nil))
                        return
                    }
                    self.analyze(image: still, context: "scanLive (captured still)") { fields, b64 in
                        call.resolve(fields.asDictionary(imageBase64: b64))
                    }
                },
                onCancel: {
                    call.reject("cancelled", "cancelled")
                }
            )
            coordinator.present(from: presenter)
        }
    }

    // MARK: - The one pipeline
    //
    // Both scanImage (photo upload) and scanLive (captured still) call this.
    // There is no second implementation to drift.

    private func analyze(image: UIImage, context: String, completion: @escaping (ScanFields, String?) -> Void) {
        guard let cg = image.cgImage else {
            ScanLog.line("\(context): image had no CGImage")
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

            var barcode = ""
            var barcodeFormat = ""
            if let best = barcodeReq.results?.max(by: { $0.confidence < $1.confidence }),
               let payload = best.payloadStringValue, !payload.isEmpty {
                barcode = payload
                barcodeFormat = best.symbology.rawValue
            }

            // Vision's origin is bottom-left and normalized to the image;
            // flip y so the parser sees a top-down page.
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

            let lines = CardTextParser.visualLines(from: positioned)
            let parsed = CardTextParser.parseFields(barcode: barcode, lines: lines)
            ScanLog.dump(context: context, lines: lines, parsed: parsed, barcode: barcode)

            var fields = ScanFields()
            fields.textLines = lines
            fields.barcode = barcode
            fields.barcodeFormat = barcodeFormat
            fields.number = parsed.number
            fields.pin = parsed.pin
            fields.merchantGuess = CardTextParser.merchantGuess(from: lines)

            let b64 = self.jpegBase64(image)
            if b64 == nil { ScanLog.line("\(context): failed to encode card photo") }
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

/// Dims everything outside a card-shaped window and draws corner brackets on
/// it. Non-interactive: taps pass through to the scanner.
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
        let card = cardRect

        let dim = UIBezierPath(rect: bounds)
        dim.append(UIBezierPath(roundedRect: card, cornerRadius: 16))
        dimLayer.path = dim.cgPath
        dimLayer.frame = bounds

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

// MARK: - Live scanner (guidance only)

@available(iOS 16.0, *)
@MainActor
final class LiveScanCoordinator: NSObject, DataScannerViewControllerDelegate {
    private let onCapture: (UIImage?) -> Void
    private let onCancel: () -> Void

    private var scanner: DataScannerViewController?
    private var handled = false
    private var selfRetain: LiveScanCoordinator?

    /// Count of currently recognized items. Used ONLY to word the on-screen
    /// hint — it never contributes to the result.
    private var recognizedCount = 0

    private let guideView = CardGuideView()
    private let hintLabel = UILabel()
    private let captureButton = UIButton(type: .system)

    init(onCapture: @escaping (UIImage?) -> Void, onCancel: @escaping () -> Void) {
        self.onCapture = onCapture
        self.onCancel = onCancel
        super.init()
    }

    func present(from presenter: UIViewController) {
        selfRetain = self // stay alive while on screen

        let scanner = DataScannerViewController(
            recognizedDataTypes: [.barcode(), .text()],
            qualityLevel: .balanced,
            recognizesMultipleItems: true,
            isHighFrameRateTrackingEnabled: true,
            isPinchToZoomEnabled: true,
            // Our own card guide replaces VisionKit's guidance, which would
            // otherwise collide with it on screen.
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
                ScanLog.line("startScanning failed — \(error)")
            }
        }
    }

    private func addOverlay(to scanner: DataScannerViewController) {
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

        captureButton.setTitle("Capture", for: .normal)
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

            hintLabel.centerXAnchor.constraint(equalTo: g.centerXAnchor),
            hintLabel.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 32),
            hintLabel.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -32),
            hintLabel.bottomAnchor.constraint(equalTo: captureButton.topAnchor, constant: -18),
        ])
    }

    // MARK: Guidance

    // Highlights are drawn by VisionKit. We only count items so the hint can
    // tell the user whether the card is being seen at all. Nothing here
    // reaches the result — the still decides everything.

    func dataScanner(_ dataScanner: DataScannerViewController,
                     didAdd addedItems: [RecognizedItem],
                     allItems: [RecognizedItem]) {
        recognizedCount = allItems.count
        renderHint()
    }

    func dataScanner(_ dataScanner: DataScannerViewController,
                     didRemove removedItems: [RecognizedItem],
                     allItems: [RecognizedItem]) {
        recognizedCount = allItems.count
        renderHint()
    }

    private func renderHint() {
        hintLabel.text = recognizedCount > 0
            ? "Fill the frame with the card, then capture."
            : "Line up the card"
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

    /// Take the full-resolution still and hand it off. Everything the user
    /// sees on the confirm screen comes from this image.
    private func commit() {
        guard !handled, let scanner = scanner else { return }
        handled = true
        captureButton.isEnabled = false
        captureButton.setTitle("Capturing…", for: .normal)

        Task { @MainActor in
            // capturePhoto can fail transiently when the capture session has
            // not fully settled. It used to be swallowed by `try?`, which is
            // why the confirm screen could come back with no photo and no
            // explanation. Now it is logged, and retried once — and since the
            // still is the ONLY source of the result, a failure here means an
            // empty confirm screen rather than a wrong one.
            var image: UIImage?
            for attempt in 1...2 {
                do {
                    image = try await scanner.capturePhoto()
                    ScanLog.line("captured still \(Int(image?.size.width ?? 0))x\(Int(image?.size.height ?? 0)) (attempt \(attempt))")
                    break
                } catch {
                    ScanLog.line("capturePhoto FAILED (attempt \(attempt)) — \(error)")
                    if attempt == 1 {
                        try? await Task.sleep(nanoseconds: 250_000_000)
                    }
                }
            }
            scanner.stopScanning()
            scanner.dismiss(animated: true)
            self.onCapture(image)
            self.selfRetain = nil
        }
    }
}
