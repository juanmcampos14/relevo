import type { Metadata } from "next";
import { NotAvailable, PageHeader } from "@/components/app/bits";

export const metadata: Metadata = { title: "RELEVO AI" };

export default function AiPage() {
  return (
    <>
      <PageHeader title="RELEVO AI" />
      <NotAvailable
        what="RELEVO AI"
        when="Fuera de P0 por decisión de Tano y Juan. Llega en P1, acotada a los datos de este workspace, citando registros y sin ejecutar acciones sin aprobación."
      />
    </>
  );
}
