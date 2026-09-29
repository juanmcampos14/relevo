import type { ReactNode } from "react";
import { cn } from "cn";
import { verificationStatus } from "@/domain/catalogs";

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-6 space-y-1">
      {back && <div className="text-sm text-muted-foreground">{back}</div>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <div className="text-sm text-muted-foreground">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

const verificationTone: Record<string, string> = {
  unverified: "bg-muted text-muted-foreground",
  partially_verified: "bg-amber-500/10 text-amber-800 dark:text-amber-300",
  publicly_verified: "bg-sky-500/10 text-sky-800 dark:text-sky-300",
  field_verified: "bg-emerald-500/12 text-emerald-800 dark:text-emerald-300",
  contradicted: "bg-destructive/10 text-destructive",
  stale: "bg-orange-500/10 text-orange-800 dark:text-orange-300",
};

export function VerificationBadge({ status }: { status: string }) {
  return (
    <span className={cn("inline-flex h-5 items-center rounded-full px-2 text-xs font-medium whitespace-nowrap", verificationTone[status])}>
      {verificationStatus.label(status)}
    </span>
  );
}

/** Verificación + marca DEMO. */
export function StatusBadges({ verification, isDemo }: { verification: string; isDemo: boolean }) {
  return (
    <>
      <VerificationBadge status={verification} />
      <DemoBadge show={isDemo} />
    </>
  );
}

export function DemoBadge({ show = true }: { show?: boolean }) {
  if (!show) return null;
  return (
    <span className="inline-flex h-5 items-center rounded-full bg-fuchsia-500/15 px-2 text-xs font-semibold tracking-wide text-fuchsia-800 dark:text-fuchsia-300">
      DEMO
    </span>
  );
}

// Color por estado de objetivo; siempre acompaña al texto (nunca color solo).
const targetTone: Record<string, string> = {
  investigacion: "bg-muted text-muted-foreground border-transparent",
  calificacion: "bg-sky-500/10 text-sky-800 border-transparent dark:text-sky-300",
  contacto_pendiente: "bg-indigo-500/10 text-indigo-800 border-transparent dark:text-indigo-300",
  contactado: "bg-violet-500/10 text-violet-800 border-transparent dark:text-violet-300",
  reunion: "bg-amber-500/15 text-amber-900 border-transparent dark:text-amber-300",
  diagnostico: "bg-emerald-500/12 text-emerald-800 border-transparent dark:text-emerald-300",
  oportunidad: "bg-primary/10 text-primary border-transparent",
  descartado: "bg-muted text-muted-foreground line-through border-transparent",
};
export function statusTone(status: string) {
  return targetTone[status] ?? "";
}

export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-5 items-center rounded-full border px-2 text-xs whitespace-nowrap text-muted-foreground", className)}>
      {children}
    </span>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed bg-card/60 p-6 text-center">
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

export function Section({ title, actions, children, className }: { title: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          <span className="h-3 w-1 rounded-full bg-primary" aria-hidden="true" />
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function NotAvailable({ what, when }: { what: string; when: string }) {
  return (
    <div className="rounded-lg border border-dashed bg-muted/40 p-6">
      <p className="text-sm font-medium">{what}: no disponible todavía</p>
      <p className="mt-1 text-sm text-muted-foreground">{when}</p>
    </div>
  );
}

export function formatDate(d: string | null | undefined, withTime = false) {
  if (!d) return "—";
  const date = new Date(d.length === 10 ? `${d}T12:00:00` : d);
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(date);
}
