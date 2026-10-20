// Brand, model and manufacturer reference derived from a product title, for products imported without
// them. Competitor matching is by reference, so a product without one is only found by its name.
// Prefers our own shop's title ("TCL LEDUHD50P615, Téléviseur 50 pouces…"), which keeps the casing and
// punctuation that a slugified ERP name lost ("tcl leduhd50p615 televiseur 50 pouces…").

// Brands sold in Tunisian IT / appliance shops (longest first so "Russell Hobbs" wins over "Russell").
const BRANDS = [
  "Russell Hobbs", "Spirit of Gamer", "White Shark", "Best Sound", "Western Digital", "Black & Decker", "Black+Decker",
  "Acer", "Adata", "Aiwa", "Alcatel", "Apli", "Apple", "Aprilla", "Asus", "Beko", "Bosch", "Brandt", "Braun", "Brother",
  "Candy", "Canon", "Condor", "D-Link", "Dahua", "Dell", "Delonghi", "De'Longhi", "Dibal", "Elanda", "Emse", "Epson", "Ezviz",
  "Falez", "Focus", "Fujitsu", "Gigabyte", "Haier", "Hikvision", "Hisense", "Honor", "HP", "Huawei", "Infinix", "Itel",
  "JBL", "Kingston", "Kisonli", "Kiwi", "Konica", "Kyocera", "Lenovo", "Lexmark", "LG", "Logicom", "Logitech", "Micitech",
  "Microsoft", "Montblanc", "Moulinex", "MSI", "Needtek", "Nokia", "Olympia", "Oppo", "Orient", "Panasonic", "Philips",
  "Pro Display", "Realme", "Ricoh", "Riso", "Rowenta", "Samsung", "Sandisk", "Seagate", "Sharp", "Siemens", "Sonifer",
  "Sony", "TCL", "Tecno", "Tefal", "Telefunken", "Tenda", "Toshiba", "TP-Link", "Uniview", "Vivo", "Whirlpool", "Xerox",
  "Xiaomi", "XO", "XPG", "Zilan", "ZKTeco", "Zonerich",
].sort((a, b) => b.length - a.length);

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

// Specs, capacities and years are not references: "8Go", "128GO", "1600W", "4K", "75HZ", "2018", "A4"…
const SPEC_RE =
  /^(\d+(?:[.,]\d+)?(?:go|gb|to|tb|mo|mb|w|kw|v|hz|mhz|ghz|mp|mpx|mah|l|kg|g|cm|mm|m|ppm|dpi|pc|pcs|p|k|ch|bnc|tr|lm|lumens|pouces|bits?|x)|[a-z]\d|ddr\d|\d{4}|usb\d?|wifi\d?|rgb|led|lcd|hdmi|vga|4g|5g|3g|lte|a\d|i\d|h26\d|ip\d{2}|\d+-?(ch|bnc|ports?|go|gb|to|tb|mp|w)|\d+-\d+(kg|g|l|w|v|mm|cm|m))$/i;

// Words that end a model name in a title ("MS2042DB 700 W 20 litres", "XE-A147-BK en Noir").
const MODEL_STOP_RE = /^(en|de|du|avec|pour|et|a|à|noir|blanc|gris|rouge|bleu|silver|inox|argent|dore|doré|rose|vert|full|hd|\d+"-?)$/i;
// Consumables name the printers they fit first and their own reference last ("Toner Kyocera FS-1320D TK-170").
const CONSUMABLE_RE = /^\s*(toner|cartouches?|encres?|bouteilles?|tambour|drum|ruban|t[eê]te d'impression|kit de maintenance)\b/i;

/** A token that looks like a manufacturer reference: letters and digits mixed, at least 4 characters. */
export function isRefToken(t: string): boolean {
  const s = t.replace(/[.,;:]+$/, "");
  if (s.length < 4 || s.length > 25) return false;
  if (SPEC_RE.test(s)) return false;
  // Russell Hobbs style all-digit references: "22591-70", "24730-56".
  if (/^\d{4,6}-\d{2,3}$/.test(s)) return true;
  return /[a-z]/i.test(s) && /\d/.test(s);
}

export type Identity = { brand: string | null; model: string | null; reference: string | null };

export function deriveIdentity(name: string, ownTitle?: string | null): Identity {
  // Our shop's title, cut at the first ", " / " - " / " | " / " en Tunisie" (the rest is description).
  const fromOwn = (ownTitle ?? "").split(/,\s|\s[-–|]\s|\s\|\s?|\sen Tunisie/i)[0]?.trim() ?? "";
  const source = fromOwn.length >= 3 ? fromOwn : name;
  const plain = ` ${norm(source).replace(/[^a-z0-9+&'-]+/g, " ")} `;

  let brand: string | null = null;
  let brandEnd = -1;
  for (const b of BRANDS) {
    const i = plain.indexOf(` ${norm(b)} `);
    if (i >= 0) {
      brand = b;
      brandEnd = i + norm(b).length + 1;
      break;
    }
  }

  // Tokens after the brand (or the whole head when no brand is known), in their original spelling.
  const original = source.replace(/["“”]/g, " ").split(/\s+|\/(?=\S)|,(?=\S)/).filter(Boolean);
  const startWord = brand ? plain.slice(0, brandEnd).trim().split(/\s+/).length : 0;
  const tail = original.slice(startWord);
  // First reference-like token after the brand; otherwise anywhere ("XVR301-16G3 UNIVIEW 16 CH…").
  const consumable = CONSUMABLE_RE.test(source) || CONSUMABLE_RE.test(name);
  const pick = (list: string[]) => (consumable ? list.findLastIndex((t) => isRefToken(t)) : list.findIndex((t) => isRefToken(t)));
  // A complete code in parentheses is the manufacturer reference ("… Lite Mini 1U H.265 (XVR301-04G3)").
  const paren = [...(ownTitle ?? "").matchAll(/\(([A-Za-z0-9][A-Za-z0-9./-]{3,24})\)/g), ...name.matchAll(/\(([A-Za-z0-9][A-Za-z0-9./-]{3,24})\)/g)]
    .map((m) => m[1])
    .find((t) => isRefToken(t));
  let refList = paren ? [paren] : tail;
  let refIdx = paren ? 0 : pick(tail);
  if (refIdx < 0) {
    refList = original;
    refIdx = pick(original);
  }
  const reference = refIdx >= 0 ? refList[refIdx].replace(/[.,;:"]+$/, "") : null;

  // Model: the words after the brand up to the first spec / colour / description word ("Redmi Note 10S").
  const modelWords: string[] = [];
  for (const t of tail) {
    const w = t.replace(/[.,;:]+$/, "");
    // Short model words ("Y7", "A54") look like specs but belong to the model name.
    const spec = SPEC_RE.test(w) && !isRefToken(w) && !/^[a-z]\d{1,2}$/i.test(w);
    // Once the reference is in, a bare number or unit starts the specs ("MS2042DB 700 W 20 litres").
    const afterRef = modelWords.some((m) => isRefToken(m)) && /^(\d+|[a-z])$/i.test(w);
    if (!w || MODEL_STOP_RE.test(w) || spec || afterRef || modelWords.length >= 4) break;
    modelWords.push(w);
    if (t !== w) break; // a comma ends the model
  }
  let model = brand && modelWords.length ? modelWords.join(" ") : null;
  if (reference && (!model || !norm(model).includes(norm(reference)))) model = reference;
  return { brand, model: model ? model.slice(0, 80) : null, reference: reference ? reference.toUpperCase().slice(0, 40) : null };
}
