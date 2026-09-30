import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import type { RefLabel } from "@/server/ai/labels";

const CITE = /\[\[([a-z]+:[0-9a-f-]{36})\]\]/g;
// La IA ya nombra el registro en el texto: la cita es un chip corto; el nombre completo va en el tooltip.
const SHORT: Record<string, string> = {
  company: "empresa", establishment: "lugar", asset: "activo", contact: "contacto", finding: "hallazgo",
  opportunity: "oportunidad", visit: "visita", decision: "decisión", source: "fuente", campaign: "campaña", task: "tarea", news: "noticia", capture: "captura", evidence: "evidencia",
};

function inline(text: string, labels: Map<string, RefLabel>, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(CITE)) {
    out.push(...bold(text.slice(last, m.index), `${key}-t${n}`));
    const l = labels.get(m[1]);
    const short = SHORT[m[1].split(":")[0]] ?? "registro";
    out.push(
      l?.href ? (
        <Link key={`${key}-c${n}`} href={l.href} title={l.label} className="mx-0.5 rounded bg-primary/10 px-1 align-baseline text-[0.75em] text-primary hover:underline">
          {short}
        </Link>
      ) : (
        <span key={`${key}-c${n}`} title={l?.label} className="mx-0.5 rounded bg-muted px-1 text-[0.75em]">{short}</span>
      ),
    );
    last = (m.index ?? 0) + m[0].length;
    n++;
  }
  out.push(...bold(text.slice(last), `${key}-end`));
  return out;
}

function bold(text: string, key: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={`${key}-${i}`}>{part.slice(2, -2)}</strong> : <Fragment key={`${key}-${i}`}>{part}</Fragment>,
  );
}

/** Texto del asistente: párrafos, listas simples, negritas y citas [[tipo:uuid]] como enlaces. */
export function RichText({ text, labels }: { text: string; labels: Map<string, RefLabel> }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*([-*•]|\d+\.)\s+/.test(l))) {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*([-*•]|\d+\.)\s+/, ""), labels, `${i}-${j}`)}</li>)}
            </ul>
          );
        }
        if (/^#{1,4}\s/.test(b)) return <p key={i} className="font-semibold">{inline(b.replace(/^#{1,4}\s/, ""), labels, `${i}`)}</p>;
        return <p key={i} className="whitespace-pre-wrap">{inline(b, labels, `${i}`)}</p>;
      })}
    </div>
  );
}
