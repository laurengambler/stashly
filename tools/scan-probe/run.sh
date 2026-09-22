#!/bin/bash
# Run the card-scan still pipeline over image(s) on this Mac.
#
#   tools/scan-probe/run.sh photo.jpg [photo2.jpg ...]
#
# Compiles ios/App/App/CardTextParser.swift — the same source the app ships
# — together with main.swift, so what you see here is what the device does
# with the same picture.
#
# PRIVACY: point this at whatever you like, but do not commit real card
# photos or this tool's output over one. Synthetic fixtures: make-fixtures.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
bin="$(mktemp -d)/scan-probe"

swiftc -O \
  "$root/ios/App/App/CardTextParser.swift" \
  "$here/main.swift" \
  -o "$bin"

"$bin" "$@"
