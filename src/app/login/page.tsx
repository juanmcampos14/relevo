import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, error } = await searchParams;
  const nextPath = typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">RELEVO OS</h1>
      <p className="mb-8 text-sm text-muted-foreground">Acceso solo por invitación.</p>
      {error && (
        <p className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          El enlace no es válido o venció. Pedí uno nuevo.
        </p>
      )}
      <LoginForm next={nextPath} />
    </main>
  );
}
