"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";

export function OportunidadesTabs({ slug, counts }: { slug: string; counts: { pendientes: number; candidatas: number; decisiones: number } }) {
  const pathname = usePathname();
  const base = `/w/${slug}/oportunidades`;
  const tabs = [
    { href: base, label: "Hallazgos", badge: counts.pendientes, active: pathname === base },
    { href: `${base}/candidatas`, label: "Candidatas", badge: counts.candidatas, active: pathname.startsWith(`${base}/candidatas`) },
    { href: `${base}/dealflow`, label: "Dealflow", active: pathname.startsWith(`${base}/dealflow`) || pathname.startsWith(`${base}/o/`) },
    { href: `${base}/decisiones`, label: "Decisiones", badge: counts.decisiones, active: pathname.startsWith(`${base}/decisiones`) },
    { href: `${base}/briefings`, label: "Briefings", active: pathname.startsWith(`${base}/briefings`) },
  ];
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto border-b">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={cn(
            "-mb-px flex items-center gap-1.5 border-b-2 border-transparent px-3 py-2 text-sm whitespace-nowrap text-muted-foreground hover:text-foreground",
            t.active && "border-primary font-medium text-foreground",
          )}
        >
          {t.label}
          {t.badge ? <span className="rounded-full bg-primary px-1.5 text-[11px] leading-5 text-primary-foreground">{t.badge}</span> : null}
        </Link>
      ))}
    </div>
  );
}
