// Importación del CRM de Sheets: de una fila cruda a valores canónicos + problemas a revisar.
// Reglas puras (docs/03-migracion-crm-sheets.md). Nada se "corrige" en silencio: cada ajuste
// dudoso sale como problema con una propuesta que una persona acepta o ignora.

export type RawRow = { sheet: string; row: number; values: Record<string, string | null> };

export type Severity = "bloquea" | "revisar" | "info";
export type IssueCode =
  | "id_inestable"
  | "dato_en_campo_incorrecto"
  | "fuente_texto_libre"
  | "fuente_inexistente"
  | "estado_texto_libre"
  | "canal_institucional"
  | "fuente_sin_entidad"
  | "responsable_compartido"
  | "responsable_desconocido"
  | "referencia_rota"
  | "posible_duplicado"
  | "propietario_sin_validar"
  | "sin_nombre"
  | "sin_empresa"
  | "duplicado_en_archivo"
  | "alias_cambiado";

export type Proposal = { label: string; patch: Record<string, unknown> };
export type Issue = { code: IssueCode; severity: Severity; field?: string; message: string; proposal?: Proposal };

export type CompanyValues = {
  trade_name: string;
  activity: string | null;
  locality: string | null;
  address_text: string | null;
  public_phone: string | null;
  website: string | null;
  sector: string | null;
  priority: 1 | 2 | 3;
  stage: TargetStage;
  owner_name: string | null;
  verification_status: string;
  next_action: string | null;
  next_action_due: string | null;
  notes: string | null;
  drive_folder_url: string | null;
  last_verified_on: string | null;
  source_ref: string | null;
  /** Lo que el CRM dice sobre la verificación además del estado ("expositor AOG 2026 + operación Neuquén"). */
  evidence_note: string | null;
};

export type ContactValues = {
  full_name: string;
  contact_kind: "persona" | "canal_institucional";
  role_title: string | null;
  email: string | null;
  phone: string | null;
  profile_url: string | null;
  preferred_channel: "presencial" | "telefono" | "whatsapp" | "email" | "otro" | null;
  relationship_status: string | null;
  contact_permission: "sin_definir" | "no_contactar";
  /** Borrador de mensaje (AOG) guardado como nota de celda en "Notas": propuesta, no enviada. */
  outreach_draft: string | null;
  owner_name: string | null;
  notes: string | null;
  company_ref: string | null;
  source_ref: string | null;
};

export type TaskValues = {
  title: string;
  kind: string | null;
  channel: string | null;
  due_on: string | null;
  status: "todo" | "in_progress" | "blocked" | "done" | "cancelada";
  owner_name: string | null;
  result: string | null;
  /** Tal cual el CRM: "Prioridad preparación" (P1 · foco inicial…) y "Bloque operativo · RELEVO". */
  prep_priority: string | null;
  prep_block: string | null;
  company_ref: string | null;
  contact_ref: string | null;
};

export type SourceValues = {
  title: string;
  url: string | null;
  publisher: string | null;
  published_on: string | null;
  captured_on: string | null;
  quality: "alta" | "media" | "baja" | null;
  supports: string | null;
  limitations: string | null;
  entity_ref: string | null;
};

export type Mapped<T> = { externalId: string; label: string; sheet: string; row: number; values: T; issues: Issue[] };

export const TARGET_STAGES = ["investigacion", "calificacion", "contacto_pendiente", "contactado", "reunion", "diagnostico", "oportunidad", "descartado"] as const;
export type TargetStage = (typeof TARGET_STAGES)[number];

// --- utilidades -------------------------------------------------------------------

export function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

const txt = (v: string | null | undefined) => {
  const t = v?.replace(/\s+/g, " ").trim();
  return t ? t : null;
};

const looksLikeUrl = (v: string) => /^https?:\/\//i.test(v) || /^www\./i.test(v) || /\.(com|ar|net|org|io)(\/|$)/i.test(v);
const toUrl = (v: string | null) => (v && looksLikeUrl(v) ? (/^https?:\/\//i.test(v) ? v : `https://${v}`) : null);

/** "05/10/2026", "2026-10-05" o "2026-10-05T00:00:00" → "2026-10-05". Otra cosa → null. */
export function parseDate(v: string | null | undefined): string | null {
  const t = txt(v);
  if (!t) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  // Fecha escrita como texto por una automatización ("Mon Oct 05 2026 21:00:00 GMT-0300 (…)"): es una
  // fecha sin hora guardada como medianoche UTC, así que el día es el de UTC (21:00 de Argentina = 00:00 UTC).
  if (/^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{2} \d{4} \d{2}:\d{2}:\d{2} GMT[+-]\d{4}/.test(t)) {
    const d = new Date(t.replace(/ \(.*\)$/, ""));
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return null;
}

const STAGE_BY_LABEL: Record<string, TargetStage> = {
  investigacion: "investigacion",
  calificacion: "calificacion",
  "contacto pendiente": "contacto_pendiente",
  contactado: "contactado",
  reunion: "reunion",
  diagnostico: "diagnostico",
  oportunidad: "oportunidad",
  descartado: "descartado",
};

export function mapStage(v: string | null): TargetStage | null {
  const t = txt(v);
  return t ? STAGE_BY_LABEL[fold(t)] ?? null : "investigacion";
}

export function mapPriority(v: string | null): 1 | 2 | 3 | null {
  const t = txt(v);
  if (!t) return null;
  return ({ alta: 1, a: 1, media: 2, b: 2, baja: 3, c: 3 } as const)[fold(t) as "alta"] ?? null;
}

/** Estado de evidencia del CRM → verificación canónica (mapping aprobado por Tano el 29/09). */
/** Detalle después del estado: "Verificado públicamente · expositor AOG 2026" → "expositor AOG 2026". */
export function evidenceDetail(v: string | null): string | null {
  const t = txt(v);
  if (!t) return null;
  const { status, freeText } = mapEvidenceStatus(t);
  if (freeText) return t;
  if (status !== "publicly_verified") return null;
  const detail = t.replace(/^verificado p[uú]blicamente\s*[·:\-–—]?\s*/i, "").trim();
  return detail || null;
}

export function mapEvidenceStatus(v: string | null): { status: string; freeText: boolean } {
  const t = txt(v);
  if (!t) return { status: "unverified", freeText: false };
  const f = fold(t);
  if (f === "pre-mapeado" || f === "no verificado") return { status: "unverified", freeText: false };
  if (f === "fuente publica pendiente revalidacion") return { status: "partially_verified", freeText: false };
  if (f.startsWith("verificado publicamente")) return { status: "publicly_verified", freeText: false };
  return { status: "partially_verified", freeText: true };
}

/** Referencia a una fila de FUENTES (SRC-001, SRC-NEW-LDV…). Lo demás es texto libre. */
export const SRC_ID = /^SRC-[A-Z0-9-]+$/i;

// --- mapeo por pestaña ------------------------------------------------------------

export function mapCompany(r: RawRow): Mapped<CompanyValues> {
  const v = r.values;
  const issues: Issue[] = [];
  const stableId = txt(v["ID anterior"]) ?? txt(v["ID"]) ?? "";
  if (txt(v["ID anterior"]) && txt(v["ID"]) && txt(v["ID anterior"]) !== txt(v["ID"])) {
    issues.push({
      code: "id_inestable",
      severity: "bloquea",
      field: "ID",
      message: `El ID calculado (${v["ID"]}) no coincide con el ID anterior (${v["ID anterior"]}): una fila se movió. Corregilo en el Sheet antes de importar.`,
    });
  }
  const name = txt(v["Empresa / establecimiento"]);
  if (!name) issues.push({ code: "sin_nombre", severity: "bloquea", message: "La fila no tiene nombre de empresa." });

  let phone = txt(v["Teléfono público"]);
  const website = toUrl(txt(v["Sitio oficial"]) ?? txt(v["Sitio oficial#link"]));
  if (phone && looksLikeUrl(phone)) {
    issues.push({
      code: "dato_en_campo_incorrecto",
      severity: "revisar",
      field: "Teléfono público",
      message: `"Teléfono público" contiene una dirección web (${phone}).`,
      proposal: { label: `Usarla como sitio web${website ? " (reemplaza la actual)" : ""} y dejar el teléfono vacío`, patch: { website: toUrl(phone), public_phone: null } },
    });
    phone = null;
  }

  const evidence = mapEvidenceStatus(v["Estado de evidencia"]);
  if (evidence.freeText) {
    issues.push({
      code: "estado_texto_libre",
      severity: "info",
      field: "Estado de evidencia",
      message: `Estado de evidencia en texto libre: "${v["Estado de evidencia"]}". Se importa como parcialmente verificado y el texto queda como nota de evidencia.`,
    });
  }

  const sourceRef = txt(v["Fuente ID"]);
  if (sourceRef && !SRC_ID.test(sourceRef)) {
    issues.push({
      code: "fuente_texto_libre",
      severity: "info",
      field: "Fuente ID",
      message: `"Fuente ID" no es un SRC: "${sourceRef}". Se registra como fuente citada por el CRM (sin revisarla nosotros).`,
    });
  }

  const stage = mapStage(v["Etapa CRM"]);
  if (!stage) issues.push({ code: "dato_en_campo_incorrecto", severity: "revisar", field: "Etapa CRM", message: `Etapa desconocida: "${v["Etapa CRM"]}". Se usa Investigación.` });
  const priority = mapPriority(v["Prioridad"]);
  if (!priority && txt(v["Prioridad"])) {
    issues.push({ code: "dato_en_campo_incorrecto", severity: "revisar", field: "Prioridad", message: `Prioridad desconocida: "${v["Prioridad"]}". Se usa Media.` });
  }
  const owner = txt(v["Propietario identificado"]);
  if (owner) {
    issues.push({
      code: "propietario_sin_validar",
      severity: "info",
      field: "Propietario identificado",
      message: `El CRM menciona un propietario: "${owner}". No se crea persona ni rol automáticamente; queda en notas para validar.`,
    });
  }

  const notes = [txt(v["Notas"]), evidence.freeText ? `Estado de evidencia en el CRM: ${txt(v["Estado de evidencia"])}` : null, owner ? `Propietario mencionado (sin validar): ${owner}` : null]
    .filter(Boolean)
    .join("\n");

  return {
    externalId: stableId,
    label: name ?? stableId,
    sheet: r.sheet,
    row: r.row,
    issues,
    values: {
      trade_name: name ?? "",
      activity: txt(v["Subsector"]),
      locality: txt(v["Localidad / zona"]),
      address_text: txt(v["Dirección"]),
      public_phone: phone,
      website,
      // El Sheet renombró la columna ("Sector" → "Sector / actividad", 06/10): se aceptan las dos.
      sector: txt(v["Sector"] ?? v["Sector / actividad"]),
      priority: priority ?? 2,
      stage: stage ?? "investigacion",
      owner_name: txt(v["Responsable"]),
      verification_status: evidence.status,
      next_action: txt(v["Próxima acción"]),
      next_action_due: parseDate(v["Fecha próxima acción"]),
      notes: notes || null,
      drive_folder_url: toUrl(txt(v["Carpeta expediente URL"]) ?? txt(v["Carpeta expediente URL#link"])),
      last_verified_on: parseDate(v["Última verificación"]),
      source_ref: sourceRef,
      evidence_note: evidenceDetail(v["Estado de evidencia"]),
    },
  };
}

const INSTITUTIONAL = /por identificar|\(cargo|^(?:equipo|área|area|administraci[oó]n|ventas|compras|recepci[oó]n|gerencia|mesa de entradas)\b/i;
// Nombres que ya son un rol o un equipo (no una persona): no hay nada que decidir.
const DECLARED_INSTITUTIONAL = /por identificar|^(?:equipo|administraci[oó]n|ventas|compras|recepci[oó]n|mesa de entradas)\b/i;
const CHANNEL: [RegExp, ContactValues["preferred_channel"]][] = [
  [/whats/i, "whatsapp"],
  [/tel[eé]fono/i, "telefono"],
  [/correo|buz[oó]n|mail/i, "email"],
  [/presencial|campo/i, "presencial"],
];

export function mapContact(r: RawRow): Mapped<ContactValues> {
  const v = r.values;
  const issues: Issue[] = [];
  const id = txt(v["ID"]) ?? "";
  const rawName = txt(v["Nombre"]) ?? "";
  if (!rawName) issues.push({ code: "sin_nombre", severity: "bloquea", message: "El contacto no tiene nombre." });
  let kind: ContactValues["contact_kind"] = "persona";
  let name = rawName;
  const access = txt(v["Acceso / vínculo"]);
  if (INSTITUTIONAL.test(rawName) || /institucional/i.test(access ?? "")) {
    const cleaned = rawName.replace(/\s*\((?:cargo;?\s*)?persona por identificar\)\s*/i, "").replace(/\s*\(cargo[^)]*\)\s*/i, "").replace(/\s+por identificar$/i, " (por identificar)").trim() || rawName;
    if (DECLARED_INSTITUTIONAL.test(rawName)) {
      // El Sheet ya lo declara ("persona por identificar"): no hay nada que decidir, entra como canal.
      kind = "canal_institucional";
      name = cleaned;
      issues.push({ code: "canal_institucional", severity: "info", message: `"${rawName}" entra como canal institucional "${cleaned}" (el Sheet lo marca como persona por identificar).` });
    } else {
      issues.push({
        code: "canal_institucional",
        severity: "revisar",
        message: `"${rawName}" es un cargo o buzón, todavía no una persona identificada.`,
        proposal: { label: `Guardarlo como canal institucional "${cleaned}"`, patch: { contact_kind: "canal_institucional", full_name: cleaned } },
      });
    }
  }
  const email = txt(v["Correo"]);
  const phone = txt(v["Teléfono"]);
  const profile = toUrl(txt(v["LinkedIn / URL"]));
  for (const col of ["Fecha envío", "Fecha respuesta", "Fecha mensaje LinkedIn", "Último contacto", "Próximo contacto"]) {
    const val = txt(v[col]);
    if (val && !parseDate(val)) {
      issues.push({ code: "dato_en_campo_incorrecto", severity: "info", field: col, message: `"${col}" tiene texto en lugar de una fecha ("${val}"). Esa columna no se importa.` });
    }
  }
  const noContact = txt(v["No contactar"]);
  return {
    externalId: id,
    label: name || id,
    sheet: r.sheet,
    row: r.row,
    issues,
    values: {
      full_name: name,
      contact_kind: kind,
      role_title: txt(v["Cargo"]),
      email: email && email.includes("@") ? email : null,
      phone,
      profile_url: profile,
      preferred_channel: access ? CHANNEL.find(([re]) => re.test(access))?.[1] ?? "otro" : null,
      relationship_status: txt(v["Estado de relación"]),
      contact_permission: noContact && /^(s[ií]|x|true|1)$/i.test(noContact) ? "no_contactar" : "sin_definir",
      owner_name: txt(v["Responsable"]),
      notes: [txt(v["Notas"]), access ? `Acceso: ${access}` : null].filter(Boolean).join("\n") || null,
      outreach_draft: txt(v["Notas#nota"]),
      company_ref: txt(v["Empresa ID"]),
      source_ref: txt(v["Fuente / referencia"]),
    },
  };
}

const TASK_STATUS: Record<string, TaskValues["status"]> = {
  pendiente: "todo",
  "en curso": "in_progress",
  "en progreso": "in_progress",
  bloqueada: "blocked",
  hecha: "done",
  hecho: "done",
  completada: "done",
  realizada: "done",
  cancelada: "cancelada",
  cancelado: "cancelada",
};

export function mapTask(r: RawRow): Mapped<TaskValues> {
  const v = r.values;
  const issues: Issue[] = [];
  const title = txt(v["Actividad / objetivo"]);
  if (!title) issues.push({ code: "sin_nombre", severity: "bloquea", message: "La actividad no tiene descripción." });
  const statusRaw = txt(v["Estado"]);
  const status = statusRaw ? TASK_STATUS[fold(statusRaw)] : "todo";
  if (!status) issues.push({ code: "dato_en_campo_incorrecto", severity: "revisar", field: "Estado", message: `Estado desconocido: "${statusRaw}". Se importa como pendiente.` });
  const owner = txt(v["Responsable"]);
  if (owner && /\+|,| y /.test(owner)) {
    issues.push({
      code: "responsable_compartido",
      severity: "info",
      field: "Responsable",
      message: `Responsable compartido ("${owner}"): se asigna a la primera persona y el resto queda en la descripción.`,
    });
  }
  return {
    externalId: txt(v["ID"]) ?? "",
    label: title ?? txt(v["ID"]) ?? "",
    sheet: r.sheet,
    row: r.row,
    issues,
    values: {
      title: title ?? "",
      kind: txt(v["Tipo"]),
      channel: txt(v["Canal"]),
      due_on: parseDate(v["Vencimiento"]),
      status: status ?? "todo",
      owner_name: owner,
      result: txt(v["Resultado"]),
      prep_priority: txt(v["Prioridad preparación"]),
      prep_block: txt(v["Bloque operativo · RELEVO"]),
      company_ref: txt(v["Empresa ID"]),
      contact_ref: txt(v["Contacto ID"]),
    },
  };
}

export function mapSource(r: RawRow): Mapped<SourceValues> {
  const v = r.values;
  const issues: Issue[] = [];
  const entity = txt(v["Entidad vinculada"]);
  if (entity && !/^AN-\d+$/i.test(entity)) {
    issues.push({
      code: "fuente_sin_entidad",
      severity: "info",
      field: "Entidad vinculada",
      message: `La fuente apunta a "${entity}", no a una empresa: se importa como fuente de contexto, sin evidencia sobre una entidad.`,
    });
  }
  const quality = txt(v["Calidad"]);
  return {
    externalId: txt(v["ID"]) ?? "",
    label: txt(v["Título / evidencia"]) ?? txt(v["ID"]) ?? "",
    sheet: r.sheet,
    row: r.row,
    issues,
    values: {
      title: txt(v["Título / evidencia"]) ?? txt(v["ID"]) ?? "Fuente del CRM",
      url: toUrl(txt(v["URL original"]) ?? txt(v["URL original#link"])),
      publisher: txt(v["Tipo"]),
      published_on: parseDate(v["Fecha publicación"]),
      captured_on: parseDate(v["Fecha consulta"]),
      quality: quality ? (({ alta: "alta", media: "media", baja: "baja" } as const)[fold(quality) as "alta"] ?? null) : null,
      supports: txt(v["Hecho que sustenta"]),
      limitations: txt(v["Limitaciones"]),
      entity_ref: entity && /^AN-\d+$/i.test(entity) ? entity : null,
    },
  };
}

// --- responsables ---------------------------------------------------------------

// Apodos del equipo → nombres que pueden figurar en el perfil o el email.
const ALIASES: Record<string, string[]> = { tano: ["tano", "estanislao"], fran: ["fran", "francisco"] };

export type Member = { user_id: string; display_name: string | null; email: string | null };

/** "Tano + Fran" → ids de miembros. Los nombres que no coinciden con un único miembro quedan en `unknown`. */
export function resolveOwners(name: string | null, members: Member[]): { ids: string[]; unknown: string[] } {
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const part of (name ?? "").split(/\+|,|\by\b/).map((p) => fold(p)).filter(Boolean)) {
    const aliases = ALIASES[part] ?? [part];
    const hits = members.filter((m) => {
      const words = fold(m.display_name ?? "").split(/\s+/);
      const local = fold((m.email ?? "").split("@")[0]);
      return aliases.some((a) => words.includes(a) || local === a || local.startsWith(`${a}.`) || local.startsWith(a));
    });
    if (hits.length === 1) ids.push(hits[0].user_id);
    else unknown.push(part);
  }
  return { ids, unknown };
}
