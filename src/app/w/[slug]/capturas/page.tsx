import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { CAPTURE_BUCKET } from "@/domain/capture";
import { EmptyState, PageHeader, Pill, Section, formatDate } from "@/components/app/bits";
import { PendingCaptures } from "./pending";
import { AudioPlayer } from "@/components/app/audio-player";

export const metadata: Metadata = { title: "Capturas" };

const statusLabel: Record<string, string> = {
  guardado: "Guardada · sin procesar",
  procesando: "Procesando",
  transcripto: "Transcripta",
  propuestas_listas: "Propuestas para revisar",
  revisado: "Revisada",
  error: "Error",
};

export default async function CapturesPage({ params }: PageProps<"/w/[slug]/capturas">) {
  const { slug } = await params;
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();

  const { data: captures } = await supabase
    .from("captures")
    .select("id, body, captured_at, captured_by, latitude, longitude, location_accuracy_m, ai_consent, status, status_error, ai_summary, capture_media(id, kind, storage_path, duration_ms), proposals(status)")
    .order("captured_at", { ascending: false })
    .limit(50);
  const rows = captures ?? [];

  const paths = rows.flatMap((c) => c.capture_media.map((m) => m.storage_path));
  const authorIds = [...new Set(rows.map((c) => c.captured_by).filter((x): x is string => !!x))];
  const [{ data: signed }, { data: profiles }] = await Promise.all([
    paths.length ? supabase.storage.from(CAPTURE_BUCKET).createSignedUrls(paths, 3600) : Promise.resolve({ data: [] }),
    authorIds.length ? supabase.from("profiles").select("user_id, display_name, email").in("user_id", authorIds) : Promise.resolve({ data: [] }),
  ]);
  const urlOf = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  const nameOf = new Map((profiles ?? []).map((p) => [p.user_id, p.display_name || p.email]));

  return (
    <>
      <PageHeader title="Capturas" subtitle="Material crudo de campo. Nada de esto es un hecho hasta que se estructura y se revisa." />
      {ctx.canEdit && <PendingCaptures />}
      <Section title="Subidas">
        {rows.length === 0 ? (
          <EmptyState title="Todavía no hay capturas">Tocá “Capturar” para guardar una nota, un audio, una foto o tu ubicación.</EmptyState>
        ) : (
          <ul className="divide-y rounded-xl border bg-card shadow-xs">
            {rows.map((c) => (
              <li key={c.id} id={`c-${c.id}`} className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{nameOf.get(c.captured_by ?? "") ?? "—"}</span>
                  <span aria-hidden="true">·</span>
                  <time dateTime={c.captured_at}>{formatDate(c.captured_at, true)}</time>
                  <Pill className={c.status === "error" ? "border-destructive/40 text-destructive" : undefined}>{statusLabel[c.status] ?? c.status}</Pill>
                  {!c.ai_consent && <Pill>Sin IA</Pill>}
                  {c.proposals.some((p) => p.status === "propuesta") && (
                    <Pill className="border-sky-500/40 text-sky-800 dark:text-sky-300">{c.proposals.filter((p) => p.status === "propuesta").length} por decidir</Pill>
                  )}
                  <Link href={`/w/${slug}/capturas/${c.id}`} className="ml-auto inline-flex h-9 items-center text-sm font-medium text-primary hover:underline">
                    {c.proposals.some((p) => p.status === "propuesta") ? "Revisar" : "Ver"}
                  </Link>
                </div>
                {c.body && <p className="line-clamp-4 text-sm whitespace-pre-wrap">{c.body}</p>}
                {c.ai_summary && <p className="text-xs text-muted-foreground">RELEVO: {c.ai_summary}</p>}
                {c.status === "error" && c.status_error && <p className="text-sm text-destructive">{c.status_error}</p>}
                {c.capture_media.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {c.capture_media.map((m) => {
                      const url = urlOf.get(m.storage_path);
                      if (!url) return <Pill key={m.id}>Archivo no disponible</Pill>;
                      return m.kind === "photo" ? (
                        <a key={m.id} href={url} target="_blank" rel="noopener noreferrer" className="relative block size-24 overflow-hidden rounded-lg border">
                          <Image src={url} alt="Foto de la captura" fill unoptimized className="object-cover" sizes="6rem" />
                        </a>
                      ) : (
                        <div key={m.id} className="w-full"><AudioPlayer src={url} durationMs={m.duration_ms} /></div>
                      );
                    })}
                  </div>
                )}
                {c.latitude != null && c.longitude != null && (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${c.latitude},${c.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-9 items-center gap-1.5 text-sm text-primary hover:underline"
                  >
                    <MapPin className="size-4" aria-hidden="true" />
                    Ubicación GPS{c.location_accuracy_m ? ` ±${Math.round(c.location_accuracy_m)} m` : ""} · sin verificar
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
