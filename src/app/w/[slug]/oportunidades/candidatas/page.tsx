import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { PageHeader, Section } from "@/components/app/bits";
import { OppList, oppListSelect, type OppRow } from "@/components/oportunidades/opp-list";

export const metadata: Metadata = { title: "Candidatas" };

export default async function CandidatasPage({ params }: PageProps<"/w/[slug]/oportunidades/candidatas">) {
  const { slug } = await params;
  await getWorkspaceContext(slug);
  const supabase = await createClient();
  const [{ data: candidates }, { data: rejected }] = await Promise.all([
    supabase.from("opportunities").select(oppListSelect).eq("status", "candidata").order("created_at", { ascending: false }),
    supabase.from("opportunities").select(oppListSelect).eq("status", "rechazada").order("updated_at", { ascending: false }).limit(20),
  ]);
  return (
    <>
      <PageHeader title="Oportunidades candidatas" subtitle="Propuestas desde hallazgos aprobados. Pasan al dealflow solo con una decisión registrada." />
      <OppList slug={slug} rows={(candidates ?? []) as OppRow[]} empty="No hay candidatas. Se proponen desde Hallazgos → Aprobados." />
      {rejected?.length ? (
        <Section title="Rechazadas" className="mt-8">
          <OppList slug={slug} rows={rejected as OppRow[]} empty="" />
        </Section>
      ) : null}
    </>
  );
}
