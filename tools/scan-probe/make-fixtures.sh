#!/bin/bash
# Render synthetic gift-card fixtures (no real card data in this repo).
#   tools/scan-probe/make-fixtures.sh [outdir]
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out="${1:-$here/fixtures}"
bin="$(mktemp -d)/make-fixtures"
swiftc -O "$here/make-fixtures.swift" -o "$bin"
"$bin" "$out"
