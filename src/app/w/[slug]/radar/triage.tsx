"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { decideDiscrepancy, triageSignal, type TriageChoice } from "./actions";

const CHOICES: { key: TriageChoice; label: string; hint: string }[] = [
  { key: "importa", label: "Importa", hint: "Cambia algo: queda su próxima acción" },
  { key: "seguir", label: "Seguir", hint: "Vigilar: te aviso si cambia" },
  { key: "next", label: "Next", hint: "Entendido: sale del trabajo activo" },
  { key: "descartar", label: "Descartar", hint: "No relevante" },
];

export function TriageButtons({ slug, id }: { slug: string; id: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap gap-1.5">
      {CHOICES.map((c) => (
        <button key={c.key} type="button" title={c.hint} disabled={pending} onClick={() => start(async () => { const r = await triageSignal(slug, id, c.key); if (r.ok) toast.success(r.message); else toast.error(r.message); })} className={`rounded-full border px-3 py-1 text-xs ${c.key === "importa" ? "bg-primary text-primary-foreground" : "hover:bg-muted"} disabled:opacity-50`}>
          {c.label}
        </button>
      ))}
    </div>
  );
}

export function DiscrepancyButtons({ slug, id }: { slug: string; id: string }) {
  const [pending, start] = useTransition();
  const go = (v: "aceptada" | "descartada") => start(async () => { const r = await decideDiscrepancy(slug, id, v); if (r.ok) toast.success(r.message); else toast.error(r.message); });
  return (
    <div className="flex gap-1.5">
      <button type="button" disabled={pending} onClick={() => go("descartada")} className="rounded-full border px-3 py-1 text-xs hover:bg-muted">Mantener lo actual</button>
      <button type="button" disabled={pending} onClick={() => go("aceptada")} className="rounded-full border px-3 py-1 text-xs hover:bg-muted">Usar el dato nuevo</button>
    </div>
  );
}
