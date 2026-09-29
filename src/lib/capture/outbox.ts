"use client";

// Cola local de capturas (IndexedDB). Lo que entra acá ya está a salvo en el teléfono:
// sobrevive a cerrar la pestaña, bloquear la pantalla o quedarse sin señal. Solo se
// borra cuando la base confirmó el alta.

import type { OutboxItem } from "@/domain/capture";

const DB_NAME = "relevo-capturas";
const STORE = "outbox";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "clientId" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

const listeners = new Set<() => void>();
const EMPTY: OutboxItem[] = [];
let snapshot: OutboxItem[] = EMPTY;

/** Suscripción para useSyncExternalStore: la UI ve la cola sin volver a leer IndexedDB. */
export const outboxStore = {
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  getSnapshot: () => snapshot,
  getServerSnapshot: () => EMPTY,
};

export async function refreshOutbox(): Promise<OutboxItem[]> {
  const items = await tx<OutboxItem[]>("readonly", (s) => s.getAll() as IDBRequest<OutboxItem[]>);
  snapshot = items.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  listeners.forEach((fn) => fn());
  return snapshot;
}

export async function putOutbox(item: OutboxItem): Promise<void> {
  await tx("readwrite", (s) => s.put(item));
  await refreshOutbox();
}

export async function deleteOutbox(clientId: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(clientId));
  await refreshOutbox();
}

/** Pide al navegador que no borre la cola por falta de espacio (best effort). */
export async function requestPersistence(): Promise<void> {
  try {
    if (navigator.storage?.persisted && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    // Sin soporte: la cola igual funciona.
  }
}
