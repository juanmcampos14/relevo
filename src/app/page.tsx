import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/server/context";

export default async function Root() {
  const user = await getSessionUser();
  const supabase = await createClient();
  const { data: workspaces } = await supabase.from("workspaces").select("name, slug").eq("status", "active").order("name");
  if (workspaces?.length === 1) redirect(`/hoy/${workspaces[0].slug}`);

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-xl font-semibold">Tus workspaces</h1>
      <p className="mb-6 text-sm text-muted-foreground">{user.email}</p>
      {workspaces?.length ? (
        <ul className="space-y-2">
          {workspaces.map((w) => (
            <li key={w.slug}>
              <Link href={`/w/${w.slug}`} className="block rounded-lg border p-4 hover:bg-muted">{w.name}</Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border p-4 text-sm">
          Todavía no pertenecés a ningún workspace. Pedí una invitación a su owner.
        </p>
      )}
      <form action="/auth/signout" method="post" className="mt-8">
        <button className="text-sm text-muted-foreground hover:underline">Salir</button>
      </form>
    </main>
  );
}
