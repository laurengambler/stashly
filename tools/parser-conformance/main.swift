//
//  tools/parser-conformance/main.swift
//  Run the SHARED parser cases against the Swift parser.
//
//  test/parser-cases.json is the single list of cases. test/scanParse.test.mjs
//  asserts them against src/lib/scanParse.js; this asserts the same ones
//  against ios/App/App/CardTextParser.swift — the copy that actually runs on
//  device. Keeping one case file means the two parsers cannot drift in what
//  they are tested on, only in whether they pass.
//
//  Exits non-zero on any mismatch, so CI can run it.
//
//  Usage: tools/parser-conformance/run.sh
//

import Foundation

struct Failure {
    let group: String
    let name: String
    let field: String
    let expected: String
    let actual: String
}

var failures: [Failure] = []
var checked = 0

func check(_ group: String, _ name: String, _ field: String, expected: String, actual: String) {
    checked += 1
    if expected != actual {
        failures.append(Failure(group: group, name: name, field: field, expected: expected, actual: actual))
    }
}

let casesPath = CommandLine.arguments.count > 1
    ? CommandLine.arguments[1]
    : "test/parser-cases.json"

guard let data = FileManager.default.contents(atPath: casesPath),
      let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
    FileHandle.standardError.write("cannot read \(casesPath)\n".data(using: .utf8)!)
    exit(2)
}

// MARK: validatedNumber
for c in (root["validatedNumber"] as? [[String: Any]]) ?? [] {
    let name = c["name"] as? String ?? "?"
    let input = c["in"] as? String ?? ""
    let expected = c["out"] as? String ?? ""
    check("validatedNumber", name, "out",
          expected: expected,
          actual: CardTextParser.validatedNumber(input))
}

// MARK: numberValue
for c in (root["numberValue"] as? [[String: Any]]) ?? [] {
    let name = c["name"] as? String ?? "?"
    let input = c["in"] as? String ?? ""
    let expected = c["out"] as? String ?? ""
    check("numberValue", name, "out",
          expected: expected,
          actual: CardTextParser.numberValue(input))
}

// MARK: segmentLine
for c in (root["segmentLine"] as? [[String: Any]]) ?? [] {
    let name = c["name"] as? String ?? "?"
    let input = c["in"] as? String ?? ""
    let expected = (c["out"] as? [String]) ?? []
    check("segmentLine", name, "out",
          expected: expected.joined(separator: " | "),
          actual: CardTextParser.segmentLine(input).joined(separator: " | "))
}

// MARK: detectPin
for c in (root["detectPin"] as? [[String: Any]]) ?? [] {
    let name = c["name"] as? String ?? "?"
    let lines = (c["lines"] as? [String]) ?? []
    let exclude = c["exclude"] as? String ?? ""
    let expected = c["out"] as? String ?? ""
    check("detectPin", name, "out",
          expected: expected,
          actual: CardTextParser.pin(in: lines, excluding: exclude))
}

// MARK: parseFields
for c in (root["parseFields"] as? [[String: Any]]) ?? [] {
    let name = c["name"] as? String ?? "?"
    let lines = (c["lines"] as? [String]) ?? []
    let barcode = c["barcode"] as? String ?? ""
    let expect = (c["expect"] as? [String: Any]) ?? [:]

    let got = CardTextParser.parseFields(barcode: barcode.isEmpty ? nil : barcode, lines: lines)

    check("parseFields", name, "number",
          expected: expect["number"] as? String ?? "", actual: got.number)
    check("parseFields", name, "pin",
          expected: expect["pin"] as? String ?? "", actual: got.pin)
    check("parseFields", name, "numberFromLabel",
          expected: String(expect["numberFromLabel"] as? Bool ?? false),
          actual: String(got.numberFromLabel))
    check("parseFields", name, "numberConfidence",
          expected: expect["numberConfidence"] as? String ?? "",
          actual: got.numberConfidence)
}

// MARK: report
if failures.isEmpty {
    print("✔ Swift parser conformance: \(checked) assertions, 0 failures")
    exit(0)
}

print("✖ Swift parser conformance: \(checked) assertions, \(failures.count) failure(s)\n")
for f in failures {
    print("  [\(f.group)] \(f.name)")
    print("      \(f.field): expected \(f.expected.isEmpty ? "\"\"" : f.expected)")
    print("             got      \(f.actual.isEmpty ? "\"\"" : f.actual)")
}
print("\nThe Swift parser disagrees with the shared cases in test/parser-cases.json.")
print("src/lib/scanParse.js and ios/App/App/CardTextParser.swift must implement")
print("the same rules — fix whichever is wrong, not the cases.")
exit(1)
