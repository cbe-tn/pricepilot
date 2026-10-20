"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Button, Field, Input, Select } from "@/components/ui";
import { linesFromTable, lowPriceCount, type ColumnMapping, type DetectedTable } from "@/lib/supplier-columns";
import { saveSupplierImportAction } from "@/lib/purchasing-actions";
import { formatTnd } from "@/lib/money";

const NEW = "__new__";
const ACCEPT = ".pdf,.docx,.doc,.xlsx,.xlsm,.xls,.csv,.ods";

type TableState = DetectedTable & { include: boolean };

function columnLabel(t: DetectedTable, i: number): string {
  const letter = i < 26 ? String.fromCharCode(65 + i) : `C${i + 1}`;
  const header = t.headerRow >= 0 ? t.rows[t.headerRow][i] : "";
  const sample = t.rows[t.headerRow + 1]?.[i];
  return `${letter} · ${header || (sample ? `ex. ${sample.slice(0, 24)}` : "(vide)")}`;
}

const ROLES: Array<{ key: keyof ColumnMapping; label: string; required?: boolean }> = [
  { key: "ref", label: "Référence" },
  { key: "name", label: "Désignation" },
  { key: "price", label: "Prix unitaire", required: true },
  { key: "qty", label: "Quantité / stock" },
];

export function SupplierImport({ suppliers }: { suppliers: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [supplier, setSupplier] = useState(suppliers[0]?.id ?? NEW);
  const [newName, setNewName] = useState("");
  const [fileName, setFileName] = useState("");
  const [tables, setTables] = useState<TableState[]>([]);
  const [active, setActive] = useState(0);
  const [basis, setBasis] = useState<"ht" | "ttc">("ht");
  const [validUntil, setValidUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [saving, startSave] = useTransition();

  const lines = useMemo(() => tables.filter((t) => t.include).flatMap((t) => linesFromTable(t, t.headerRow, t.mapping)), [tables]);
  const lowPrices = useMemo(() => tables.filter((t) => t.include).reduce((sum, t) => sum + lowPriceCount(t, t.headerRow, t.mapping), 0), [tables]);
  const current = tables[active];

  async function analyze(file: File) {
    setBusy(true);
    setMsg(null);
    setTables([]);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/purchasing/parse", { method: "POST", body: fd });
      const data = (await res.json()) as { error?: string; fileName?: string; tables?: DetectedTable[] };
      if (!res.ok || !data.tables) {
        setMsg({ tone: "bad", text: data.error ?? "Lecture du fichier impossible." });
        return;
      }
      const next = data.tables.map((t) => ({ ...t, include: linesFromTable(t, t.headerRow, t.mapping).length > 0 }));
      setTables(next);
      setFileName(data.fileName ?? file.name);
      const first = Math.max(0, next.findIndex((t) => t.include));
      setActive(first);
      setBasis(next[first]?.basis ?? "ht");
      if (!next.some((t) => t.include)) setMsg({ tone: "bad", text: "Colonnes non reconnues : indiquez ci-dessous la colonne du prix et celle de la référence ou de la désignation." });
    } catch {
      setMsg({ tone: "bad", text: "Envoi du fichier impossible. Vérifiez la connexion et réessayez." });
    } finally {
      setBusy(false);
    }
  }

  function update(i: number, patch: Partial<TableState>) {
    setTables((ts) => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  }

  function save() {
    setMsg(null);
    startSave(async () => {
      const res = await saveSupplierImportAction({
        supplierId: supplier === NEW ? undefined : supplier,
        newSupplierName: supplier === NEW ? newName : undefined,
        fileName,
        basis,
        validUntil: validUntil || undefined,
        lines,
      });
      if ("error" in res) {
        setMsg({ tone: "bad", text: res.error });
        return;
      }
      setMsg({ tone: "ok", text: `${res.count} prix enregistrés (${res.matched} reliés à un produit du catalogue). Le comparatif ci-dessous est à jour.` });
      setTables([]);
      setFileName("");
      setNewName("");
      router.refresh();
    });
  }

  const columns = current ? Math.max(...current.rows.slice(0, 60).map((r) => r.length), 0) : 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Fournisseur">
          <Select value={supplier} onChange={(e) => setSupplier(e.target.value)}>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            <option value={NEW}>+ Nouveau fournisseur…</option>
          </Select>
        </Field>
        {supplier === NEW ? (
          <Field label="Nom du nouveau fournisseur">
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="ex. Dimatel" />
          </Field>
        ) : null}
        <Field label="Fichier reçu" hint="PDF, Word (.docx), Excel ou CSV">
          <label className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-[#9fbcc3] bg-[#f7fafb] px-3 text-sm text-[#0b4a56] hover:bg-white">
            <Upload size={16} />
            <span className="truncate">{busy ? "Lecture…" : fileName || "Choisir un fichier"}</span>
            <input
              type="file"
              accept={ACCEPT}
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void analyze(f);
                e.target.value = "";
              }}
            />
          </label>
        </Field>
      </div>

      {msg ? <p className={msg.tone === "ok" ? "text-sm text-[#0c8a62]" : "text-sm text-[#b42323]"}>{msg.text}</p> : null}

      {current ? (
        <div className="space-y-3 rounded-xl border border-[#d7e3e6] bg-[#fbfdfd] p-4">
          {tables.length > 1 ? (
            <div className="flex flex-wrap gap-2">
              {tables.map((t, i) => (
                <label key={i} className={`flex items-center gap-2 rounded-lg border px-2 py-1 text-xs ${i === active ? "border-[#0b4a56] bg-white" : "border-[#d7e3e6]"}`}>
                  <input type="checkbox" checked={t.include} onChange={(e) => update(i, { include: e.target.checked })} />
                  <button type="button" onClick={() => setActive(i)} className="font-medium">
                    {t.name} ({linesFromTable(t, t.headerRow, t.mapping).length})
                  </button>
                </label>
              ))}
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-6">
            {ROLES.map((r) => (
              <Field key={r.key} label={r.label}>
                <Select
                  value={current.mapping[r.key]}
                  onChange={(e) => update(active, { mapping: { ...current.mapping, [r.key]: Number(e.target.value) }, include: true })}
                >
                  <option value={-1}>{r.required ? "— à choisir —" : "— aucune —"}</option>
                  {Array.from({ length: columns }, (_, i) => (
                    <option key={i} value={i}>
                      {columnLabel(current, i)}
                    </option>
                  ))}
                </Select>
              </Field>
            ))}
            <Field label="Ligne d'en-tête" hint="0 = pas d'en-tête">
              <Input
                type="number"
                min={0}
                max={current.rows.length}
                value={current.headerRow + 1}
                onChange={(e) => update(active, { headerRow: Math.max(0, Number(e.target.value) || 0) - 1 })}
              />
            </Field>
            <Field label="Prix du fichier">
              <Select value={basis} onChange={(e) => setBasis(e.target.value as "ht" | "ttc")}>
                <option value="ht">HT</option>
                <option value="ttc">TTC (converti en HT)</option>
              </Select>
            </Field>
          </div>

          {lowPrices ? (
            <p className="rounded-lg bg-[#fff4de] px-3 py-2 text-sm text-[#9a5b08]">
              {lowPrices} ligne(s) ignorée(s) : prix inférieur à 1 DT dans la colonne choisie (souvent un taux de TVA ou une remise). Vérifiez que la colonne « Prix unitaire » est la bonne.
            </p>
          ) : null}
          <div className="pp-table-wrap max-h-80 overflow-auto">
            <table className="pp-table">
              <thead>
                <tr>
                  <th>Référence</th>
                  <th>Désignation</th>
                  <th>Prix {basis.toUpperCase()}</th>
                  <th>Qté</th>
                </tr>
              </thead>
              <tbody>
                {lines.slice(0, 50).map((l, i) => (
                  <tr key={i}>
                    <td className="font-mono text-xs">{l.ref || "—"}</td>
                    <td>{l.name || "—"}</td>
                    <td className="tabular-nums">{formatTnd(l.price)}</td>
                    <td>{l.qty ?? "—"}</td>
                  </tr>
                ))}
                {!lines.length ? (
                  <tr>
                    <td colSpan={4} className="text-center text-sm text-[#6b858c]">
                      Aucune ligne de prix avec ces colonnes.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <Field label="Prix valables jusqu'au (facultatif)">
              <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            </Field>
            <Button type="button" onClick={save} disabled={saving || !lines.length || (supplier === NEW && !newName.trim())}>
              {saving ? "Enregistrement…" : `Enregistrer ${lines.length} prix`}
            </Button>
            <p className="text-xs text-[#6b858c]">
              {lines.length > 50 ? `Aperçu des 50 premières lignes sur ${lines.length}. ` : ""}Vérifiez l’aperçu : pour une même référence, le dernier fichier d’un fournisseur remplace son ancien prix.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
