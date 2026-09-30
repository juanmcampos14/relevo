import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { cohortFor, loadPublicExperiment } from "@/server/voice/experiment";
import { VoiceForm } from "@/components/voice/voice-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { absolute: "Voice of Añelo · RELEVO" }, robots: { index: false, follow: false } };

// Landing pública del relevamiento. Solo abre si el experimento está activo, o con el enlace de revisión
// (borrador / piloto). La identidad, la finalidad, el responsable y el contacto se muestran siempre.
export default async function PublicSurveyPage({ params, searchParams }: PageProps<"/r/[slug]">) {
  const { slug } = await params;
  const sp = await searchParams;
  const e = await loadPublicExperiment(createAdminClient(), slug);
  if (!e) notFound();
  const token = typeof sp.t === "string" ? sp.t : null;
  const cohort = cohortFor(e, token, sp.modo === "prueba");
  return (
    <main className="min-h-dvh bg-[#f3f4f1] text-[#162d31]">
      <div className="mx-auto max-w-xl px-4 py-6 sm:py-10">
        <header className="mb-5">
          <p className="text-xs font-bold tracking-[0.14em]">RELEVO · RELEVAMIENTO PRIVADO</p>
          <h1 className="mt-2 text-3xl font-semibold">{e.title}</h1>
          <p className="mt-1 text-[#52676c]">Cómo se vive y se trabaja en Añelo, contado por quienes están ahí.</p>
          {cohort && cohort !== "real" && (
            <p className="mt-3 rounded-xl bg-[#fff1cd] p-3 text-sm">
              {cohort === "prueba" ? "Modo de prueba: estas respuestas no cuentan como reales." : "Piloto: gracias por ayudarnos a probar el relevamiento antes de abrirlo."}
            </p>
          )}
        </header>
        {cohort ? (
          <VoiceForm slug={slug} definition={e.definition} token={token} test={sp.modo === "prueba"} identity={{ responsible: e.responsible_name, contact: e.contact_email, notice: e.privacy_notice, retentionDays: e.retention_days }} />
        ) : (
          <section className="rounded-2xl bg-white p-6">
            <h2 className="text-xl font-semibold">Este relevamiento no está abierto</h2>
            <p className="mt-2 text-[#52676c]">Todavía no empezó o ya terminó. Gracias por tu interés.</p>
          </section>
        )}
        <footer className="mt-6 space-y-1 text-xs leading-relaxed text-[#52676c]">
          <p>RELEVO · relevamiento de investigación. No es una encuesta representativa ni una promesa de servicios.</p>
          {e.responsible_name && <p>Responsable: {e.responsible_name}{e.contact_email ? <> · Contacto: <a className="underline" href={`mailto:${e.contact_email}`}>{e.contact_email}</a></> : null}</p>}
        </footer>
      </div>
    </main>
  );
}
