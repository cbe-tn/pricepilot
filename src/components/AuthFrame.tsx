import Link from "next/link";
import type { ReactNode } from "react";

// Shared split layout of the login / register / password pages (a page file may only export the page).
export function AuthFrame({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-[#072a33] lg:block">
        <img src="/images/hero.jpg" alt="" className="absolute inset-0 h-full w-full object-cover opacity-50" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#071c22] via-[#071c22/70] to-transparent" />
        <div className="relative flex h-full flex-col justify-end p-10 text-white">
          <img src="/brand/logo-full.png" alt="CBE — Cap Bon Electronique" className="mb-5 h-16 w-auto self-start rounded-xl bg-white p-2" />
          <h2 className="text-3xl font-semibold">CBE PricePilot</h2>
          <p className="mt-2 max-w-sm text-sm text-[#c5dbe0]">Veille tarifaire pour les boutiques tunisiennes d’informatique, d’électronique et d’électroménager.</p>
        </div>
      </div>
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <Link href="/" className="mb-8 flex items-center gap-2 lg:hidden">
            <img src="/brand/logo.png" alt="" className="h-9 w-9 rounded-lg" />
            <span className="font-semibold">CBE PricePilot</span>
          </Link>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="mt-1 text-sm text-[#4d6a72]">{subtitle}</p>
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
