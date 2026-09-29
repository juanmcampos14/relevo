import Link from "next/link";
import { Search } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { BottomNav, SideNav } from "@/components/app/nav";
import { role as roleCatalog } from "@/domain/catalogs";
import { LogoMark } from "@/components/app/brand";
import { CaptureProvider, PendingCapturesBadge } from "@/components/app/capture/capture-dock";

export default async function WorkspaceLayout({ children, params }: LayoutProps<"/w/[slug]">) {
  const { slug } = await params;
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();
  const [{ data: profile }, { data: mission }] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("user_id", ctx.user.id).maybeSingle(),
    // Las capturas se asocian a la misión activa más reciente (Añelo · Viaje 01).
    supabase.from("campaigns").select("id").eq("status", "activa").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const aiAllowed = (ctx.workspace.settings as { ai_processing_consent?: boolean } | null)?.ai_processing_consent === true;

  return (
    <CaptureProvider
      slug={slug}
      workspaceId={ctx.workspace.id}
      campaignId={mission?.id ?? null}
      aiAllowed={aiAllowed}
      canEdit={ctx.canEdit}
    >
      <div className="flex min-h-dvh">
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col bg-sidebar px-3 py-4 text-sidebar-foreground md:flex">
          <Link href={`/w/${slug}`} className="mb-6 flex items-center gap-2.5 px-2">
            <LogoMark className="size-8" />
            <div>
              <div className="text-sm font-semibold tracking-tight text-white">RELEVO OS</div>
              <div className="text-xs text-sidebar-foreground/70">{ctx.workspace.name}</div>
            </div>
          </Link>
          <SideNav slug={slug} />
          <div className="mt-auto space-y-1.5 border-t border-sidebar-border px-3 pt-4 text-xs text-sidebar-foreground/75">
            <Link href={`/w/${slug}/miembros`} className="block hover:underline">Miembros</Link>
            <Link href={`/w/${slug}/integraciones`} className="block hover:underline">Integraciones</Link>
            <Link href="/cuenta" className="block hover:underline">
              {profile?.display_name || ctx.user.email} · {roleCatalog.label(ctx.role)}
              {ctx.canApprove ? " · aprueba" : ""}
            </Link>
            <form action="/auth/signout" method="post">
              <button className="hover:underline">Salir</button>
            </form>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur">
            <Link href={`/w/${slug}`} className="flex items-center gap-2 text-sm font-semibold md:hidden">
              <LogoMark className="size-6" />
              {ctx.workspace.name}
            </Link>
            <form action={`/w/${slug}/buscar`} className="relative ml-auto w-full max-w-xs md:ml-0">
              <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                name="q"
                type="search"
                placeholder="Buscar empresas, activos, contactos…"
                aria-label="Buscar"
                className="h-9 w-full rounded-lg border bg-card pr-3 pl-8 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </form>
            <PendingCapturesBadge />
            <Link href="/cuenta" className="text-xs text-muted-foreground md:hidden">Cuenta</Link>
          </header>
          <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-5 pb-40 md:pb-24">{children}</main>
        </div>
        <BottomNav slug={slug} />
      </div>
    </CaptureProvider>
  );
}
