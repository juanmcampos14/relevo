import Image from "next/image";
import { ExternalLink } from "lucide-react";
import { newsToFinding } from "@/app/w/[slug]/noticias/actions";
import { TOPICS, topicsOf } from "@/domain/news";
import { cn } from "cn";

export type NewsRow = {
  id: string;
  title: string;
  url: string;
  source_name: string | null;
  published_at: string | null;
  snippet: string | null;
  finding_id: string | null;
  image_url?: string | null;
};

const rtf = new Intl.RelativeTimeFormat("es-AR", { numeric: "auto" });
export function ago(iso: string | null) {
  if (!iso) return "sin fecha";
  const diffH = (new Date(iso).getTime() - Date.now()) / 3_600_000;
  if (Math.abs(diffH) < 1) return "hace minutos";
  if (Math.abs(diffH) < 24) return rtf.format(Math.round(diffH), "hour");
  return rtf.format(Math.round(diffH / 24), "day");
}

/** Miniatura 16:9 (espacio reservado: no mueve el layout). Sin imagen: inicial del medio. */
function Thumb({ n, className }: { n: NewsRow; className?: string }) {
  return (
    <div className={cn("relative aspect-video shrink-0 overflow-hidden rounded-lg bg-sidebar", className)}>
      {n.image_url ? (
        // Miniaturas del proveedor ya dimensionadas (400×225): se sirven tal cual.
        <Image src={n.image_url} alt="" fill unoptimized loading="lazy" className="object-cover" sizes="(min-width: 1024px) 20rem, 50vw" />
      ) : (
        <div className="flex h-full items-center justify-center bg-gradient-to-br from-sidebar to-[oklch(0.35_0.06_40)] text-2xl font-semibold text-white/80">
          {(n.source_name ?? "?").trim().charAt(0).toUpperCase()}
        </div>
      )}
    </div>
  );
}

function Meta({ slug, n, canEdit }: { slug: string; n: NewsRow; canEdit: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      {topicsOf(n).map((t) => (
        <span key={t} className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium ${t === "anelo" ? "bg-accent text-accent-foreground" : "bg-primary/10 text-primary"}`}>
          {TOPICS[t].label}
        </span>
      ))}
      <span>{n.source_name ?? "Medio sin identificar"}</span>
      <span aria-hidden="true">·</span>
      <time dateTime={n.published_at ?? undefined}>{ago(n.published_at)}</time>
      {n.finding_id ? (
        <a href={`/w/${slug}/oportunidades?h=${n.finding_id}#h-${n.finding_id}`} className="ml-auto text-primary hover:underline">Ver hallazgo</a>
      ) : canEdit ? (
        <form action={newsToFinding.bind(null, slug, n.id)} className="ml-auto">
          <button className="rounded-md px-1.5 py-0.5 text-primary hover:bg-primary/10" title="Crea un hallazgo pendiente de revisión con esta nota como fuente">
            Pasar a hallazgo
          </button>
        </form>
      ) : null}
    </div>
  );
}

function Title({ n, className }: { n: NewsRow; className?: string }) {
  return (
    <a href={n.url} target="_blank" rel="noopener noreferrer" className={cn("group flex items-start gap-1.5 font-medium hover:text-primary", className)}>
      <span>{n.title}</span>
      <ExternalLink className="mt-0.5 size-3.5 shrink-0 opacity-50 group-hover:opacity-100" aria-hidden="true" />
      <span className="sr-only">(abre en otra pestaña)</span>
    </a>
  );
}

/** Inicio: tarjetas con foto arriba. */
export function NewsCards({ slug, rows, canEdit }: { slug: string; rows: NewsRow[]; canEdit: boolean }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((n) => (
        <li key={n.id} className="flex flex-col overflow-hidden rounded-xl border bg-card shadow-xs">
          <a href={n.url} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden="true">
            <Thumb n={n} className="rounded-none" />
          </a>
          <div className="flex flex-1 flex-col gap-2 p-3">
            <Title n={n} className="line-clamp-3 text-sm" />
            <div className="mt-auto">
              <Meta slug={slug} n={n} canEdit={canEdit} />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Página de noticias: lista con miniatura a la izquierda y resumen. */
export function NewsList({ slug, rows, canEdit, showSnippet = false }: { slug: string; rows: NewsRow[]; canEdit: boolean; showSnippet?: boolean }) {
  return (
    <ul className="divide-y rounded-xl border bg-card shadow-xs">
      {rows.map((n) => (
        <li key={n.id} className="flex gap-3 p-3">
          <a href={n.url} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden="true" className="w-28 sm:w-40">
            <Thumb n={n} />
          </a>
          <div className="min-w-0 flex-1 space-y-1">
            <Title n={n} className="text-sm" />
            {showSnippet && n.snippet && <p className="line-clamp-2 text-sm text-muted-foreground">{n.snippet}</p>}
            <Meta slug={slug} n={n} canEdit={canEdit} />
          </div>
        </li>
      ))}
    </ul>
  );
}
