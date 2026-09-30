"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";

export function ExplorarTabs({ slug }: { slug: string }) {
  const pathname = usePathname();
  const base = `/w/${slug}/explorar`;
  const tabs = [
    { href: base, label: "Misiones", active: pathname === base || pathname.startsWith(`${base}/c/`) },
    { href: `${base}/registros`, label: "Empresas y activos", active: pathname.startsWith(`${base}/registros`) },
    { href: `${base}/personas`, label: "Personas", active: pathname.startsWith(`${base}/personas`) },
    { href: `${base}/actividades`, label: "Actividades", active: pathname.startsWith(`${base}/actividades`) },
    { href: `${base}/evidencia`, label: "Evidencia", active: pathname.startsWith(`${base}/evidencia`) },
    { href: `${base}/sin-identificar`, label: "Sin identificar", active: pathname.startsWith(`${base}/sin-identificar`) },
    { href: `${base}/calidad`, label: "Calidad", active: pathname.startsWith(`${base}/calidad`) },
    { href: `${base}/fuentes`, label: "Fuentes", active: pathname.startsWith(`${base}/fuentes`) },
    { href: `${base}/verticales`, label: "Verticales", active: pathname.startsWith(`${base}/verticales`) },
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
