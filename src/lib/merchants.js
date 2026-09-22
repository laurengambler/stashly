// lib/merchants.js
// Known-merchant matching for scan autofill.
//
// WHY THIS EXISTS: users photograph the BACK of a gift card, which is
// mostly fine print ("Terms apply", "Not redeemable for cash", a support
// phone number). The old native heuristic — "the largest line of text
// that isn't mostly digits" — happily returned that junk, and a wrong
// prefill is worse than an empty field: the user has to notice it, clear
// it, and retype. So we only ever autofill the merchant when recognized
// text matches a name on this list. No match → leave it blank and let
// the user type it.
//
// This deliberately lives in JS, not Swift: the list can then grow in a
// normal web release without an App Store build.

// Canonical display name → alias strings to look for in OCR text.
// Aliases are matched case- and punctuation-insensitively (see normalize).
// Keep aliases distinctive: a short generic word ("shop", "store", "cafe")
// would match fine print and defeat the whole point of the list.
//
// NOTE: payment networks (Visa, Mastercard, Amex, Discover) are
// intentionally absent. Those are open-loop cards, detected separately by
// classifyCardNumber, and their fine print would otherwise match here.
const MERCHANTS = [
  { name: 'Amazon', aliases: ['amazon', 'amazon.com'] },
  { name: 'Airbnb', aliases: ['airbnb'] },
  { name: 'AMC Theatres', aliases: ['amc theatres', 'amc theatre', 'amc'] },
  { name: 'American Eagle', aliases: ['american eagle', 'aerie'] },
  { name: 'Apple', aliases: ['apple store', 'app store', 'itunes', 'apple.com'] },
  { name: 'Applebee’s', aliases: ['applebees', 'applebee s'] },
  { name: 'Athleta', aliases: ['athleta'] },
  { name: 'AutoZone', aliases: ['autozone'] },
  { name: 'Bath & Body Works', aliases: ['bath body works', 'bath and body works'] },
  { name: 'Barnes & Noble', aliases: ['barnes noble', 'barnes and noble'] },
  { name: 'Best Buy', aliases: ['best buy', 'bestbuy'] },
  { name: 'Big Lots', aliases: ['big lots'] },
  { name: 'BJ’s Wholesale', aliases: ['bjs wholesale', 'bj s wholesale'] },
  { name: 'Bloomingdale’s', aliases: ['bloomingdales', 'bloomingdale s'] },
  { name: 'Buffalo Wild Wings', aliases: ['buffalo wild wings'] },
  { name: 'Build-A-Bear', aliases: ['build a bear', 'buildabear'] },
  { name: 'Burger King', aliases: ['burger king'] },
  { name: 'Cabela’s', aliases: ['cabelas', 'cabela s'] },
  { name: 'Carter’s', aliases: ['carters', 'carter s'] },
  { name: 'The Cheesecake Factory', aliases: ['cheesecake factory'] },
  { name: 'Chewy', aliases: ['chewy', 'chewy.com'] },
  { name: 'Chick-fil-A', aliases: ['chick fil a', 'chickfila'] },
  { name: 'Chipotle', aliases: ['chipotle'] },
  { name: 'Chili’s', aliases: ['chilis', 'chili s'] },
  { name: 'Cinemark', aliases: ['cinemark'] },
  { name: 'Claire’s', aliases: ['claires', 'claire s'] },
  { name: 'Costco', aliases: ['costco'] },
  { name: 'Cracker Barrel', aliases: ['cracker barrel'] },
  { name: 'CVS Pharmacy', aliases: ['cvs pharmacy', 'cvs'] },
  { name: 'Dave & Buster’s', aliases: ['dave busters', 'dave and busters'] },
  { name: 'Dick’s Sporting Goods', aliases: ['dicks sporting goods', 'dick s sporting goods'] },
  { name: 'Dillard’s', aliases: ['dillards', 'dillard s'] },
  { name: 'Disney', aliases: ['disney store', 'disney', 'shopdisney'] },
  { name: 'Dollar General', aliases: ['dollar general'] },
  { name: 'Dollar Tree', aliases: ['dollar tree'] },
  { name: 'Domino’s', aliases: ['dominos pizza', 'dominos', 'domino s'] },
  { name: 'DoorDash', aliases: ['doordash'] },
  { name: 'Dunkin’', aliases: ['dunkin donuts', 'dunkin'] },
  { name: 'Dutch Bros', aliases: ['dutch bros'] },
  { name: 'eBay', aliases: ['ebay', 'ebay.com'] },
  { name: 'Etsy', aliases: ['etsy', 'etsy.com'] },
  { name: 'Express', aliases: ['express'] },
  { name: 'Fandango', aliases: ['fandango'] },
  { name: 'Five Below', aliases: ['five below'] },
  { name: 'Foot Locker', aliases: ['foot locker', 'footlocker'] },
  { name: 'Forever 21', aliases: ['forever 21'] },
  { name: 'GameStop', aliases: ['gamestop'] },
  { name: 'Gap', aliases: ['gap inc', 'gap.com'] },
  { name: 'Grubhub', aliases: ['grubhub'] },
  { name: 'H&M', aliases: ['h m hennes', 'hennes mauritz'] },
  { name: 'Hobby Lobby', aliases: ['hobby lobby'] },
  { name: 'Home Depot', aliases: ['home depot', 'homedepot'] },
  { name: 'HomeGoods', aliases: ['homegoods', 'home goods'] },
  { name: 'Hulu', aliases: ['hulu'] },
  { name: 'IHOP', aliases: ['ihop'] },
  { name: 'IKEA', aliases: ['ikea'] },
  { name: 'Instacart', aliases: ['instacart'] },
  { name: 'JCPenney', aliases: ['jcpenney', 'jc penney'] },
  { name: 'Jersey Mike’s', aliases: ['jersey mikes', 'jersey mike s'] },
  { name: 'Jimmy John’s', aliases: ['jimmy johns', 'jimmy john s'] },
  { name: 'Kohl’s', aliases: ['kohls', 'kohl s'] },
  { name: 'Krispy Kreme', aliases: ['krispy kreme'] },
  { name: 'Kroger', aliases: ['kroger'] },
  { name: 'Lands’ End', aliases: ['lands end'] },
  { name: 'Lowe’s', aliases: ['lowes', 'lowe s'] },
  { name: 'lululemon', aliases: ['lululemon'] },
  { name: 'Macy’s', aliases: ['macys', 'macy s'] },
  { name: 'Marshalls', aliases: ['marshalls'] },
  { name: 'Menards', aliases: ['menards'] },
  { name: 'Michaels', aliases: ['michaels'] },
  { name: 'Nordstrom', aliases: ['nordstrom', 'nordstrom rack'] },
  { name: 'Netflix', aliases: ['netflix'] },
  { name: 'Nike', aliases: ['nike', 'nike.com'] },
  { name: 'Office Depot', aliases: ['office depot', 'officemax'] },
  { name: 'Old Navy', aliases: ['old navy'] },
  { name: 'Olive Garden', aliases: ['olive garden'] },
  { name: 'Outback Steakhouse', aliases: ['outback steakhouse', 'outback'] },
  { name: 'Panda Express', aliases: ['panda express'] },
  { name: 'Panera Bread', aliases: ['panera bread', 'panera'] },
  { name: 'PetSmart', aliases: ['petsmart'] },
  { name: 'Petco', aliases: ['petco'] },
  { name: 'Pizza Hut', aliases: ['pizza hut'] },
  { name: 'PlayStation Store', aliases: ['playstation store', 'playstation'] },
  { name: 'Pottery Barn', aliases: ['pottery barn'] },
  { name: 'Red Lobster', aliases: ['red lobster'] },
  { name: 'REI', aliases: ['rei co op', 'rei.com'] },
  { name: 'Roblox', aliases: ['roblox'] },
  { name: 'Ross', aliases: ['ross dress for less'] },
  { name: 'Sally Beauty', aliases: ['sally beauty'] },
  { name: 'Sam’s Club', aliases: ['sams club', 'sam s club'] },
  { name: 'Sephora', aliases: ['sephora'] },
  { name: 'Shake Shack', aliases: ['shake shack'] },
  { name: 'Sheetz', aliases: ['sheetz'] },
  { name: 'Shell', aliases: ['shell oil', 'shell gas'] },
  { name: 'Skechers', aliases: ['skechers'] },
  { name: 'Sonic Drive-In', aliases: ['sonic drive in'] },
  { name: 'Spotify', aliases: ['spotify'] },
  { name: 'Sportsman’s Warehouse', aliases: ['sportsmans warehouse'] },
  { name: 'Starbucks', aliases: ['starbucks'] },
  { name: 'Steam', aliases: ['steam wallet', 'steampowered'] },
  { name: 'Subway', aliases: ['subway'] },
  { name: 'Taco Bell', aliases: ['taco bell'] },
  { name: 'Target', aliases: ['target', 'target.com'] },
  { name: 'TJ Maxx', aliases: ['tj maxx', 'tjmaxx'] },
  { name: 'Torrid', aliases: ['torrid'] },
  { name: 'Total Wine', aliases: ['total wine'] },
  { name: 'Tractor Supply', aliases: ['tractor supply'] },
  { name: 'Trader Joe’s', aliases: ['trader joes', 'trader joe s'] },
  { name: 'Ulta Beauty', aliases: ['ulta beauty', 'ulta'] },
  { name: 'Uber', aliases: ['uber eats', 'ubereats', 'uber'] },
  { name: 'Victoria’s Secret', aliases: ['victorias secret', 'victoria s secret'] },
  { name: 'Walgreens', aliases: ['walgreens'] },
  { name: 'Walmart', aliases: ['walmart', 'walmart.com'] },
  { name: 'Wawa', aliases: ['wawa'] },
  { name: 'Wayfair', aliases: ['wayfair'] },
  { name: 'Wendy’s', aliases: ['wendys', 'wendy s'] },
  { name: 'Whole Foods', aliases: ['whole foods'] },
  { name: 'Williams Sonoma', aliases: ['williams sonoma'] },
  { name: 'Xbox', aliases: ['xbox'] },
  { name: 'Zara', aliases: ['zara'] },
]

// Fold a line of OCR text into a comparable form: lowercase, accents and
// punctuation flattened to single spaces. "BATH & BODY WORKS®" and
// "Bath and Body Works" both reduce to something the aliases can hit.
const normalize = (s) =>
  (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

// Precomputed so matching stays a simple scan over normalized strings.
const INDEX = MERCHANTS.flatMap((m) =>
  m.aliases.map((alias) => ({ name: m.name, alias: normalize(alias) }))
).filter((e) => e.alias.length >= 3)

// Does `haystack` contain `needle` on word boundaries? Substring alone
// would let "rei" match "their", "gap" match "gaps".
const containsWord = (haystack, needle) => {
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at === -1) return false
    const before = at === 0 ? ' ' : haystack[at - 1]
    const after =
      at + needle.length >= haystack.length ? ' ' : haystack[at + needle.length]
    if (before === ' ' && after === ' ') return true
    from = at + 1
  }
}

/**
 * Find a known merchant in recognized text.
 *
 * Candidates are the OCR lines plus (optionally) the native merchantGuess,
 * which is only ever a hint — it has to match the list like anything else.
 *
 * Returns { name, alias, source } or null. Null means "leave the field
 * blank", which is the whole point: no guessing.
 */
export const matchMerchant = (textLines = [], merchantGuess = '') => {
  const candidates = []
  if (merchantGuess) candidates.push(String(merchantGuess))
  for (const line of textLines || []) if (line) candidates.push(String(line))

  let best = null
  candidates.forEach((raw, order) => {
    const hay = normalize(raw)
    if (!hay) return
    for (const entry of INDEX) {
      if (!containsWord(hay, entry.alias)) continue
      // Longest alias wins, so "bath and body works" beats a stray "bath";
      // ties go to whichever candidate line came first.
      const better =
        !best ||
        entry.alias.length > best.alias.length ||
        (entry.alias.length === best.alias.length && order < best.order)
      if (better) best = { name: entry.name, alias: entry.alias, order, source: raw }
    }
  })

  return best ? { name: best.name, alias: best.alias, source: best.source } : null
}

// Exposed for tests / future "is this merchant known?" UI.
export const knownMerchantNames = () => MERCHANTS.map((m) => m.name)
