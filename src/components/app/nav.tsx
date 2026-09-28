"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BriefcaseBusiness, CalendarDays, Compass, House, Sparkles } from "lucide-react";
import { cn } from "cn";

const items = [
  { href: "", label: "Inicio", icon: House },
  { href: "/explorar", label: "Explorar", icon: Compass },
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
            "flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
            isActive(href) && "bg-muted font-medium text-foreground",
          )}
        >
          <Icon className="size-4" />
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
      {items.map(({ href, label, short, icon: Icon }) => (
        <Link
          key={href}
          href={base + href}
          aria-current={isActive(href) ? "page" : undefined}
          className={cn(
            "flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] text-muted-foreground",
            isActive(href) && "font-medium text-primary",
          )}
        >
          <Icon className="size-5" />
          {short ?? label}
        </Link>
      ))}
    </nav>
  );
}
