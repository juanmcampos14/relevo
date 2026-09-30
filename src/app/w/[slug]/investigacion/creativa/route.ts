import type { NextRequest } from "next/server";
import { getWorkspaceContext } from "@/server/context";
import { voiceCreativeSvg } from "@/domain/voice/creative";

// Creatividad común (SVG) para revisar. Detrás de la sesión: no es pública hasta aprobarla.
export async function GET(request: NextRequest, ctx: RouteContext<"/w/[slug]/investigacion/creativa">) {
  const { slug } = await ctx.params;
  await getWorkspaceContext(slug);
  const format = request.nextUrl.searchParams.get("formato") === "story" ? "story" : "feed";
  const draft = request.nextUrl.searchParams.get("final") !== "1";
  return new Response(voiceCreativeSvg(format, draft), { headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "private, no-store" } });
}
