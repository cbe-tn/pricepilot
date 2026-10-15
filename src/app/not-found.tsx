import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center px-6">
      <div className="text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-[#d4a017]">CBE PricePilot</p>
        <h1 className="mt-2 text-3xl font-semibold">Page introuvable</h1>
        <Link href="/dashboard" className="mt-6 inline-flex h-10 items-center rounded-lg bg-[#0b4a56] px-4 text-sm text-white">
          Retour au tableau de bord
        </Link>
      </div>
    </div>
  );
}
