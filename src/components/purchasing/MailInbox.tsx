// "Reçus par e-mail": supplier price lists picked up from the mailbox. Imported files are listed for the
// record; doubtful ones wait here until the user picks the supplier and imports (or ignores) them.
import { Badge, Card } from "@/components/ui";
import { CheckMailNow, InboxItemForm } from "@/components/purchasing/InboxItemForm";
import { formatWhen, relativeTime } from "@/lib/money";
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
  processing: { label: "En cours…", tone: "slate" },
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
  const waiting = items.filter((i) => i.status === "pending" || i.status === "error" || i.status === "processing");
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
        {configured ? <CheckMailNow /> : null}
      </div>

      {!configured ? (
        <div className="rounded-lg bg-[#fff4d6] p-3 text-xs text-[#8a6100]">
          Pour l’activer : ajoutez sur Vercel <code className="mx-1">MAIL_IMAP_USER</code> (l’adresse qui reçoit les listes, par ex. contact@numedia.tn) et
          <code className="mx-1">MAIL_IMAP_PASSWORD</code> (son mot de passe de messagerie OVH), puis redéployez. Offre OVH Email Pro : ajoutez aussi
          <code className="mx-1">MAIL_IMAP_HOST</code> = pro1.mail.ovh.net. La boîte est lue en lecture seule : rien n’est marqué comme lu, déplacé, supprimé ni envoyé.
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
            <div key={i.id} className="grid gap-2 rounded-lg border border-[#f0d98a] bg-[#fffbeb] p-3 text-sm md:grid-cols-[minmax(0,1fr)_auto]">
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
              <InboxItemForm id={i.id} pending={i.status === "pending"} supplierId={i.supplierId} priceBasis={i.priceBasis} suppliers={suppliers} />
            </div>
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
