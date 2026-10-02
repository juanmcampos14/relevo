"use client";

import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "cn";

// Lo que RELEVO propone que merece atención, corregible en un segundo: arrastrar (en el teléfono, mantener
// apretado y arrastrar), o el menú: primero, mañana, ya lo hice, ya no importa. La corrección se aplica al
// instante acá y en el Brain.

export type FocusView = { id: string; title: string; why: string };
export type FocusChange =
  | { kind: "orden"; ids: string[] }
  | { kind: "primero"; id: string }
  | { kind: "posponer"; id: string; until: string; note?: string | null }
  | { kind: "hecha"; id: string; note?: string | null }
  | { kind: "sacar"; id: string; note?: string | null };

const HOLD_MS = 380;

/** Mañana en Argentina (AAAA-MM-DD). */
const tomorrow = () => new Date(Date.now() - 3 * 3_600_000 + 86_400_000).toISOString().slice(0, 10);

export function FocusList({ initial, disabled, canEdit, onAdvance, onChange }: {
  initial: FocusView[]; disabled: boolean; canEdit: boolean;
  onAdvance: (it: FocusView) => void;
  onChange: (c: FocusChange) => void;
}) {
  const [items, setItems] = useState(initial);
  const [menu, setMenu] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const rows = useRef(new Map<string, HTMLLIElement>());
  const drag = useRef<{ id: string; pointer: number; startY: number; timer: ReturnType<typeof setTimeout> | null; active: boolean; moved: boolean; order: string[] } | null>(null);

  // Mientras se arrastra con el dedo, la página no se desplaza.
  useEffect(() => {
    const block = (e: TouchEvent) => { if (drag.current?.active) e.preventDefault(); };
    document.addEventListener("touchmove", block, { passive: false });
    return () => document.removeEventListener("touchmove", block);
  }, []);

  const apply = (c: FocusChange) => {
    setMenu(null);
    if (c.kind === "orden") setItems((xs) => c.ids.map((id) => xs.find((x) => x.id === id)!).filter(Boolean));
    else if (c.kind === "primero") setItems((xs) => [xs.find((x) => x.id === c.id)!, ...xs.filter((x) => x.id !== c.id)]);
    else setItems((xs) => xs.filter((x) => x.id !== c.id));
    onChange(c);
  };

  const start = (e: React.PointerEvent, id: string) => {
    if (!canEdit || (e.target as HTMLElement).closest("button")) return;
    const touch = e.pointerType !== "mouse";
    drag.current = { id, pointer: e.pointerId, startY: e.clientY, timer: null, active: false, moved: false, order: items.map((x) => x.id) };
    const activate = () => {
      if (!drag.current) return;
      drag.current.active = true;
      setDragging(id);
      try { navigator.vibrate?.(12); } catch { /* sin vibración */ }
    };
    if (touch) drag.current.timer = setTimeout(activate, HOLD_MS);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointer) return;
    if (!d.active) {
      // Con el mouse, arrastrar empieza al moverse; con el dedo, moverse antes de tiempo es desplazar la página.
      if (Math.abs(e.clientY - d.startY) > 6) {
        if (e.pointerType === "mouse") { d.active = true; setDragging(d.id); (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); }
        else { if (d.timer) clearTimeout(d.timer); drag.current = null; }
      }
      return;
    }
    d.moved = true;
    const others = d.order.filter((x) => x !== d.id);
    let index = others.length;
    for (let i = 0; i < others.length; i++) {
      const r = rows.current.get(others[i])?.getBoundingClientRect();
      if (r && e.clientY < r.top + r.height / 2) { index = i; break; }
    }
    const order = [...others.slice(0, index), d.id, ...others.slice(index)];
    if (order.join() !== d.order.join()) {
      d.order = order;
      setItems((xs) => order.map((id) => xs.find((x) => x.id === id)!).filter(Boolean));
    }
  };
  const end = () => {
    const d = drag.current;
    if (d?.timer) clearTimeout(d.timer);
    drag.current = null;
    setDragging(null);
    if (d?.active && d.moved && d.order.join() !== initial.map((x) => x.id).join()) onChange({ kind: "orden", ids: d.order });
  };

  if (!items.length) return null;
  return (
    <ol className="mt-6 space-y-1 sm:mt-8" onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      {items.map((it, i) => (
        <li
          key={it.id}
          ref={(el) => { if (el) rows.current.set(it.id, el); else rows.current.delete(it.id); }}
          onPointerDown={(e) => start(e, it.id)}
          onContextMenu={(e) => { if (canEdit) e.preventDefault(); }}
          className={cn(
            "relative flex touch-pan-y items-start gap-4 rounded-2xl px-2 py-4 transition-[background-color,box-shadow,transform] select-none sm:px-4",
            dragging === it.id ? "z-10 scale-[1.01] bg-white shadow-[0_8px_28px_rgba(28,27,25,0.12)]" : "hover:bg-white",
            canEdit && "cursor-grab active:cursor-grabbing",
          )}
        >
          <span className="mt-0.5 hidden text-[15px] font-medium text-[#B0A894] tabular-nums sm:inline">{i + 1}</span>
          <div className="min-w-0 flex-1 sm:flex sm:items-start sm:gap-4">
            <div className="min-w-0 flex-1">
              <p className={cn("leading-snug font-medium", i === 0 ? "text-[17px]" : "text-[16px]")}>{it.title}</p>
              {it.why && <p className={cn("mt-1 text-[15px] leading-relaxed text-[#6F6A60]", i > 0 && "hidden sm:block")}>{it.why}</p>}
            </div>
            <div className="mt-3 flex shrink-0 items-center gap-1 sm:mt-0">
              <button type="button" disabled={disabled} onClick={() => onAdvance(it)} className={cn("rounded-full px-4 py-2 text-[14px] font-medium transition-opacity disabled:opacity-40", i === 0 ? "bg-[#1C1B19] text-white" : "bg-[#EFEBE2] text-[#1C1B19]")}>
                Avanzar
              </button>
              {canEdit && (
                <button type="button" onClick={() => setMenu(menu === it.id ? null : it.id)} aria-label={`Más opciones: ${it.title}`} aria-expanded={menu === it.id} className="flex size-10 items-center justify-center rounded-full text-[#8A8478] hover:bg-[#F4F1EA]">
                  <MoreHorizontal className="size-5" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
          {menu === it.id && (
            <div role="menu" className="absolute top-full right-2 z-20 -mt-2 w-52 overflow-hidden rounded-2xl bg-white py-1 text-[15px] shadow-[0_12px_40px_rgba(28,27,25,0.16)]">
              {i > 0 && <MenuItem onClick={() => apply({ kind: "primero", id: it.id })}>Esto primero</MenuItem>}
              <MenuItem onClick={() => apply({ kind: "posponer", id: it.id, until: tomorrow(), note: "Mañana" })}>Mañana</MenuItem>
              <MenuItem onClick={() => apply({ kind: "hecha", id: it.id, note: "Ya lo hice" })}>Ya lo hice</MenuItem>
              <MenuItem onClick={() => apply({ kind: "sacar", id: it.id, note: "Ya no importa" })}>Ya no importa</MenuItem>
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <button type="button" role="menuitem" onClick={onClick} className="block w-full px-4 py-3 text-left hover:bg-[#F4F1EA]">{children}</button>;
}
