import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { loadNews } from "@/server/news/queries";
import { EmptyState, PageHeader } from "@/components/app/bits";
import { NewsList, ago } from "@/components/app/news-list";
import { RefreshNewsButton } from "@/components/app/refresh-news-button";
import { refreshNewsNow } from "./actions";
import { NewsAutoRefresh } from "@/components/app/news-auto-refresh";

export const metadata: Metadata = { title: "Noticias" };

export default async function NoticiasPage({ params, searchParams }: PageProps<"/w/[slug]/noticias">) {
  const { slug } = await params;
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase() : "";
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();
  const news = await loadNews(supabase, ctx.workspace.id, 150);
  const rows = q ? news.rows.filter((n) => `${n.title} ${n.source_name ?? ""}`.toLowerCase().includes(q)) : news.rows;

  return (
    <>
      <PageHeader
        title="Noticias · Vaca Muerta y Añelo"
        subtitle={`Notas de los últimos días que nombran “Vaca Muerta” o “Añelo”. ${news.lastOkAt ? `Actualizado ${ago(news.lastOkAt)}.` : ""}`}
        actions={ctx.canEdit ? <RefreshNewsButton action={refreshNewsNow.bind(null, slug)} /> : null}
      />
      <form className="mb-4 max-w-sm">
        <input
          name="q"
          defaultValue={q}
          type="search"
          placeholder="Filtrar: YPF, Añelo, vivienda, logística…"
          aria-label="Filtrar noticias"
          className="h-10 w-full rounded-lg border bg-card px-3 text-sm"
        />
      </form>
      <NewsAutoRefresh active={news.refreshing} />
      {news.lastError && <p className="mb-4 text-sm text-destructive">Último intento de actualización falló: {news.lastError}</p>}
      {rows.length ? (
        <NewsList slug={slug} rows={rows} canEdit={ctx.canEdit} showSnippet />
      ) : (
        <EmptyState title={q ? "Ninguna noticia coincide con el filtro" : "Todavía no hay noticias"} />
      )}
      <p className="mt-6 text-xs text-muted-foreground">
        Fuente: Bing Noticias (Google Noticias como respaldo), búsqueda RSS de uso interno. Los títulos y enlaces pertenecen a cada medio. “Pasar a hallazgo” crea un hallazgo
        pendiente de revisión con la nota como fuente; nunca una oportunidad.
      </p>
    </>
  );
}
