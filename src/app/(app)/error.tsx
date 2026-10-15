"use client";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="pp-card p-8">
      <h2 className="text-lg font-semibold">Impossible d’afficher cette page</h2>
      <p className="mt-2 text-sm text-[#4d6a72]">{error.message || "Une erreur inattendue s'est produite."}</p>
      <button type="button" onClick={reset} className="mt-4 h-10 rounded-lg bg-[#0b4a56] px-4 text-sm text-white">
        Réessayer
      </button>
    </div>
  );
}
