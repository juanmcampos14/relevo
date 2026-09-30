"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BriefcaseBusiness, CalendarDays, House, Network, Sparkles } from "lucide-react";
import { cn } from "cn";

const items = [
  { href: "", label: "Inicio", icon: House },
  // CRM / red / ecosistema: la memoria estructurada (empresas, personas, activos, actividades, evidencia).
  { href: "/explorar", label: "Red", icon: Network },
  { href: "/agenda", label: "Agenda y mapa", short: "Agenda", icon: CalendarDays },
  { href: "/oportunidades", label: "Oportunidades", short: "Oportun.", icon: BriefcaseBusiness },
  { href: "/ai", label: "RELEVO AI", short: "AI", icon: Sparkles },
];

function useActive(base: string) {
  const pathname = usePathname();
  return (href: string) => (href === "" ? pathname === base : pathname.startsWith(base + href));
}

/** Barra lateral (escritorio). */
export function SideNav({ slug }: { slug: string }) {
  const base = `/w/${slug}`;
  const isActive = useActive(base);
  return (
    <nav aria-label="Principal" className="flex flex-col gap-1">
      {items.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={base + href}
          aria-current={isActive(href) ? "page" : undefined}
          className={cn(
            "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            isActive(href) &&
              "bg-sidebar-accent font-medium text-sidebar-accent-foreground before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-sidebar-primary",
          )}
        >
          <Icon className={cn("size-4", isActive(href) && "text-sidebar-primary")} aria-hidden="true" />
          {label}
        </Link>
      ))}
    </nav>
  );
}

/** Barra inferior (móvil): 5 destinos con objetivos táctiles de 56px. */
export function BottomNav({ slug }: { slug: string }) {
  const base = `/w/${slug}`;
  const isActive = useActive(base);
  return (
    <nav
      aria-label="Principal"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      {items.map(({ href, label, short, icon: Icon }) =>
        href === "/ai" ? (
          // En el teléfono, RELEVO se abre como panel sobre la pantalla actual (con su contexto).
          <button
            key={href}
            type="button"
            onClick={() => window.dispatchEvent(new Event("relevo:open-assistant"))}
            className="flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] text-muted-foreground"
          >
            <Icon className="size-5" aria-hidden="true" />
            RELEVO
          </button>
        ) : (
          <Link
            key={href}
            href={base + href}
            aria-current={isActive(href) ? "page" : undefined}
            className={cn(
              "flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] text-muted-foreground",
              isActive(href) && "font-medium text-primary",
            )}
          >
            <Icon className="size-5" aria-hidden="true" />
            {short ?? label}
          </Link>
        ),
      )}
    </nav>
  );
}
