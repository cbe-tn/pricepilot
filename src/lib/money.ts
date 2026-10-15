export function n(v: string | number | null | undefined): number {
  if (v == null || v === "") return 0;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

export function round3(v: number): number {
  return Math.round((v + Number.EPSILON) * 1000) / 1000;
}

export function round4(v: number): number {
  return Math.round((v + Number.EPSILON) * 10000) / 10000;
}

export function formatTnd(v: string | number | null | undefined, opts?: { withSymbol?: boolean }): string {
  const x = n(v);
  const formatted = new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(x);
  if (opts?.withSymbol === false) return formatted;
  return `${formatted} DT`;
}

export function formatPct(v: string | number | null | undefined, digits = 1): string {
  const x = n(v);
  const pct = Math.abs(x) <= 1 && Math.abs(x) > 0 ? x * 100 : x;
  const sign = pct > 0 && digits >= 0 ? "" : "";
  return `${sign}${pct.toFixed(digits).replace(".", ",")} %`;
}

export function formatPctPoints(rate: number, digits = 1): string {
  return `${(rate * 100).toFixed(digits).replace(".", ",")} %`;
}

export function signedTnd(v: number): string {
  const abs = formatTnd(Math.abs(v));
  if (v > 0) return `+${abs}`;
  if (v < 0) return `−${abs}`;
  return abs;
}

export function signedPct(v: number, digits = 1): string {
  const x = v * 100;
  const s = Math.abs(x).toFixed(digits).replace(".", ",");
  if (x > 0) return `+${s} %`;
  if (x < 0) return `−${s} %`;
  return `${s} %`;
}

export function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

export function formatWhen(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(dt);
}

export function formatDay(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
  }).format(dt);
}

export function relativeTime(d: Date | string | null | undefined): string {
  if (!d) return "jamais";
  const dt = typeof d === "string" ? new Date(d) : d;
  const diff = Date.now() - dt.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 14) return `il y a ${days} j`;
  return formatWhen(dt);
}

export function moneyStr(v: number): string {
  return round3(v).toFixed(3);
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : round3((s[mid - 1] + s[mid]) / 2);
}

export function average(values: number[]): number {
  if (!values.length) return 0;
  return round3(values.reduce((a, b) => a + b, 0) / values.length);
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))));
  return s[idx];
}

export function clsx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
