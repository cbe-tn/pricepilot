import Link from "next/link";
import { getAuth } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function LandingPage() {
  const auth = await getAuth();
  if (auth) redirect("/dashboard");

  return (
    <div className="min-h-screen bg-[#071c22] text-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-3">
          <img src="/brand/logo.png" alt="" className="h-10 w-10 rounded-xl" />
          <div>
            <p className="text-sm font-semibold tracking-wide">CBE PricePilot</p>
            <p className="text-[11px] text-[#8fb4bc]">Veille tarifaire en Tunisie</p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Link href="/login" className="rounded-lg px-3 py-2 text-[#d7e8ec] hover:text-white">
            Se connecter
          </Link>
          <Link href="/register" className="rounded-lg bg-[#d4a017] px-4 py-2 font-semibold text-[#3b2a00]">
            Commencer
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 pb-16 pt-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#d4a017]">Pour les revendeurs tunisiens d’informatique et d’électroménager</p>
          <h1 className="mt-4 text-4xl font-semibold leading-[1.1] md:text-5xl">
            Pilotez vos prix.
            <span className="block text-[#9ad0da]">Gardez une longueur d’avance.</span>
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-[#c5dbe0]">
            CBE PricePilot suit en direct les prix de Mytek, SpaceNet, Tunisianet, Graiet, Batam, Alarabia, Eleganza et Electro Hadj Kacem — pour savoir quand acheter, quand préserver votre marge et à quel prix vendre en dinars.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/login" className="rounded-lg bg-[#d4a017] px-5 py-3 text-sm font-semibold text-[#3b2a00]">
              Se connecter
            </Link>
            <Link href="/register" className="rounded-lg border border-white/15 px-5 py-3 text-sm">
              Créer ma boutique
            </Link>
          </div>
        </div>
      </section>

      <section className="bg-[#0b2f38] py-16">
        <div className="mx-auto grid max-w-6xl gap-6 px-6 md:grid-cols-3">
          {[
            { t: "Benchmark en dinars", d: "Comparez coût d'achat, bénéfice TVA comprise et prix TTC des concurrents, au millime près." },
            { t: "Recommander, pas deviner", d: "Stratégies compétitive, équilibrée et premium qui ne descendent jamais sous votre prix plancher." },
            { t: "Réagir au bon moment", d: "Prix lus en direct sur les pages produits des concurrents, revérifiés régulièrement, avec alerte à chaque baisse." },
          ].map((c) => (
            <div key={c.t} className="rounded-2xl border border-white/10 bg-white/5 p-6">
              <h3 className="text-lg font-semibold">{c.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#b7cdd2]">{c.d}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
