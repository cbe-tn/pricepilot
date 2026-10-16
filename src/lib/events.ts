// Tunisian commercial calendar for the Marketing Studio: dates, suggested texts (French + Tunisian
// Arabic), decoration and realistic scene. Lunar holidays depend on the crescent sighting, so their
// dates are estimates and always shown as "à confirmer".

export type EventDecor = "confetti" | "hearts" | "flowers" | "crescent" | "flag" | "percent" | "sun" | "school" | "bolts" | "stars";

export type TnEvent = {
  id: string;
  label: string;
  /** Next date on or after `from`; null when it must be typed (no reliable estimate). */
  next: (from: Date) => { date: Date; approx: boolean } | null;
  note?: string;
  fr: { title: string; tag: string; cta?: string };
  ar: { title: string; tag: string; cta?: string };
  decor: EventDecor;
  /** Openverse keyword for a realistic background matching the occasion. */
  scene?: string;
  /** Legal sales period: discount of at least 20 % with a verified crossed-out price. */
  sales?: boolean;
  theme?: "flash";
  /** Days the offer runs from the event date (sales, Ramadan…); 0 = the offer ends on the day itself. */
  days?: number;
};

const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
function fixed(m: number, d: number) {
  return (from: Date) => {
    const y = from.getUTCFullYear();
    const thisYear = day(y, m, d);
    return { date: thisYear >= startOfDay(from) ? thisYear : day(y + 1, m, d), approx: false };
  };
}
function startOfDay(d: Date) {
  return day(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}
/** n-th weekday of a month (weekday 0 = Sunday); n = -1 for the last one. */
function nthWeekday(y: number, m: number, weekday: number, n: number) {
  if (n > 0) {
    const first = day(y, m, 1);
    const offset = (weekday - first.getUTCDay() + 7) % 7;
    return day(y, m, 1 + offset + (n - 1) * 7);
  }
  const last = day(y, m + 1, 0);
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return day(y, m, last.getUTCDate() - offset);
}
function rule(make: (y: number) => Date, approx = false) {
  return (from: Date) => {
    const y = from.getUTCFullYear();
    const d = make(y);
    return { date: d >= startOfDay(from) ? d : make(y + 1), approx };
  };
}
/** Published astronomical estimates (moon sighting decides the final day). */
function lunar(table: Record<number, [number, number]>) {
  return (from: Date) => {
    const years = Object.keys(table).map(Number).sort();
    for (const y of years) {
      const d = day(y, table[y][0], table[y][1]);
      if (d >= startOfDay(from)) return { date: d, approx: true };
    }
    return null;
  };
}

export const TN_EVENTS: TnEvent[] = [
  {
    id: "black-friday",
    days: 3,
    label: "Black Friday",
    next: rule((y) => {
      const thanksgiving = nthWeekday(y, 11, 4, 4);
      return day(y, 11, thanksgiving.getUTCDate() + 1);
    }),
    fr: { title: "BLACK FRIDAY", tag: "Offres limitées" },
    ar: { title: "بلاك فرايداي", tag: "عروض محدودة" },
    decor: "bolts",
    theme: "flash",
  },
  {
    id: "nouvel-an",
    label: "Nouvel An",
    next: fixed(1, 1),
    fr: { title: "BONNE ANNÉE {Y}", tag: "Spécial Nouvel An" },
    ar: { title: "بونانة {Y}", tag: "عروض راس العام" },
    decor: "confetti",
    scene: "fireworks",
  },
  {
    id: "soldes-hiver",
    days: 56,
    label: "Soldes d'hiver",
    next: rule((y) => day(y, 2, 1), true),
    note: "Début fixé chaque année par le ministère du Commerce (vers le 1er février, huit semaines en 2026) — remise minimale légale 20 %.",
    fr: { title: "SOLDES D'HIVER", tag: "SOLDES" },
    ar: { title: "صولد الشتاء", tag: "الصولد" },
    decor: "percent",
    scene: "snow",
    sales: true,
  },
  {
    id: "saint-valentin",
    label: "Saint-Valentin",
    next: fixed(2, 14),
    fr: { title: "SAINT-VALENTIN", tag: "Idée cadeau" },
    ar: { title: "عيد الحب", tag: "هدية تفرّح" },
    decor: "hearts",
    scene: "roses",
  },
  {
    id: "ramadan",
    days: 29,
    label: "Ramadan",
    next: lunar({ 2027: [2, 8] }),
    note: "Date estimée, selon l'observation du croissant.",
    fr: { title: "RAMADAN KARIM", tag: "Offres de Ramadan" },
    ar: { title: "رمضان مبروك", tag: "عروض رمضان" },
    decor: "crescent",
    scene: "lantern",
  },
  {
    id: "aid-fitr",
    days: 2,
    label: "Aïd el-Fitr",
    next: lunar({ 2027: [3, 10] }),
    note: "Date estimée (9 ou 10 mars 2027), selon l'observation du croissant.",
    fr: { title: "AÏD MABROUK", tag: "Spécial Aïd" },
    ar: { title: "عيدكم مبروك", tag: "عروض العيد" },
    decor: "crescent",
    scene: "lantern",
  },
  {
    id: "independance",
    label: "Fête de l'Indépendance (20 mars)",
    next: fixed(3, 20),
    fr: { title: "FÊTE DE L'INDÉPENDANCE", tag: "20 MARS" },
    ar: { title: "عيد الاستقلال", tag: "20 مارس" },
    decor: "flag",
  },
  {
    id: "travail",
    label: "Fête du Travail (1er mai)",
    next: fixed(5, 1),
    fr: { title: "FÊTE DU TRAVAIL", tag: "1er MAI" },
    ar: { title: "عيد الشغل", tag: "غرة ماي" },
    decor: "stars",
    scene: "workspace",
  },
  {
    id: "aid-adha",
    days: 2,
    label: "Aïd el-Kébir",
    next: lunar({ 2027: [5, 17] }),
    note: "Date estimée (16 ou 17 mai 2027), selon l'observation du croissant.",
    fr: { title: "AÏD EL KÉBIR", tag: "Spécial Aïd" },
    ar: { title: "العيد الكبير مبروك", tag: "عروض العيد الكبير" },
    decor: "crescent",
    scene: "kitchen",
  },
  {
    id: "fete-meres",
    label: "Fête des Mères (dernier dimanche de mai)",
    next: rule((y) => nthWeekday(y, 5, 0, -1)),
    fr: { title: "FÊTE DES MÈRES", tag: "Cadeau pour maman" },
    ar: { title: "عيد الأم", tag: "هدية للماما" },
    decor: "flowers",
    scene: "flowers",
  },
  {
    id: "fete-peres",
    label: "Fête des Pères",
    next: rule((y) => nthWeekday(y, 6, 0, 3), true),
    note: "Généralement le 3e dimanche de juin — à confirmer.",
    fr: { title: "FÊTE DES PÈRES", tag: "Cadeau pour papa" },
    ar: { title: "عيد الأب", tag: "هدية للبابا" },
    decor: "stars",
    scene: "workspace",
  },
  {
    id: "republique",
    label: "Fête de la République (25 juillet)",
    next: fixed(7, 25),
    fr: { title: "FÊTE DE LA RÉPUBLIQUE", tag: "25 JUILLET" },
    ar: { title: "عيد الجمهورية", tag: "25 جويلية" },
    decor: "flag",
  },
  {
    id: "soldes-ete",
    days: 42,
    label: "Soldes d'été",
    next: rule((y) => day(y, 8, 7), true),
    note: "Le 7 août pour six semaines en 2026 (loi n° 40 de 1998) — date à confirmer chaque année, remise minimale légale 20 %.",
    fr: { title: "SOLDES D'ÉTÉ", tag: "SOLDES" },
    ar: { title: "صولد الصيف", tag: "الصولد" },
    decor: "sun",
    scene: "beach",
    sales: true,
  },
  {
    id: "fete-femme",
    label: "Fête de la Femme (13 août)",
    next: fixed(8, 13),
    fr: { title: "FÊTE DE LA FEMME", tag: "13 AOÛT" },
    ar: { title: "عيد المرأة", tag: "13 أوت" },
    decor: "flowers",
    scene: "flowers",
  },
  {
    id: "mouled",
    label: "Mouled",
    next: lunar({ 2027: [8, 15] }),
    note: "Date estimée — à confirmer selon le calendrier officiel.",
    fr: { title: "MOULED", tag: "Offres du Mouled" },
    ar: { title: "مولد مبروك", tag: "عروض المولد" },
    decor: "crescent",
    scene: "lantern",
  },
  {
    id: "rentree",
    days: 14,
    label: "Rentrée scolaire",
    next: rule((y) => day(y, 9, 15), true),
    note: "Mi-septembre — date officielle à confirmer.",
    fr: { title: "RENTRÉE SCOLAIRE", tag: "Spécial rentrée" },
    ar: { title: "العودة المدرسية", tag: "عروض الرونتري" },
    decor: "school",
    scene: "school",
  },
];

export const eventById = (id: string | null | undefined) => TN_EVENTS.find((e) => e.id === id) ?? null;

/** Events sorted by next occurrence, with "in N days" for the select list. */
export function upcomingEvents(from = new Date()) {
  return TN_EVENTS.map((e) => {
    const n = e.next(from);
    return { event: e, date: n?.date ?? null, approx: n?.approx ?? true, inDays: n ? Math.round((n.date.getTime() - startOfDay(from).getTime()) / 86_400_000) : null };
  }).sort((a, b) => (a.inDays ?? 9999) - (b.inDays ?? 9999));
}

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Realistic scene suggested for the products (kitchen for appliances, office for printers…). */
export function defaultSceneQuery(products: Array<{ name: string; category: string | null }>): string {
  const text = products.map((p) => `${p.name} ${p.category ?? ""}`).join(" ").toLowerCase();
  const rules: Array<[RegExp, string]> = [
    [/micro.?onde|four|robot|blender|mixeur|cafeti|frigo|r[ée]frig|cong[ée]l|cuisin|bouilloire|grille|friteuse|hachoir|plaque|hotte|lave.?vaisselle/, "kitchen"],
    [/t[ée]l[ée]viseur|\btv\b|smart tv|barre de son|home cin/, "sofa"],
    [/fer [àa] repasser|fer [àa] vapeur|centrale vapeur|lave.?linge|machine [àa] laver|s[èe]che.?linge/, "laundry"],
    [/climatiseur|chauffage|radiateur|ventilateur/, "bedroom"],
    [/aspirateur/, "home interior"],
    [/cam[ée]ra|surveillance|nvr|dvr|alarme/, "house"],
    [/haut.?parleur|enceinte|casque|[ée]couteur|microphone/, "beach"],
    [/gsm|smartphone|t[ée]l[ée]phone|tablette|montre/, "cafe"],
    [/imprimante|toner|cartouche|pc|portable|notebook|laptop|[ée]cran|clavier|souris|copieur|scanner|onduleur|routeur|switch/, "office desk"],
  ];
  return rules.find(([re]) => re.test(text))?.[1] ?? "wood table";
}
