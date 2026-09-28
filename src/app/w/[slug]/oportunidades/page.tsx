import type { Metadata } from "next";
import { NotAvailable, PageHeader } from "@/components/app/bits";

export const metadata: Metadata = { title: "Oportunidades" };

export default function OportunidadesPage() {
  return (
    <>
      <PageHeader title="Oportunidades" subtitle="Research → Finding → Verificación → Revisión humana → Candidata → Aprobación → Dealflow" />
      <div className="space-y-3">
        <NotAvailable what="Bandeja de hallazgos, candidatas, decisiones y dealflow" when="En construcción para el Corte B (objetivo: lunes 5/10). Un hallazgo nunca se convierte solo en oportunidad." />
      </div>
    </>
  );
}
