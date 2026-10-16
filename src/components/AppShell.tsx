"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  Bell,
  Bot,
  ChevronLeft,
  LayoutDashboard,
  Package,
  Scale,
  Store,
  Globe,
  Sparkles,
  LineChart,
  Lightbulb,
  Truck,
  Warehouse,
  FileBarChart,
  Settings,
  Search,
  LogOut,
  Menu,
  Megaphone,
} from "lucide-react";
import { logoutAction, searchProductsAction } from "@/lib/actions";
import { cn } from "@/components/ui";
import { fr } from "@/lib/labels";

const NAV = [
  { href: "/dashboard", label: "Tableau de bord", icon: LayoutDashboard },
  { href: "/products", label: "Catalogue produits", icon: Package },
  { href: "/benchmarking", label: "Benchmark des prix", icon: Scale },
  { href: "/stock-web", label: "Stock & site web", icon: Store },
  { href: "/marketing", label: "AI Marketing Studio", icon: Megaphone },
  { href: "/competitors", label: "Concurrents", icon: Globe },
  { href: "/discovery", label: "Nouveaux produits", icon: Sparkles },
  { href: "/history", label: "Historique des prix", icon: LineChart },
  { href: "/recommendations", label: "Recommandations", icon: Lightbulb },
  { href: "/suppliers", label: "Fournisseurs", icon: Truck },
  { href: "/inventory", label: "Stock", icon: Warehouse },
  { href: "/reports", label: "Rapports", icon: FileBarChart },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/settings", label: "Paramètres", icon: Settings },
];

const CRUMB_LABELS: Record<string, string> = { new: "Nouveau", edit: "Modifier", assistant: "Assistant", onboarding: "Démarrage", print: "Impression" };

export type ShellUser = {
  fullName: string;
  email: string;
  role: string;
  workspaceName: string;
};

export function AppShell({
  user,
  unread,
  children,
}: {
  user: ShellUser;
  unread: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("pp-sidebar");
    if (saved === "1") setCollapsed(true);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const toggle = () => {
    setCollapsed((c) => {
      localStorage.setItem("pp-sidebar", !c ? "1" : "0");
      return !c;
    });
  };

  const crumbs = useMemo(() => {
    const parts = pathname.split("/").filter(Boolean);
    const acc: { href: string; label: string }[] = [];
    let href = "";
    for (const part of parts) {
      href += `/${part}`;
      const known = NAV.find((n) => n.href === href);
      acc.push({
        href,
        label: known?.label ?? CRUMB_LABELS[part] ?? (/^[0-9a-f-]{36}$/.test(part) ? (parts[0] === "marketing" ? "Affiche" : "Fiche produit") : part.replace(/-/g, " ")),
      });
    }
    return acc;
  }, [pathname]);

  const sidebar = (mobile = false) => (
    <aside
      className={cn(
        "flex h-full flex-col bg-[#072a33] text-[#d7e8ec] transition-all duration-200",
        mobile ? "w-72" : collapsed ? "w-[76px]" : "w-64",
      )}
    >
      <div className="flex h-16 items-center gap-3 px-4">
        <img src="/brand/logo.png" alt="CBE PricePilot" className="h-9 w-9 rounded-lg object-cover" />
        {!collapsed || mobile ? (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-wide text-white">CBE PricePilot</p>
            <p className="truncate text-[11px] text-[#8fb4bc]">{user.workspaceName}</p>
          </div>
        ) : null}
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
                active ? "bg-[#d4a017] text-[#3b2a00] font-semibold" : "hover:bg-white/8 text-[#c5dbe0]",
                collapsed && !mobile ? "justify-center px-0" : "",
              )}
            >
              <Icon size={18} />
              {!collapsed || mobile ? <span className="truncate">{item.label}</span> : null}
              {item.href === "/notifications" && unread > 0 && (!collapsed || mobile) ? (
                <span className="ml-auto rounded-full bg-white/15 px-1.5 text-[10px] font-bold">{unread}</span>
              ) : null}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-white/10 p-3">
        <form action={logoutAction}>
          <button
            type="submit"
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-[#c5dbe0] hover:bg-white/8",
              collapsed && !mobile ? "justify-center" : "",
            )}
          >
            <LogOut size={18} />
            {!collapsed || mobile ? "Se déconnecter" : null}
          </button>
        </form>
        {!mobile ? (
          <button
            type="button"
            onClick={toggle}
            className="mt-1 flex w-full items-center justify-center rounded-lg py-1 text-[#8fb4bc] hover:text-white"
            aria-label="Réduire le menu"
          >
            <ChevronLeft size={16} className={cn("transition", collapsed ? "rotate-180" : "")} />
          </button>
        ) : null}
      </div>
    </aside>
  );

  return (
    <div className="flex min-h-screen bg-[#eef3f5]">
      <div className="hidden md:block">{sidebar(false)}</div>
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <div className="relative z-10 h-full">{sidebar(true)}</div>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-[#d7e3e6] bg-white/90 px-4 backdrop-blur">
          <button type="button" className="md:hidden rounded-lg p-2 hover:bg-[#eef3f5]" onClick={() => setMobileOpen(true)} aria-label="Ouvrir le menu">
            <Menu size={18} />
          </button>
          <nav className="hidden min-w-0 items-center gap-1 text-xs text-[#6b858c] sm:flex">
            <Link href="/dashboard" className="hover:text-[#0b4a56]">
              Accueil
            </Link>
            {crumbs.map((c) => (
              <span key={c.href} className="flex items-center gap-1">
                <span>/</span>
                <Link href={c.href} className="capitalize hover:text-[#0b4a56]">
                  {c.label}
                </Link>
              </span>
            ))}
          </nav>
          <GlobalSearch />
          <Link href="/assistant" className="hidden items-center gap-2 rounded-lg border border-[#d7e3e6] px-3 py-2 text-sm text-[#0b4a56] hover:bg-[#f4f8f9] sm:inline-flex">
            <Bot size={16} /> Assistant
          </Link>
          <Link href="/notifications" className="relative rounded-lg p-2 hover:bg-[#eef3f5]" aria-label="Notifications">
            <Bell size={18} />
            {unread > 0 ? <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-[#d4a017]" /> : null}
          </Link>
          <Link href="/settings" className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 hover:bg-[#eef3f5]">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0b4a56] text-xs font-semibold text-white">
              {user.fullName
                .split(" ")
                .map((p) => p[0])
                .slice(0, 2)
                .join("")}
            </span>
            <span className="hidden leading-tight lg:block">
              <span className="block text-sm font-medium text-[#071c22]">{user.fullName}</span>
              <span className="block text-[11px] capitalize text-[#6b858c]">{fr(user.role)}</span>
            </span>
          </Link>
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}

function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Array<{ id: string; name: string; sku: string | null; brand: string | null }>>([]);
  const [, start] = useTransition();

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      start(async () => {
        const rows = await searchProductsAction(q.trim());
        setHits(rows);
      });
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="relative mx-auto min-w-0 flex-1 max-w-xl">
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8aa0a6]" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Rechercher nom, SKU, code-barres, référence…"
        className="h-10 w-full rounded-lg border border-[#d7e3e6] bg-[#f7fafb] pl-9 pr-3 text-sm outline-none focus:border-[#0b4a56] focus:bg-white"
      />
      {hits.length ? (
        <div className="absolute top-11 z-40 w-full overflow-hidden rounded-xl border border-[#d7e3e6] bg-white shadow-lg">
          {hits.map((h) => (
            <button
              key={h.id}
              type="button"
              className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-[#f4f8f9]"
              onClick={() => {
                setQ("");
                setHits([]);
                router.push(`/products/${h.id}`);
              }}
            >
              <span className="font-medium">{h.name}</span>
              <span className="text-xs text-[#6b858c]">
                {h.brand} {h.sku ? `· ${h.sku}` : ""}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
