import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { clsx } from "@/lib/money";

export function cn(...parts: Array<string | false | null | undefined>) {
  return clsx(...parts);
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" | "gold"; size?: "sm" | "md" | "lg" }) {
  const variants = {
    primary: "bg-[#0b4a56] text-white hover:bg-[#093f49] shadow-sm",
    gold: "bg-[#d4a017] text-[#3b2a00] hover:bg-[#c09210] font-semibold",
    secondary: "bg-white text-[#0b4a56] border border-[#d7e3e6] hover:bg-[#f4f8f9]",
    ghost: "bg-transparent text-[#0b4a56] hover:bg-[#e8f1f3]",
    danger: "bg-[#c53d3d] text-white hover:bg-[#a83333]",
  };
  const sizes = { sm: "h-8 px-3 text-xs", md: "h-10 px-4 text-sm", lg: "h-12 px-5 text-sm" };
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition disabled:opacity-50 disabled:pointer-events-none",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-lg border border-[#d7e3e6] bg-white px-3 text-sm text-[#071c22] outline-none transition placeholder:text-[#8aa0a6] focus:border-[#0b4a56] focus:ring-2 focus:ring-[#0b4a56]/15",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-[88px] w-full rounded-lg border border-[#d7e3e6] bg-white px-3 py-2 text-sm outline-none focus:border-[#0b4a56] focus:ring-2 focus:ring-[#0b4a56]/15",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-10 w-full rounded-lg border border-[#d7e3e6] bg-white px-3 text-sm outline-none focus:border-[#0b4a56] focus:ring-2 focus:ring-[#0b4a56]/15",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#4d6a72]">
      {children}
    </label>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
      {hint ? <p className="mt-1 text-xs text-[#6b858c]">{hint}</p> : null}
    </div>
  );
}

export function Card({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("pp-card p-5", className)} {...props}>
      {children}
    </div>
  );
}

export function Badge({
  children,
  tone = "slate",
}: {
  children: ReactNode;
  tone?: "slate" | "ok" | "warn" | "bad" | "info" | "gold" | "teal";
}) {
  const map = {
    slate: "bg-[#eef3f5] text-[#3d5a62]",
    ok: "bg-[#e5f6ee] text-[#0c8a62]",
    warn: "bg-[#fff4de] text-[#9a5b08]",
    bad: "bg-[#fdecec] text-[#b42323]",
    info: "bg-[#e7f3fa] text-[#1b6f9a]",
    gold: "bg-[#fff4cc] text-[#7a5a08]",
    teal: "bg-[#e4f1f3] text-[#0b4a56]",
  };
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold", map[tone])}>{children}</span>;
}

export function DemoChip() {
  return <span className="demo-chip">Données démo</span>;
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[#071c22]">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-3xl text-sm text-[#4d6a72]">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="pp-card flex flex-col items-center px-8 py-14 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#e8f1f3] text-[#0b4a56]">◇</div>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-2 max-w-md text-sm text-[#4d6a72]">{body}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: string;
  tone?: "ok" | "bad" | "warn";
}) {
  const color = tone === "ok" ? "text-[#0c8a62]" : tone === "bad" ? "text-[#c53d3d]" : tone === "warn" ? "text-[#c47b12]" : "text-[#071c22]";
  return (
    <div className="pp-card p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6b858c]">{label}</p>
      <p className={cn("mt-2 text-2xl font-semibold tabular-nums", color)}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-[#6b858c]">{hint}</p> : null}
    </div>
  );
}

export function Tooltip({ text }: { text: string }) {
  return (
    <span className="group relative ml-1 inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full bg-[#e8f1f3] text-[10px] font-bold text-[#0b4a56]">
      ?
      <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-56 -translate-x-1/2 rounded-lg bg-[#072a33] px-3 py-2 text-left text-[11px] font-medium leading-snug text-white shadow-lg group-hover:block">
        {text}
      </span>
    </span>
  );
}
