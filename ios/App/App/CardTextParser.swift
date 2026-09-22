//
//  CardTextParser.swift
//  Stashly — turning recognized card text into fields.
//
//  Deliberately free of Capacitor, VisionKit and UIKit: Foundation and
//  CoreGraphics only. That is what lets tools/scan-probe compile this exact
//  source on a Mac and run it over real card photos through real Vision,
//  so the parser can be checked without a device build.
//
//  Mirrors src/lib/scanParse.js. test/scanParse.test.mjs is the shared spec
//  for both — change a rule there and change it in both places.
//
//  ONE ENTRY POINT FOR THE NUMBER. Everything that could ever land in the
//  card-number field goes through validatedNumber(), which accepts a single
//  alphanumeric run and nothing else. Raw line text cannot pass it. This is
//  a guard, not a formatter: it returns "" rather than trying to repair a
//  bad candidate, because a blank field the user fills in beats a field
//  holding a line of fine print they have to notice and clear.
//
//  THE LAYOUT PROBLEM. Cards print more than one field on a line:
//
//      ACCT#: 70123456 789 0123456
//      Card #1234567890        18934
//
//  Reducing a line to its digits fuses whatever shares it. So a wide
//  horizontal gap is treated as a field boundary, while single spaces are
//  grouping inside one number.
//

import Foundation
import CoreGraphics

/// A recognized string with its place on the card, normalized to a
/// top-left origin in 0...1.
struct PositionedText {
    let text: String
    let rect: CGRect
}

/// Everything a scan resolved.
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

enum CardTextParser {

    static func digits(_ s: String) -> String {
        String(s.filter { $0.isNumber })
    }

    // MARK: - The guard

    /// The ONLY way a value reaches the card-number field.
    ///
    /// A card number is a single alphanumeric run: no spaces, no
    /// punctuation, no label, no sentence. Anything else is rejected
    /// outright and the field stays blank.
    static func validatedNumber(_ candidate: String) -> String {
        let s = candidate.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty else { return "" }
        // One run. This is what raw line text fails on.
        guard s.allSatisfy({ $0.isLetter || $0.isNumber }) else { return "" }
        guard s.count >= 6, s.count <= 32 else { return "" }
        // Mostly digits — a word that happens to be one run is not a number.
        let d = digits(s).count
        guard d >= 6, d * 2 >= s.count else { return "" }
        return s
    }

    // MARK: - Visual lines

    /// Rebuild visual lines from positioned text: group fragments sitting at
    /// the same height, order them left to right, and preserve a wide
    /// horizontal gap as a gap in the string so segmentLine can see it.
    ///
    /// Only ever called on a full-frame still, where the card fills the
    /// frame and `gapThreshold` therefore means a consistent fraction of the
    /// card. Running this over a live viewfinder — where the card is some
    /// unknown fraction of the screen — made the same threshold mean
    /// different things frame to frame, which is why live capture and photo
    /// upload used to disagree about the very same card.
    static func visualLines(from items: [PositionedText], gapThreshold: CGFloat = 0.035) -> [String] {
        let clean = items.filter { !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        guard !clean.isEmpty else { return [] }

        let sorted = clean.sorted { $0.rect.midY < $1.rect.midY }
        var groups: [[PositionedText]] = []

        for item in sorted {
            if var last = groups.last, let ref = last.first, sharesLine(ref.rect, item.rect) {
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
                line += (gap > gapThreshold ? "   " : " ")
                line += ordered[i].text.trimmingCharacters(in: .whitespaces)
            }
            return line
        }
    }

    /// Two fragments share a visual line when their vertical extents overlap
    /// by more than half the shorter one.
    private static func sharesLine(_ a: CGRect, _ b: CGRect) -> Bool {
        let overlap = min(a.maxY, b.maxY) - max(a.minY, b.minY)
        guard overlap > 0 else { return false }
        let shorter = min(a.height, b.height)
        guard shorter > 0 else { return false }
        return overlap / shorter > 0.5
    }

    // MARK: - Labels

    /// "The number after me is the CARD number." When a card says so,
    /// believe it over any length heuristic.
    private static let cardLabel = try? NSRegularExpression(
        pattern: "\\b(?:card|acct|account|gift\\s*card)\\s*(?:#|№|nos?\\b|no\\.|number|num\\b)",
        options: [.caseInsensitive]
    )

    /// "What follows is a PIN." Deliberately narrow: only a PIN the card
    /// clearly labels, or one the layout makes obvious (the trailing-run
    /// rule in parseFields).
    private static let pinLabel = try? NSRegularExpression(
        pattern:
            "\\b(?:p\\s*i\\s*n|pin\\s*(?:no|number|code|#)|access\\s*(?:code|number|#)"
            + "|security\\s*code|scratch\\s*(?:off\\s*)?code|redemption\\s*code)\\b[\\s:#.\\-]*",
        options: [.caseInsensitive]
    )

    private static func matches(_ rx: NSRegularExpression?, _ s: String) -> Bool {
        guard let rx else { return false }
        return rx.firstMatch(in: s, options: [], range: NSRange(location: 0, length: (s as NSString).length)) != nil
    }

    // MARK: - PIN

    /// 3-10 alphanumerics, mostly digits. Longer runs are card numbers.
    static func isPlausiblePin(_ raw: String) -> Bool {
        let s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard s.count >= 3, s.count <= 10, s.allSatisfy({ $0.isLetter || $0.isNumber }) else { return false }
        let d = digits(s).count
        return d >= 3 && d * 2 >= s.count
    }

    /// The whole leading alphanumeric run. Deliberately uncapped: stopping
    /// at 10 characters would truncate a 16-digit card number into something
    /// that then passes isPlausiblePin.
    private static func leadingCode(_ s: String) -> String? {
        var out = ""
        for ch in s {
            if ch.isLetter || ch.isNumber { out.append(ch) } else { break }
        }
        return out.isEmpty ? nil : out
    }

    /// Find a clearly labeled PIN: the code after the label on the same
    /// line, or the whole of the next line, which is how it lands when the
    /// label sits above a scratch-off panel.
    static func pin(in lines: [String], excluding number: String) -> String {
        guard let rx = pinLabel else { return "" }
        let exclude = digits(number)

        for (i, line) in lines.enumerated() {
            let ns = line as NSString
            guard let m = rx.firstMatch(in: line, options: [], range: NSRange(location: 0, length: ns.length))
            else { continue }

            let tailStart = m.range.location + m.range.length
            if tailStart < ns.length {
                let tail = ns.substring(from: tailStart).trimmingCharacters(in: .whitespaces)
                if let code = leadingCode(tail), isPlausiblePin(code),
                   exclude.isEmpty || digits(code) != exclude {
                    return code
                }
            }

            if i + 1 < lines.count {
                let next = lines[i + 1].trimmingCharacters(in: .whitespaces)
                if isPlausiblePin(next), exclude.isEmpty || digits(next) != exclude {
                    return next
                }
            }
        }
        return ""
    }

    // MARK: - Segmentation

    /// If `s` is nothing but equal-length digit groups of at most 5, the
    /// group length; otherwise 0. This separates a card number printed with
    /// airy tracking from two genuinely different fields.
    private static func groupLength(_ s: String) -> Int {
        let parts = s.split(separator: " ", omittingEmptySubsequences: false).map(String.init)
        guard !parts.isEmpty else { return 0 }
        guard parts.allSatisfy({ !$0.isEmpty && $0.allSatisfy(\.isNumber) }) else { return 0 }
        let n = parts[0].count
        guard n <= 5, parts.allSatisfy({ $0.count == n }) else { return 0 }
        return n
    }

    /// Split one visual line into fields at wide gaps, then re-join runs that
    /// are really one grouped number.
    static func segmentLine(_ line: String) -> [String] {
        var raw: [String] = []
        var current = ""
        var run = 0
        for ch in line {
            if ch.isWhitespace {
                // A tab is one character but never accidental spacing.
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

    // MARK: - Fields

    struct ParsedFields {
        var number = ""
        var pin = ""
        var numberFromLabel = false
        /// What the number would have been before the guard, for logging.
        var rejectedNumber = ""
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
    /// "Card #", then the longest remaining digit run. Whatever wins still
    /// has to pass validatedNumber().
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
            guard i > 0 else { return false }
            let prev = segs[i - 1]
            return prev.lineIndex == s.lineIndex && prev.digits.isEmpty && matches(cardLabel, prev.text)
        }

        let pinLabeled = pin(in: lines, excluding: "")
        let pinLabeledDigits = digits(pinLabeled)

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

        // A labeled segment is "ACCT#: 70123456" — the label travels with it,
        // so take its digits, never its text.
        let candidate: String
        if let b = barcode, !b.isEmpty {
            candidate = b
        } else if let seg = numberSeg {
            candidate = seg.digits
        } else {
            candidate = ""
        }

        out.number = validatedNumber(candidate)
        if out.number.isEmpty && !candidate.isEmpty { out.rejectedNumber = candidate }

        out.pin = pinLabeled
        if out.pin.isEmpty, let seg = numberSeg {
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
    /// anything reaches the merchant field, so fine print here is harmless.
    static func merchantGuess(from lines: [String]) -> String {
        lines
            .filter { line in
                let d = digits(line).count
                return line.count >= 3 && d * 2 <= line.count
            }
            .max(by: { $0.count < $1.count }) ?? ""
    }
}
