import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import type { BriefingContent } from "@/server/briefing";
import { profileNames } from "@/server/findings";
import { PageHeader, Pill, Section, formatDate } from "@/components/app/bits";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { TextAreaField } from "@/components/app/fields";
import { CopyBriefing } from "@/components/oportunidades/copy-briefing";
import { addComment, publishBriefing } from "../../actions";

export default async function BriefingPage({ params }: PageProps<"/w/[slug]/oportunidades/briefings/[briefingId]">) {
  const { slug, briefingId } = await params;
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();
  const { data: b } = await supabase
    .from("briefings")
    .select("id, title, scope, audience_user_id, status, period_start, period_end, content, created_at, created_by, published_at")
    .eq("id", briefingId)
    .maybeSingle();
  if (!b) notFound();
  const { data: comments } = await supabase.from("comments").select("id, body, author_id, created_at").eq("briefing_id", briefingId).order("created_at");
  const names = await profileNames(supabase, [b.created_by, b.audience_user_id, ...(comments ?? []).map((c) => c.author_id)]);
  const content = b.content as unknown as BriefingContent;
  const plain = [
    b.title,
    `Periodo: ${formatDate(b.period_start)} → ${formatDate(b.period_end)}`,
    ...content.sections.flatMap((s) => [``, s.title.toUpperCase(), ...(s.items.length ? s.items.map((i) => `- ${i.text}${i.meta ? ` (${i.meta})` : ""}`) : [s.empty])]),
    ``,
    content.note,
  ].join("\n");

  return (
    <article className="max-w-3xl">
      <PageHeader
        back={<Link href={`/w/${slug}/oportunidades/briefings`} className="hover:underline">← Briefings</Link>}
        title={b.title}
        subtitle={`${formatDate(b.period_start, true)} → ${formatDate(b.period_end, true)} · generado por ${names.get(b.created_by ?? "") ?? "—"}${b.scope === "personal" ? ` para ${names.get(b.audience_user_id ?? "") ?? "—"}` : ""}`}
        actions={
          <>
            <Pill className={b.status === "publicado_en_app" ? "border-primary text-primary" : ""}>
              {b.status === "publicado_en_app" ? `Publicado en la app ${formatDate(b.published_at)}` : "Borrador"}
            </Pill>
            <CopyBriefing text={plain} />
          </>
        }
      />
      <div className="space-y-8">
        {content.sections.map((s) => (
          <Section key={s.key} title={s.title}>
            {s.items.length ? (
              <ul className="space-y-2">
                {s.items.map((i, n) => (
                  <li key={n} className="text-sm">
                    {i.href ? <Link href={i.href} className="hover:underline">{i.text}</Link> : i.text}
                    {i.meta && <span className="ml-2 text-xs text-muted-foreground">{i.meta}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{s.empty}</p>
            )}
          </Section>
        ))}
        <p className="text-xs text-muted-foreground">{content.note}</p>
      </div>

      {ctx.canEdit && b.status === "borrador" && (
        <form action={publishBriefing.bind(null, slug, briefingId)} className="mt-6">
          <button className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm text-primary-foreground hover:bg-primary/85">
            Publicar en la app (visible para todo el workspace)
          </button>
          <p className="mt-1 text-xs text-muted-foreground">No se envía por email: todavía no hay un proveedor integrado.</p>
        </form>
      )}

      <Section title="Comentarios" className="mt-10">
        <div className="space-y-3">
          {(comments ?? []).map((c) => (
            <div key={c.id} className="text-sm">
              <span className="font-medium">{names.get(c.author_id) ?? "—"}</span>{" "}
              <span className="text-xs text-muted-foreground">{formatDate(c.created_at, true)}</span>
              <p className="whitespace-pre-wrap">{c.body}</p>
            </div>
          ))}
        </div>
        <ActionForm action={addComment.bind(null, slug, { briefing_id: briefingId })} resetOnSuccess className="space-y-2">
          <TextAreaField name="body" label="Comentario" rows={2} />
          <SubmitButton variant="outline">Comentar</SubmitButton>
        </ActionForm>
      </Section>
    </article>
  );
}
