import Link from "next/link";
import { Search } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { BottomNav, SideNav } from "@/components/app/nav";
import { role as roleCatalog } from "@/domain/catalogs";

export default async function WorkspaceLayout({ children, params }: LayoutProps<"/w/[slug]">) {
  const { slug } = await params;
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("user_id", ctx.user.id)
    .maybeSingle();

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r bg-sidebar px-3 py-4 md:flex">
        <Link href={`/w/${slug}`} className="mb-6 px-3">
          <div className="text-sm font-semibold tracking-tight">RELEVO OS</div>
          <div className="text-xs text-muted-foreground">{ctx.workspace.name}</div>
        </Link>
        <SideNav slug={slug} />
        <div className="mt-auto space-y-1 px-3 text-xs text-muted-foreground">
          <Link href={`/w/${slug}/miembros`} className="block hover:underline">Miembros</Link>
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
          <Link href={`/w/${slug}`} className="text-sm font-semibold md:hidden">{ctx.workspace.name}</Link>
          <form action={`/w/${slug}/buscar`} className="relative ml-auto w-full max-w-xs md:ml-0">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              name="q"
              type="search"
              placeholder="Buscar empresas, activos, contactos…"
              aria-label="Buscar"
              className="h-9 w-full rounded-md border bg-background pr-3 pl-8 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </form>
          <Link href="/cuenta" className="text-xs text-muted-foreground md:hidden">Cuenta</Link>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-5 pb-24 md:pb-10">{children}</main>
      </div>
      <BottomNav slug={slug} />
    </div>
  );
}
