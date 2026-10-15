// Tunisian VAT used by NUMEDIA: IT equipment (computers, printing, peripherals and their consumables)
// is taxed at 7 %; every other category (TV, appliances, CCTV, phones…) at 19 %.

export const VAT_IT = 0.07;
export const VAT_STANDARD = 0.19;

// Matched on the normalised category + name. Cameras/CCTV, TVs and appliances stay at 19 %.
const IT_RE = new RegExp(
  [
    "informatique",
    "imprimantes?",
    "impression",
    "photocopieu[rs]e?s?",
    "scanners?",
    "traceurs?",
    "toners?",
    "cartouches?",
    "bouteilles? d'?encre",
    "encres?",
    "rubans?",
    "tambours?",
    "photoconducteurs?",
    "copieurs?",
    "duplicopieurs?",
    "devell?oppeurs?",
    "matricielles?",
    "pc (?:portables?|de bureau|bureau|gamer|gaming|aio|all in one|tout en un)",
    "mini pc",
    "ordinateurs?",
    "laptops?",
    "notebooks?",
    "ultrabooks?",
    "macbook",
    "imac",
    "all in one",
    "aio",
    "unite centrale",
    "stations? de travail",
    "serveurs?",
    "ecrans? (?:pc|gaming|led|ips|lcd|incurve)",
    "moniteurs?",
    "claviers?",
    "souris",
    "disques? durs?",
    "ssd",
    "hdd",
    "cles? usb",
    "barrettes?",
    "memoire ram",
    "ram ddr\\d",
    "cartes? graphiques?",
    "processeurs?",
    "cartes? meres?",
    "onduleurs?",
    "videos? projecteurs?",
    "vid[eé]oprojecteurs?",
  ].join("|"),
);

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, " ")
    .trim();
}

// IT categories of the ERP whose article names do not always say it ("Bloc Dechet KYOCERA…", "Master Ricoh…").
const IT_CATEGORY_RE =
  /\s(?:pieces? de rechanges? (?:pc|imprimantes?)|pieces? detachees? copieurs?|sauvegardes?|cons laser|consommables? (?:laser|traceurs?)|masters?|imp matricielle)\s/;

// CCTV stays at 19 % even for its IT-looking parts (surveillance hard drives, NVR, PoE switches).
const CCTV_RE = /\s(?:cameras?|videosurveillance|surveillance|dvr|nvr|xvr|hikvision|hilook|dahua|uniview|ezviz|imou)\s/;

export function isItEquipment(p: { name?: string | null; category?: string | null; subcategory?: string | null }): boolean {
  const text = ` ${norm([p.category, p.subcategory, p.name].filter(Boolean).join(" "))} `;
  if (CCTV_RE.test(text)) return false;
  if (p.category && IT_CATEGORY_RE.test(` ${norm(p.category)} `)) return true;
  return new RegExp(`\\s(?:${IT_RE.source})\\s`).test(text);
}

/** VAT rate for a product from its category/name: 7 % for IT equipment, 19 % otherwise. */
export function vatRateFor(p: { name?: string | null; category?: string | null; subcategory?: string | null }): number {
  return isItEquipment(p) ? VAT_IT : VAT_STANDARD;
}
