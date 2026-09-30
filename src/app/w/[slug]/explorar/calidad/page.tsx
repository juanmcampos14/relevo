import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { qualityChecks } from "@/server/quality";
import { PageHeader, Section } from "@/components/app/bits";

export const metadata: Metadata = { title: "Calidad" };

function todayAR() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
}

// Alarmas para que la memoria no se degrade: qué está mal, cuántos y cuáles.
export default async function QualityPage({ params }: PageProps<"/w/[slug]/explorar/calidad">) {
  const { slug } = await params;
  await getWorkspaceContext(slug);
  const supabase = await createClient();
  const checks = await qualityChecks(supabase, slug, todayAR());
  const failing = checks.filter((c) => c.items.length);
  const ok = checks.filter((c) => !c.items.length);

  return (
    <>
      <PageHeader title="Calidad" subtitle="Alarmas de la memoria: datos sin fuente, sin dueño, sin empresa, vencidos o duplicados. No son métricas: son cosas para arreglar." />
      <div className="space-y-6">
        {failing.map((c) => (
          <Section key={c.code} title={`${c.label} (${c.items.length})`}>
            <p className="text-sm text-muted-foreground">{c.why}</p>
            <ul className="divide-y rounded-xl border bg-card shadow-xs">
              {c.items.slice(0, 15).map((i) => (
                <li key={i.ref}><Link href={i.href} className="block px-4 py-2.5 text-sm hover:bg-muted/50">{i.label}</Link></li>
              ))}
              {c.items.length > 15 && <li className="px-4 py-2 text-xs text-muted-foreground">y {c.items.length - 15} más</li>}
            </ul>
          </Section>
        ))}
        {ok.length > 0 && <p className="text-sm text-muted-foreground">Sin alarmas: {ok.map((c) => c.label.toLowerCase()).join(", ")}.</p>}
      </div>
    </>
  );
}
