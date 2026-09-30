import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { Pill, formatDate } from "@/components/app/bits";
import { briefDateLabel } from "@/domain/brief/render";
import { resendBrief, retryBriefNow } from "./actions";

// Estado del brief: se generó / se envió / falló, por destinatario. Sin analítica de marketing.

export type BriefRow = { id: string; brief_date: string; status: string; error: string | null; generated_at: string | null; attempts: number; usage: unknown };
export type DeliveryRow = { recipient_email: string; recipient_name: string | null; status: string; error: string | null; sent_at: string | null; last_attempt_at: string | null; provider: string | null };

const STATUS: Record<string, string> = {
  recolectando: "Recolectando fuentes…",
  investigando: "Investigando…",
  sintetizando: "Armando el brief…",
  generado: "Generado",
  fallido: "Falló la generación",
};

export function BriefStatus({ slug, brief, deliveries, isOwner, link = false }: { slug: string; brief: BriefRow; deliveries: DeliveryRow[]; isOwner: boolean; link?: boolean }) {
  const failedSends = deliveries.filter((d) => d.status !== "enviado").length;
  const cost = Object.values((brief.usage as Record<string, { costUsd?: number }>) ?? {}).reduce((a, u) => a + (u?.costUsd ?? 0), 0);
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex flex-wrap items-center gap-2">
        {link ? <Link href={`/w/${slug}/brief/${brief.id}`} className="font-medium hover:underline">{briefDateLabel(brief.brief_date)}</Link> : <span className="font-medium">{briefDateLabel(brief.brief_date)}</span>}
        <Pill className={brief.status === "generado" ? "border-primary/40 text-primary" : brief.status === "fallido" ? "border-destructive/50 text-destructive" : ""}>{STATUS[brief.status] ?? brief.status}</Pill>
        {brief.generated_at && <span className="text-xs text-muted-foreground">{formatDate(brief.generated_at, true)}</span>}
        {cost > 0 && <span className="text-xs text-muted-foreground">· costo IA ≈ USD {cost.toFixed(2)}</span>}
      </div>
      {brief.error && <p className="text-sm text-destructive">Último error ({brief.attempts} intento{brief.attempts === 1 ? "" : "s"}): {brief.error}</p>}
      {deliveries.length > 0 && (
        <ul className="space-y-1 text-sm">
          {deliveries.map((d) => (
            <li key={d.recipient_email} className="flex flex-wrap items-center gap-2">
              <span>{d.recipient_name || d.recipient_email}</span>
              <Pill className={d.status === "enviado" ? "border-primary/40 text-primary" : d.status === "fallido" ? "border-destructive/50 text-destructive" : ""}>{d.status}</Pill>
              <span className="text-xs text-muted-foreground">{d.sent_at ? formatDate(d.sent_at, true) : d.last_attempt_at ? `último intento ${formatDate(d.last_attempt_at, true)}` : ""}{d.provider ? ` · ${d.provider}` : ""}</span>
              {d.error && <span className="text-xs text-destructive">{d.error}</span>}
            </li>
          ))}
        </ul>
      )}
      {isOwner && (
        <div className="flex flex-wrap gap-2">
          {(brief.status === "fallido" || (brief.error && brief.status !== "generado")) && (
            <ActionForm action={retryBriefNow.bind(null, slug, brief.id)} className="space-y-0"><SubmitButton variant="outline" className="h-8">Reintentar desde donde falló</SubmitButton></ActionForm>
          )}
          {brief.status === "generado" && failedSends > 0 && (
            <ActionForm action={resendBrief.bind(null, slug, brief.id)} className="space-y-0"><SubmitButton variant="outline" className="h-8">Reenviar pendientes</SubmitButton></ActionForm>
          )}
        </div>
      )}
    </div>
  );
}
