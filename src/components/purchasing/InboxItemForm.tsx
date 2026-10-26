"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui";
import { checkMailNowAction, inboxItemAction, type InboxActionState } from "@/lib/purchasing-actions";

/** Supplier / HT-TTC choice and Importer / Ignorer for one waiting file, with progress and the result. */
export function InboxItemForm({
  id,
  pending,
  supplierId,
  priceBasis,
  suppliers,
}: {
  id: string;
  pending: boolean;
  supplierId: string | null;
  priceBasis: string | null;
  suppliers: Array<{ id: string; name: string }>;
}) {
  const [state, action, busy] = useActionState<InboxActionState, FormData>(inboxItemAction, null);
  return (
    <form action={action} className="grid gap-1">
      <input type="hidden" name="id" value={id} />
      {pending ? (
        <div className="flex flex-wrap items-center gap-2">
          <select name="supplierId" defaultValue={supplierId ?? ""} disabled={busy} className="h-9 max-w-[180px] rounded-lg border border-[#d7e3e6] bg-white px-2 text-sm">
            <option value="">Fournisseur…</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <input name="newSupplierName" placeholder="ou nouveau" disabled={busy} className="h-9 w-28 rounded-lg border border-[#d7e3e6] bg-white px-2 text-sm" />
          <select name="basis" defaultValue={priceBasis === "ttc" ? "ttc" : "ht"} disabled={busy} className="h-9 rounded-lg border border-[#d7e3e6] bg-white px-2 text-sm" title="Prix du fichier">
            <option value="ht">HT</option>
            <option value="ttc">TTC</option>
          </select>
          <Button type="submit" name="op" value="import" size="sm" disabled={busy}>
            {busy ? "Import…" : "Importer"}
          </Button>
          <Button type="submit" name="op" value="ignore" size="sm" variant="ghost" disabled={busy}>
            Ignorer
          </Button>
        </div>
      ) : (
        <div className="flex items-center">
          <Button type="submit" name="op" value="ignore" size="sm" variant="ghost" disabled={busy}>
            Masquer
          </Button>
        </div>
      )}
      {state ? <p className={`text-xs ${state.ok ? "text-[#0c6b4d]" : "text-[#b42323]"}`}>{state.message}</p> : null}
    </form>
  );
}

function CheckButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" size="sm" disabled={pending}>
      {pending ? "Vérification…" : "Vérifier maintenant"}
    </Button>
  );
}

export function CheckMailNow() {
  return (
    <form action={checkMailNowAction}>
      <CheckButton />
    </form>
  );
}
