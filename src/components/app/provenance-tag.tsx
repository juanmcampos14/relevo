import { cn } from "cn";
import { PROVENANCE, type ProvenanceTag as Tag } from "@/domain/provenance";

const TONE: Record<Tag, string> = {
  campo: "border-emerald-500/40 text-emerald-800 dark:text-emerald-300",
  relevo: "border-sky-500/40 text-sky-800 dark:text-sky-300",
  web: "border-violet-500/40 text-violet-800 dark:text-violet-300",
  calculo: "border-amber-500/40 text-amber-800 dark:text-amber-300",
  hipotesis: "border-orange-500/40 text-orange-800 dark:text-orange-300",
  desconocido: "border-border text-muted-foreground",
};

/** Etiqueta de procedencia: la misma en evidencia, economía, respuestas de RELEVO y vista ejecutiva. */
export function ProvenanceTag({ tag, detail, className }: { tag: Tag; detail?: string; className?: string }) {
  return (
    <span title={PROVENANCE[tag].hint} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", TONE[tag], className)}>
      {PROVENANCE[tag].label}
      {detail ? <span className="font-normal opacity-80">· {detail}</span> : null}
    </span>
  );
}
