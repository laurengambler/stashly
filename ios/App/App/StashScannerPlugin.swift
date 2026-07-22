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
//    { merchantGuess, number, barcode, barcodeFormat, imageBase64, textLines }
//
//  Nothing leaves the device: all recognition is local Vision/VisionKit.
//
//  Concurrency: VisionKit's DataScannerViewController is @MainActor, so every
//  touch of it happens on the main actor (Task { @MainActor } here, and the
//  LiveScanCoordinator class is @MainActor). The Vision framework requests
//  (VNImageRequestHandler etc.) are NOT main-actor and run on a background
//  queue in analyze().
//
//  NOTE: this file must be a member of the "App" target in Xcode (it
//  auto-registers with Capacitor via CAPBridgedPlugin once compiled).
//

import Foundation
import Capacitor
import Vision
import VisionKit
import UIKit

@objc(StashScannerPlugin)
public class StashScannerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StashScannerPlugin"
    public let jsName = "StashScanner"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scanLive", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scanImage", returnType: CAPPluginReturnPromise)
    ]

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
        analyze(image: image) { result in call.resolve(result) }
    }

    @objc func scanLive(_ call: CAPPluginCall) {
        guard #available(iOS 16.0, *) else {
            call.reject("Live scan requires iOS 16")
            return
        }
        Task { @MainActor in
            guard DataScannerViewController.isSupported,
                  DataScannerViewController.isAvailable,
                  let presenter = self.bridge?.viewController else {
                call.reject("Scanner unavailable")
                return
            }
            // The coordinator keeps itself alive while presented.
            let coordinator = LiveScanCoordinator(
                onImage: { image in
                    self.analyze(image: image) { result in call.resolve(result) }
                },
                onCancel: {
                    call.reject("cancelled", "cancelled")
                }
            )
            coordinator.present(from: presenter)
        }
    }

    // MARK: - Shared Vision analysis (barcode + OCR + merchant + image)
    // Nonisolated: Vision framework requests are not main-actor.

    private func analyze(image: UIImage, completion: @escaping ([String: Any]) -> Void) {
        guard let cg = image.cgImage else {
            completion(self.baseResult(image))
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
            var barcode: String?
            var barcodeFormat: String?
            if let best = barcodeReq.results?.max(by: { $0.confidence < $1.confidence }),
               let payload = best.payloadStringValue, !payload.isEmpty {
                barcode = payload
                barcodeFormat = best.symbology.rawValue
            }

            // OCR lines with their (normalized) height so we can rank by size.
            let lines: [(text: String, height: CGFloat)] = (textReq.results ?? []).compactMap {
                guard let t = $0.topCandidates(1).first?.string else { return nil }
                let trimmed = t.trimmingCharacters(in: .whitespacesAndNewlines)
                return trimmed.isEmpty ? nil : (trimmed, $0.boundingBox.height)
            }
            let textLines = lines.map { $0.text }

            let digits = { (s: String) in String(s.filter { $0.isNumber }) }

            // Number: prefer the barcode payload verbatim — "this is the
            // number, precisely" — keeping any letters (some cards are
            // alphanumeric). Fall back to the longest OCR digit run.
            var number = barcode ?? ""
            if number.isEmpty {
                number = lines.map { digits($0.text) }.max(by: { $0.count < $1.count }) ?? ""
            }

            // Merchant: the largest text line that isn't mostly digits.
            let merchant = lines
                .filter { line in
                    let d = digits(line.text).count
                    return line.text.count >= 2 && d <= line.text.count / 2
                }
                .max(by: { $0.height < $1.height })?
                .text

            var result: [String: Any] = ["textLines": textLines]
            if let b = barcode { result["barcode"] = b }
            if let f = barcodeFormat { result["barcodeFormat"] = f }
            if !number.isEmpty { result["number"] = number }
            if let m = merchant, !m.isEmpty { result["merchantGuess"] = m }
            if let b64 = self.jpegBase64(image) { result["imageBase64"] = b64 }

            DispatchQueue.main.async { completion(result) }
        }
    }

    private func baseResult(_ image: UIImage) -> [String: Any] {
        var r: [String: Any] = ["textLines": [String]()]
        if let b64 = jpegBase64(image) { r["imageBase64"] = b64 }
        return r
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

// MARK: - Live scanner (VisionKit DataScannerViewController)

@available(iOS 16.0, *)
@MainActor
final class LiveScanCoordinator: NSObject, DataScannerViewControllerDelegate {
    private let onImage: (UIImage) -> Void
    private let onCancel: () -> Void
    private var scanner: DataScannerViewController?
    private var handled = false
    private var selfRetain: LiveScanCoordinator?

    init(onImage: @escaping (UIImage) -> Void, onCancel: @escaping () -> Void) {
        self.onImage = onImage
        self.onCancel = onCancel
        super.init()
    }

    func present(from presenter: UIViewController) {
        selfRetain = self // stay alive while on screen
        let scanner = DataScannerViewController(
            recognizedDataTypes: [.barcode(), .text()],
            qualityLevel: .balanced,
            recognizesMultipleItems: false,
            isHighFrameRateTrackingEnabled: false,
            isPinchToZoomEnabled: true,
            isGuidanceEnabled: true,
            isHighlightingEnabled: true
        )
        scanner.delegate = self
        self.scanner = scanner
        addOverlay(to: scanner)
        presenter.present(scanner, animated: true) {
            try? scanner.startScanning()
        }
    }

    // A manual capture button (for cards with no barcode) + a close button.
    private func addOverlay(to scanner: DataScannerViewController) {
        let capture = UIButton(type: .system)
        capture.setTitle("Capture", for: .normal)
        capture.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
        capture.setTitleColor(UIColor(red: 0.098, green: 0.071, blue: 0.239, alpha: 1), for: .normal) // #19123D
        capture.backgroundColor = UIColor(red: 0.698, green: 0.953, blue: 0.196, alpha: 1) // Stash Lime
        capture.layer.cornerRadius = 26
        capture.translatesAutoresizingMaskIntoConstraints = false
        capture.addTarget(self, action: #selector(captureTapped), for: .touchUpInside)

        let close = UIButton(type: .system)
        close.setTitle("Cancel", for: .normal)
        close.titleLabel?.font = .systemFont(ofSize: 17, weight: .medium)
        close.setTitleColor(.white, for: .normal)
        close.translatesAutoresizingMaskIntoConstraints = false
        close.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)

        scanner.view.addSubview(capture)
        scanner.view.addSubview(close)
        let g = scanner.view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            capture.centerXAnchor.constraint(equalTo: g.centerXAnchor),
            capture.bottomAnchor.constraint(equalTo: g.bottomAnchor, constant: -28),
            capture.heightAnchor.constraint(equalToConstant: 52),
            capture.widthAnchor.constraint(equalToConstant: 200),
            close.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 18),
            close.topAnchor.constraint(equalTo: g.topAnchor, constant: 12)
        ])
    }

    // Auto-capture the moment a barcode is recognized.
    func dataScanner(_ dataScanner: DataScannerViewController,
                     didAdd addedItems: [RecognizedItem],
                     allItems: [RecognizedItem]) {
        for item in addedItems {
            if case .barcode = item { capture(); return }
        }
    }

    // Tapping a highlighted item also captures.
    func dataScanner(_ dataScanner: DataScannerViewController, didTapOn item: RecognizedItem) {
        capture()
    }

    @objc private func captureTapped() { capture() }

    @objc private func cancelTapped() {
        guard !handled else { return }
        handled = true
        scanner?.stopScanning()
        scanner?.dismiss(animated: true)
        onCancel()
        selfRetain = nil
    }

    private func capture() {
        guard !handled, let scanner = scanner else { return }
        handled = true
        Task { @MainActor in
            let image = try? await scanner.capturePhoto()
            scanner.stopScanning()
            scanner.dismiss(animated: true)
            if let image {
                self.onImage(image)
            } else {
                self.onCancel()
            }
            self.selfRetain = nil
        }
    }
}
