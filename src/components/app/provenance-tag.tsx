import { cn } from "cn";
import { BASIS, CHANNEL, type Basis, type Channel } from "@/domain/provenance";

const BASIS_TONE: Record<Basis, string> = {
  observado: "border-emerald-500/40 text-emerald-800 dark:text-emerald-300",
  documentado: "border-sky-500/40 text-sky-800 dark:text-sky-300",
  declarado: "border-violet-500/40 text-violet-800 dark:text-violet-300",
  calculado: "border-amber-500/40 text-amber-800 dark:text-amber-300",
  inferido: "border-orange-500/40 text-orange-800 dark:text-orange-300",
  propuesto_ia: "border-orange-500/40 text-orange-800 dark:text-orange-300",
  no_determinado: "border-border text-muted-foreground",
};

/** Procedencia: canal de origen · base de la afirmación (· detalle). La misma en todo el sistema. */
export function ProvenanceTag({ channel, basis, detail, className }: { channel: Channel; basis: Basis; detail?: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] whitespace-nowrap", BASIS_TONE[basis], className)} title={`Canal: ${CHANNEL[channel]} · Base: ${BASIS[basis]}`}>
      <span className="font-medium">{CHANNEL[channel]}</span>
      <span>· {BASIS[basis].toLowerCase()}</span>
      {detail ? <span className="opacity-80">· {detail}</span> : null}
    </span>
  );
}
