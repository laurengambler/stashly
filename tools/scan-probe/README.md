# scan-probe

Run the card-scan still pipeline over an image **on a Mac**, without building
to a device.

It compiles [`ios/App/App/CardTextParser.swift`](../../ios/App/App/CardTextParser.swift)
— the same source the app ships — and drives it with the same Vision requests
`StashScannerPlugin.analyze` uses. What you see here is what the device does
with the same picture.

```sh
tools/scan-probe/make-fixtures.sh          # synthetic cards -> ./fixtures
tools/scan-probe/run.sh fixtures/*.png     # run the pipeline over them
```

`run.sh` takes any image, so a reported misread can be reproduced from the
photo that caused it. It prints the recognized fragments with their
coordinates, the grouped visual lines and their segments, and the resolved
fields — the same things the device logs under `📇 StashScanner:`.

## Privacy

**Never commit a real card photo, or this tool's output over one.** Both
contain live card numbers and PINs. `tools/scan-probe/fixtures/` and
`tools/scan-probe/cards/` are gitignored; put real photos there, or outside
the repo entirely.

The checked-in fixtures are *drawn, not photographed*, from invented numbers
(`make-fixtures.swift`). That keeps card data out of the repo and makes them
deterministic, which a photo is not.

## Fixtures

| Fixture | Layout | Why |
|---|---|---|
| `acct-label.png` | `ACCT#: 70123456 789 0123456` | Label plus a number split into runs. Vision returns this as one fragment, so the parser must strip the label itself. |
| `number-and-pin.png` | `Card #1234567890        18934` | Two fields on one line — the number/PIN merge bug. |
| `grouped.png` | `6011 5000 1234 5678` + `PIN 4821` | One number, single-spaced; labeled PIN below. |
| `wide-grouped.png` | `1234  5678  9012  3456` | One number printed with wide gaps; must not split into four. |
| `fineprint-only.png` | no number at all | The number field must stay blank rather than guess. |

## Relationship to the JS tests

[`test/scanParse.test.mjs`](../../test/scanParse.test.mjs) is the shared spec
for the parsing rules, and covers `src/lib/scanParse.js`. This tool covers the
half the JS tests cannot reach: what **Vision itself** hands the parser for a
given image. Use the tests for rules, and this for "why did that photo do
that?".
