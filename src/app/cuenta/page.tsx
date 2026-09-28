import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/server/context";
import { AccountForm } from "./account-form";

export default async function AccountPage() {
  const user = await getSessionUser();
  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("display_name").eq("user_id", user.id).maybeSingle();
  return (
    <main className="mx-auto max-w-sm px-4 py-10">
      <Link href="/" className="text-sm text-muted-foreground hover:underline">← Volver</Link>
      <h1 className="mt-4 text-xl font-semibold">Tu cuenta</h1>
      <p className="mb-6 text-sm text-muted-foreground">{user.email}</p>
      <AccountForm displayName={profile?.display_name ?? ""} />
    </main>
  );
}
