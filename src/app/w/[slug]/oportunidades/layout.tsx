import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { OportunidadesTabs } from "@/components/oportunidades/tabs";

export default async function OportunidadesLayout({ children, params }: LayoutProps<"/w/[slug]/oportunidades">) {
  const { slug } = await params;
  await getWorkspaceContext(slug);
  const supabase = await createClient();
  const [f, o, d] = await Promise.all([
    supabase.from("findings").select("id", { count: "exact", head: true }).eq("review_status", "pendiente_revision"),
    supabase.from("opportunities").select("id", { count: "exact", head: true }).eq("status", "candidata"),
    supabase.from("decisions").select("id", { count: "exact", head: true }).eq("status", "requested"),
  ]);
  return (
    <>
      <OportunidadesTabs slug={slug} counts={{ pendientes: f.count ?? 0, candidatas: o.count ?? 0, decisiones: d.count ?? 0 }} />
      {children}
    </>
  );
}
