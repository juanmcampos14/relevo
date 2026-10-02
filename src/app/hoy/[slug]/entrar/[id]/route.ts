import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rememberMission } from "@/server/mission/current";

// Entrada desde el mail de invitación: acepta lo pendiente, deja elegida la misión y entra directo a ella.
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(`/hoy/${slug}/entrar/${id}`)}`, request.url));
  await supabase.rpc("accept_pending_invitations");
  const { data } = /^[0-9a-f-]{36}$/.test(id) ? await supabase.from("campaigns").select("id").eq("id", id).maybeSingle() : { data: null };
  if (data) await rememberMission(data.id);
  return NextResponse.redirect(new URL(`/hoy/${slug}`, request.url));
}
