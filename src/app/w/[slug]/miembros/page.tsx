import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { role as roleCatalog } from "@/domain/catalogs";
import { PageHeader, Pill, Section, formatDate } from "@/components/app/bits";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { CheckboxField, SelectField, TextField } from "@/components/app/fields";
import { inviteMember, revokeInvitation, setApprovalCapability } from "./actions";

export const metadata: Metadata = { title: "Miembros" };

export default async function MembersPage({ params }: PageProps<"/w/[slug]/miembros">) {
  const { slug } = await params;
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();
  const [{ data: members }, { data: invitations }] = await Promise.all([
    supabase.from("memberships").select("user_id, role, can_approve_decisions, created_at").eq("workspace_id", ctx.workspace.id).eq("status", "active"),
    supabase.from("workspace_invitations").select("id, email, role, can_approve_decisions, status, created_at, expires_at").eq("status", "pending").order("created_at", { ascending: false }),
  ]);
  const { data: profiles } = await supabase.from("profiles").select("user_id, display_name, email").in("user_id", (members ?? []).map((m) => m.user_id));
  const profile = new Map((profiles ?? []).map((p) => [p.user_id, p]));
  const isOwner = ctx.role === "owner";
  const canInvite = ctx.role === "owner" || ctx.role === "admin";

  return (
    <>
      <PageHeader title="Miembros" subtitle="Todos los miembros ven todo el workspace. El rol define quién edita; aprobar decisiones es una capacidad aparte." />
      <Section title="Con acceso">
        <ul className="divide-y rounded-lg border">
          {(members ?? []).map((m) => {
            const p = profile.get(m.user_id);
            return (
              <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <div className="font-medium">{p?.display_name || p?.email}</div>
                  <div className="text-sm text-muted-foreground">{p?.email} · desde {formatDate(m.created_at)}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Pill>{roleCatalog.label(m.role)}</Pill>
                  {m.can_approve_decisions && <Pill className="border-primary text-primary">Aprueba decisiones</Pill>}
                  {isOwner && m.user_id !== ctx.user.id && m.role !== "viewer" && (
                    <ActionForm action={setApprovalCapability.bind(null, slug, m.user_id)} className="flex items-center gap-2 space-y-0">
                      <CheckboxField name="can_approve_decisions" label="Puede aprobar" defaultChecked={m.can_approve_decisions} />
                      <SubmitButton variant="outline" className="h-8">Guardar</SubmitButton>
                    </ActionForm>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Section>

      {canInvite && (
        <Section title="Invitaciones pendientes" className="mt-8">
          {invitations?.length ? (
            <ul className="divide-y rounded-lg border">
              {invitations.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
                  <span>{i.email} · {roleCatalog.label(i.role)}{i.can_approve_decisions ? " · aprueba" : ""} · vence {formatDate(i.expires_at)}</span>
                  <form action={revokeInvitation.bind(null, slug, i.id)}>
                    <button className="text-destructive hover:underline">Revocar</button>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No hay invitaciones pendientes.</p>
          )}
          <details className="rounded-lg border p-4">
            <summary className="cursor-pointer text-sm font-medium">+ Invitar</summary>
            <ActionForm action={inviteMember.bind(null, slug)} resetOnSuccess className="mt-4 max-w-md">
              <TextField name="email" label="Email" type="email" />
              <SelectField name="role" label="Rol" defaultValue="member" options={(["admin", "member", "viewer"] as const).map((r) => ({ value: r, label: roleCatalog.label(r) }))} />
              {isOwner && <CheckboxField name="can_approve_decisions" label="Puede aprobar decisiones" hint="Capacidad independiente del rol. Solo el owner la otorga." />}
              <SubmitButton>Invitar</SubmitButton>
            </ActionForm>
          </details>
        </Section>
      )}
    </>
  );
}
