import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import type { BriefContent } from "@/domain/brief/contract";
import { briefDateLabel } from "@/domain/brief/render";
import { PageHeader } from "@/components/app/bits";
import { BriefView } from "@/components/brief/brief-view";
import { BriefStatus, type DeliveryRow } from "../status";

export const metadata: Metadata = { title: "Morning Brief" };

export default async function BriefDetailPage({ params }: PageProps<"/w/[slug]/brief/[id]">) {
  const { slug, id } = await params;
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();
  const [{ data: b }, { data: deliveries }] = await Promise.all([
    supabase.from("briefs").select("id, brief_date, status, error, generated_at, attempts, usage, content").eq("id", id).maybeSingle(),
    supabase.from("brief_deliveries").select("recipient_email, recipient_name, status, error, sent_at, last_attempt_at, provider").eq("brief_id", id),
  ]);
  if (!b) notFound();
  return (
    <>
      <PageHeader title={`Morning Brief · ${briefDateLabel(b.brief_date)}`} back={<Link href={`/w/${slug}/brief`}>← Morning Brief</Link>} />
      <div className="space-y-8">
        <BriefStatus slug={slug} brief={b} deliveries={(deliveries ?? []) as DeliveryRow[]} isOwner={ctx.role === "owner"} />
        {b.status === "generado" && <BriefView slug={slug} briefId={b.id} content={b.content as unknown as BriefContent} canEdit={ctx.canEdit} />}
      </div>
    </>
  );
}
