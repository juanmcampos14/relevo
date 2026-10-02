import type { Metadata } from "next";
import Link from "next/link";
import { getWorkspaceContext } from "@/server/context";
import { NewMission } from "@/components/surface/new-mission";

export const metadata: Metadata = { title: { absolute: "RELEVO · Nueva misión" } };
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function Nueva({ params }: PageProps<"/hoy/[slug]/nueva">) {
  const { slug } = await params;
  await getWorkspaceContext(slug);
  return (
    <div className="min-h-dvh bg-[#FAF8F3] text-[#1C1B19] antialiased">
      <header className="mx-auto flex h-14 max-w-3xl items-center justify-between px-5">
        <Link href={`/hoy/${slug}`} className="text-[15px] font-semibold tracking-[0.18em]">RELEVO</Link>
        <Link href={`/hoy/${slug}/misiones`} className="text-[14px] text-[#6F6A60] hover:text-[#1C1B19]">Cancelar</Link>
      </header>
      <main className="mx-auto max-w-3xl px-5 pb-24"><NewMission slug={slug} /></main>
    </div>
  );
}
