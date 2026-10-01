import Image from "next/image";
import type { Metadata } from "next";
import { PHOTOS } from "@/domain/photos";
import { LogoMark } from "@/components/app/brand";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, error } = await searchParams;
  const nextPath = typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const photo = PHOTOS.rigBardas;
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      {/* Imagen: arriba en móvil (banda), a la izquierda en escritorio. */}
      <section className="relative h-56 overflow-hidden bg-sidebar sm:h-72 lg:h-auto">
        <Image
          src={`${photo.src}?w=1600&q=80&auto=format&fit=crop`}
          alt={photo.alt}
          fill
          priority
          sizes="(min-width: 1024px) 55vw, 100vw"
          className="object-cover object-[center_60%]"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[oklch(0.18_0.03_248/0.92)] via-[oklch(0.18_0.03_248/0.35)] to-transparent" />
        <div className="absolute inset-x-0 bottom-0 space-y-2 p-6 text-white lg:p-10">
          <p className="text-xs font-medium tracking-[0.2em] text-[oklch(0.85_0.1_60)] uppercase">Añelo · Vaca Muerta</p>
          <h2 className="max-w-md text-2xl font-semibold tracking-tight lg:text-4xl">
            De la primera visita a la decisión, con cada dato respaldado.
          </h2>
        </div>
      </section>

      <main className="flex flex-col justify-start px-6 py-8 lg:justify-center lg:px-16 lg:py-10">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3">
            <LogoMark className="size-10" />
            <div>
              <h1 className="text-xl font-semibold tracking-tight">RELEVO OS</h1>
              <p className="text-sm text-muted-foreground">Originación e investigación de oportunidades</p>
            </div>
          </div>
          {error && (
            <p className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              El enlace no es válido o venció. Pedí uno nuevo y abrilo en el mismo navegador donde lo pediste, o entrá con contraseña.
            </p>
          )}
          <div className="rounded-2xl border bg-card p-6 shadow-sm">
            <LoginForm next={nextPath} />
          </div>
          <p className="mt-6 text-center text-xs text-muted-foreground">Acceso solo por invitación.</p>
        </div>
      </main>
    </div>
  );
}
