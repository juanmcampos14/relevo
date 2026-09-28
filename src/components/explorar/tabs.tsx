"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";

export function ExplorarTabs({ slug }: { slug: string }) {
  const pathname = usePathname();
  const base = `/w/${slug}/explorar`;
  const tabs = [
    { href: base, label: "Campañas", active: pathname === base || pathname.startsWith(`${base}/c/`) },
    { href: `${base}/registros`, label: "Registros", active: pathname.startsWith(`${base}/registros`) },
    { href: `${base}/verticales`, label: "Verticales", active: pathname.startsWith(`${base}/verticales`) },
    { href: `${base}/fuentes`, label: "Fuentes", active: pathname.startsWith(`${base}/fuentes`) },
  ];
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto border-b">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={cn(
            "-mb-px border-b-2 border-transparent px-3 py-2 text-sm whitespace-nowrap text-muted-foreground hover:text-foreground",
            t.active && "border-primary font-medium text-foreground",
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
