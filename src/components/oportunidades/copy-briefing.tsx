"use client";

import { toast } from "sonner";

export function CopyBriefing({ text }: { text: string }) {
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard.writeText(text).then(() => toast.success("Copiado. Pegalo donde quieras."), () => toast.error("No se pudo copiar."))}
      className="inline-flex h-8 items-center rounded-md border px-3 text-sm hover:bg-muted"
    >
      Copiar texto
    </button>
  );
}
