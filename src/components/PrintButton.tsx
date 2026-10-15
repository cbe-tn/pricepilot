"use client";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="rounded-lg bg-[#0b4a56] px-4 py-2 text-sm text-white">
      Imprimer / enregistrer en PDF
    </button>
  );
}
