// "Reçus par e-mail": supplier price lists picked up from the mailbox. Imported files are listed for the
// record; doubtful ones wait here until the user picks the supplier and imports (or ignores) them.
import { Badge, Button, Card } from "@/components/ui";
import { formatWhen, relativeTime } from "@/lib/money";
import { checkMailNowAction, ignoreInboxItemAction, importInboxItemAction } from "@/lib/purchasing-actions";
import type { MailStatus } from "@/lib/supplier-mail-job";

export type InboxItem = {
  id: string;
  attachmentName: string;
  fromAddress: string;
  fromName: string | null;
  subject: string | null;
  receivedAt: Date | null;
  createdAt: Date;
  status: string;
  reason: string | null;
  supplierId: string | null;
  supplierName: string | null;
  priceBasis: string | null;
  rowCount: number | null;
};

const STATUS: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "slate" }> = {
  imported: { label: "Importé", tone: "ok" },
  pending: { label: "À vérifier", tone: "warn" },
  error: { label: "Erreur", tone: "bad" },
  ignored: { label: "Ignoré", tone: "slate" },
};

export function MailInbox({
  configured,
  address,
  status,
  items,
  suppliers,
}: {
  configured: boolean;
  address: string | null;
  status: MailStatus | null;
  items: InboxItem[];
  suppliers: Array<{ id: string; name: string }>;
}) {
  const waiting = items.filter((i) => i.status === "pending" || i.status === "error");
  const history = items.filter((i) => i.status === "imported" || i.status === "ignored").slice(0, 10);
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">
            Reçus par e-mail {waiting.length ? <Badge tone="warn">{waiting.length} à vérifier</Badge> : null}
          </h2>
          <p className="text-xs text-[#6b858c]">
            {configured
              ? `Les listes de prix envoyées à ${address} (PDF, Word, Excel) sont lues toutes les 10 minutes. Fournisseur connu et colonnes claires : import automatique ; sinon le fichier attend ici.`
              : "Import automatique des listes de prix reçues par e-mail : pas encore activé."}
          </p>
        </div>
        {configured ? (
          <form action={checkMailNowAction}>
            <Button type="submit" variant="secondary" size="sm">
              Vérifier maintenant
            </Button>
          </form>
        ) : null}
      </div>

      {!configured ? (
        <div className="rounded-lg bg-[#fff4d6] p-3 text-xs text-[#8a6100]">
          Pour l’activer : créez un « mot de passe d’application » Google pour la boîte qui reçoit les listes (Compte Google → Sécurité → Validation en deux étapes →
          Mots de passe des applications), puis ajoutez sur Vercel <code className="mx-1">MAIL_IMAP_USER</code> (l’adresse) et <code className="mx-1">MAIL_IMAP_PASSWORD</code>
          (le mot de passe d’application) et redéployez. La boîte est lue en lecture seule : rien n’est marqué comme lu, déplacé, supprimé ni envoyé.
        </div>
      ) : status ? (
        <p className={`mb-3 text-xs ${status.ok ? "text-[#4d6a72]" : "text-[#b42323]"}`}>
          Dernière vérification {relativeTime(status.at)} —{" "}
          {status.ok
            ? status.result?.skipped ??
              `${status.result?.imported ?? 0} importé(s), ${status.result?.pending ?? 0} à vérifier${status.result?.errors ? `, ${status.result.errors} erreur(s)` : ""}`
            : status.error}
        </p>
      ) : (
        <p className="mb-3 text-xs text-[#4d6a72]">Première vérification dans les prochaines minutes.</p>
      )}

      {waiting.length ? (
        <div className="mb-4 grid gap-2">
          {waiting.map((i) => (
            <form key={i.id} action={importInboxItemAction} className="grid gap-2 rounded-lg border border-[#f0d98a] bg-[#fffbeb] p-3 text-sm md:grid-cols-[minmax(0,1fr)_auto]">
              <input type="hidden" name="id" value={i.id} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{i.attachmentName}</span>
                  <Badge tone={STATUS[i.status]?.tone ?? "slate"}>{STATUS[i.status]?.label ?? i.status}</Badge>
                  {i.rowCount ? <span className="text-xs text-[#4d6a72]">{i.rowCount} ligne(s) de prix détectée(s)</span> : null}
                </div>
                <div className="truncate text-xs text-[#6b858c]">
                  De {i.fromName ? `${i.fromName} <${i.fromAddress}>` : i.fromAddress} · {i.subject || "(sans objet)"} · {formatWhen(i.receivedAt ?? i.createdAt)}
                </div>
                {i.reason ? <div className="mt-1 text-xs text-[#8a6100]">{i.reason}</div> : null}
              </div>
              {i.status === "pending" ? (
                <div className="flex flex-wrap items-center gap-2">
                  <select name="supplierId" defaultValue={i.supplierId ?? ""} className="h-9 max-w-[180px] rounded-lg border border-[#d7e3e6] bg-white px-2 text-sm">
                    <option value="">Fournisseur…</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <input name="newSupplierName" placeholder="ou nouveau" className="h-9 w-28 rounded-lg border border-[#d7e3e6] bg-white px-2 text-sm" />
                  <select name="basis" defaultValue={i.priceBasis === "ttc" ? "ttc" : "ht"} className="h-9 rounded-lg border border-[#d7e3e6] bg-white px-2 text-sm" title="Prix du fichier">
                    <option value="ht">HT</option>
                    <option value="ttc">TTC</option>
                  </select>
                  <Button type="submit" size="sm">
                    Importer
                  </Button>
                  <Button type="submit" size="sm" variant="ghost" formAction={ignoreInboxItemAction}>
                    Ignorer
                  </Button>
                </div>
              ) : (
                <div className="flex items-center">
                  <Button type="submit" size="sm" variant="ghost" formAction={ignoreInboxItemAction}>
                    Masquer
                  </Button>
                </div>
              )}
            </form>
          ))}
        </div>
      ) : null}

      {history.length ? (
        <ul className="grid gap-1 text-xs text-[#4d6a72]">
          {history.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS[i.status]?.tone ?? "slate"}>{STATUS[i.status]?.label ?? i.status}</Badge>
              <span className="font-medium text-[#1d3a41]">{i.attachmentName}</span>
              <span>
                {i.supplierName ?? i.fromAddress}
                {i.rowCount ? ` · ${i.rowCount} lignes ${(i.priceBasis ?? "ht").toUpperCase()}` : ""} · {formatWhen(i.receivedAt ?? i.createdAt)}
                {i.reason && i.status === "imported" ? ` · ${i.reason}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : configured && !waiting.length ? (
        <p className="text-xs text-[#6b858c]">Aucune liste de prix reçue ces derniers jours.</p>
      ) : null}
    </Card>
  );
}
