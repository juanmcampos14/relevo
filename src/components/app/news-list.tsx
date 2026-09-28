import { ExternalLink } from "lucide-react";
import { newsToFinding } from "@/app/w/[slug]/noticias/actions";

export type NewsRow = {
  id: string;
  title: string;
  url: string;
  source_name: string | null;
  published_at: string | null;
  snippet: string | null;
  finding_id: string | null;
};

const rtf = new Intl.RelativeTimeFormat("es-AR", { numeric: "auto" });
export function ago(iso: string | null) {
  if (!iso) return "sin fecha";
  const diffH = (new Date(iso).getTime() - Date.now()) / 3_600_000;
  if (Math.abs(diffH) < 1) return "hace minutos";
  if (Math.abs(diffH) < 24) return rtf.format(Math.round(diffH), "hour");
  return rtf.format(Math.round(diffH / 24), "day");
}

export function NewsList({ slug, rows, canEdit, showSnippet = false }: { slug: string; rows: NewsRow[]; canEdit: boolean; showSnippet?: boolean }) {
  return (
    <ul className="divide-y rounded-xl border bg-card shadow-xs">
      {rows.map((n) => (
        <li key={n.id} className="space-y-1 p-3">
          <a href={n.url} target="_blank" rel="noopener noreferrer" className="group flex items-start gap-1.5 text-sm font-medium hover:text-primary">
            <span>{n.title}</span>
            <ExternalLink className="mt-0.5 size-3.5 shrink-0 opacity-50 group-hover:opacity-100" aria-hidden="true" />
            <span className="sr-only">(abre en otra pestaña)</span>
          </a>
          {showSnippet && n.snippet && <p className="text-sm text-muted-foreground">{n.snippet}</p>}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
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
        </li>
      ))}
    </ul>
  );
}
