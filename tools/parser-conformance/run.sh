#!/bin/bash
# Run the shared parser cases against the Swift parser (macOS only).
#   tools/parser-conformance/run.sh
#
# Compiles ios/App/App/CardTextParser.swift — the source the app ships —
# and asserts test/parser-cases.json against it. The JS side of the same
# cases runs under `npm test`.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
bin="$(mktemp -d)/parser-conformance"
swiftc -O "$root/ios/App/App/CardTextParser.swift" "$here/main.swift" -o "$bin"
"$bin" "$root/test/parser-cases.json"
