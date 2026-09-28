import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { dealflowStage } from "@/domain/catalogs";
import { EmptyState, PageHeader, Section } from "@/components/app/bits";
import { OppList, oppListSelect, type OppRow } from "@/components/oportunidades/opp-list";

export const metadata: Metadata = { title: "Dealflow" };

export default async function DealflowPage({ params }: PageProps<"/w/[slug]/oportunidades/dealflow">) {
  const { slug } = await params;
  await getWorkspaceContext(slug);
  const supabase = await createClient();
  const { data } = await supabase.from("opportunities").select(oppListSelect).eq("status", "aprobada").order("updated_at", { ascending: false });
  const rows = (data ?? []) as OppRow[];
  const stages = dealflowStage.values.filter((s) => rows.some((r) => r.stage === s));
  return (
    <>
      <PageHeader title="Dealflow" subtitle="Oportunidades aprobadas por decisión, por etapa. La etapa comercial es independiente del roadmap." />
      {rows.length === 0 ? (
        <EmptyState title="Todavía no hay oportunidades aprobadas" />
      ) : (
        <div className="space-y-8">
          {stages.map((s) => (
            <Section key={s} title={`${dealflowStage.label(s)} (${rows.filter((r) => r.stage === s).length})`}>
              <OppList slug={slug} rows={rows.filter((r) => r.stage === s)} empty="" />
            </Section>
          ))}
        </div>
      )}
    </>
  );
}
