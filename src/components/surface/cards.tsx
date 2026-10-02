import Link from "next/link";
import { cn } from "cn";

// Piezas de las pantallas de RELEVO: misma identidad que la conversación (limpia, cálida, una idea por tarjeta).

export const card = "rounded-3xl bg-white px-6 py-5 shadow-[0_1px_2px_rgba(28,27,25,0.04),0_8px_28px_rgba(28,27,25,0.06)]";

export function SurfaceTitle({ title, intro }: { title: string; intro?: string | null }) {
  return (
    <div className="pt-10 sm:pt-14">
      <h1 className="text-[32px] leading-tight font-semibold tracking-[-0.02em] sm:text-[40px]">{title}</h1>
      {intro && <p className="mt-3 max-w-[38rem] text-[18px] leading-relaxed text-[#4A463F]">{intro}</p>}
    </div>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-10 mb-3 px-1 text-[13px] font-medium tracking-[0.08em] text-[#9C968A] uppercase">{children}</h2>;
}

/** Algo para mirar: qué es, una línea, y "Contame" (la pregunta se hace sola en la conversación de abajo). */
export function LookCard({ kicker, title, line, links, then, href, cta = "Contame", mapHref, className }: { kicker?: string | null; title: string; line?: string | null; links?: string[]; then?: string | null; href: string; cta?: string; mapHref?: string | null; className?: string }) {
  return (
    <li className={cn(card, "flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-5", className)}>
      <div className="min-w-0 flex-1">
        {kicker && <p className="text-[13px] text-[#9C968A]">{kicker}</p>}
        <p className="mt-0.5 text-[17px] leading-snug font-medium">{title}</p>
        {line && <p className="mt-1 text-[15px] leading-relaxed text-[#6F6A60]">{line}</p>}
        {links && links.length > 0 && <p className="mt-2 text-[14px] leading-relaxed text-[#6F6A60]"><span className="text-[#1C1B19]">Se relaciona con</span> {links.join(" · ")}</p>}
        {then && <p className="mt-1 text-[14px] leading-relaxed text-[#6F6A60]"><span className="text-[#1C1B19]">Haría:</span> {then}</p>}
      </div>
      <div className="flex shrink-0 gap-2 self-start">
        <Link href={href} scroll={false} className="rounded-full bg-[#EFEBE2] px-4 py-2 text-[14px] font-medium text-[#1C1B19] hover:bg-[#E6E0D3]">{cta}</Link>
        {mapHref && <a href={mapHref} target="_blank" rel="noopener noreferrer" className="rounded-full px-3 py-2 text-[14px] text-[#6F6A60] hover:bg-[#F4F1EA]">Ver en Maps</a>}
      </div>
    </li>
  );
}

/** Preguntar desde una tarjeta; scope = el registro del que se habla (RELEVO lo consulta directo, no lo busca por nombre). */
export const askHref = (base: string, q: string, scope?: string) => `${base}?q=${encodeURIComponent(q)}${scope ? `&scope=${encodeURIComponent(scope)}` : ""}`;
