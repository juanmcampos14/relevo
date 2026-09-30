// Validación de formularios (servidor). Replica las reglas de la base para dar
// mensajes claros antes de que un CHECK de Postgres rechace el registro.
import { z } from "zod";
import { addressStatus, assetKind, assetOperation, campaignStatus, companyKind, consentStatus, contactPermission, contactRelation, dealflowStage, entityKind, findingKind, opportunityRoute, taskStatus, sourceKind, statusesRequiringSource, stopStatus, targetStatus, verificationStatus, evidenceType, evidenceOrigin, contactKind } from "./catalogs";

const opt = z.string().trim().optional().transform((v) => (v ? v : null));
const optUuid = z.uuid().optional().or(z.literal("")).transform((v) => (v ? v : null));
const optDate = z.iso.date().optional().or(z.literal("")).transform((v) => (v ? v : null));
const optUrl = z.url({ protocol: /^https?$/, message: "URL inválida (debe empezar con http:// o https://)" })
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : null));
const optNumber = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (!v?.trim()) return null;
    const n = Number(v.replace(",", "."));
    if (!Number.isFinite(n)) {
      ctx.addIssue({ code: "custom", message: "Número inválido" });
      return z.NEVER;
    }
    return n;
  });
const bool = z
  .union([z.literal("on"), z.literal("true"), z.literal("false"), z.literal("")])
  .optional()
  .transform((v) => v === "on" || v === "true");
const ids = z.array(z.uuid()).default([]);

const verification = {
  verification_status: z.enum(verificationStatus.values).default("unverified"),
  source_id: optUuid,
};

function requireSourceForStatus(v: { verification_status: string; source_id: string | null }, ctx: z.RefinementCtx) {
  if (statusesRequiringSource.has(v.verification_status) && !v.source_id) {
    ctx.addIssue({
      code: "custom",
      path: ["source_id"],
      message: `El estado "${verificationStatus.label(v.verification_status)}" requiere una fuente`,
    });
  }
}

// --- Ubicación compartida por establecimientos y activos -----------------------
const placeFields = {
  address_text: opt,
  locality: opt,
  province: opt,
  address_verified: bool,
  location_source_id: optUuid,
  latitude: optNumber,
  longitude: optNumber,
};

type PlaceInput = {
  address_text: string | null;
  address_verified: boolean;
  location_source_id: string | null;
  latitude: number | null;
  longitude: number | null;
};

function refinePlace(v: PlaceInput, ctx: z.RefinementCtx) {
  if (v.address_verified && !v.address_text) {
    ctx.addIssue({ code: "custom", path: ["address_text"], message: "No hay dirección para verificar" });
  }
  if (v.address_verified && !v.location_source_id) {
    ctx.addIssue({ code: "custom", path: ["location_source_id"], message: "Una dirección verificada requiere fuente" });
  }
  if ((v.latitude == null) !== (v.longitude == null)) {
    ctx.addIssue({ code: "custom", path: ["latitude"], message: "Latitud y longitud van juntas" });
  }
}

/** Convierte los campos de formulario al formato de la base. */
export function toPlaceRow(v: PlaceInput & { locality: string | null; province: string | null }) {
  const status: (typeof addressStatus.values)[number] = !v.address_text
    ? "sin_direccion"
    : v.address_verified
      ? "verificada"
      : "no_verificada";
  return {
    address_text: v.address_text,
    locality: v.locality,
    province: v.province ?? "Neuquén",
    address_status: status,
    location_source_id: status === "verificada" ? v.location_source_id : null,
    location_verified_at: status === "verificada" ? new Date().toISOString() : null,
    // Coordenadas sin dirección verificada se aceptan, marcadas como no verificadas (V13 §12).
    latitude: v.latitude,
    longitude: v.longitude,
    location_status: v.latitude == null ? null : status === "verificada" ? ("verified" as const) : ("unverified" as const),
    location_source: v.latitude == null ? null : "manual",
  };
}

// --- Esquemas -------------------------------------------------------------------
export const campaignSchema = z.object({
  name: z.string().trim().min(1, "Nombre obligatorio"),
  zone: opt,
  objective: opt,
  starts_on: optDate,
  ends_on: optDate,
  status: z.enum(campaignStatus.values).default("activa"),
  kind: z.enum(["mision", "proyecto"]).default("proyecto"),
  vertical_ids: ids,
});

export const verticalSchema = z.object({
  name: z.string().trim().min(1, "Nombre obligatorio"),
  thesis: opt,
  problem_sought: opt,
});

export const sourceSchema = z
  .object({
    kind: z.enum(sourceKind.values),
    title: z.string().trim().min(1, "Título obligatorio"),
    url: optUrl,
    publisher: opt,
    published_at: optDate,
    reference: opt,
    notes: opt,
    is_demo: bool,
  })
  .superRefine((v, ctx) => {
    if (["url", "research_externo", "drive"].includes(v.kind) && !v.url) {
      ctx.addIssue({ code: "custom", path: ["url"], message: "Este tipo de fuente requiere URL" });
    }
    if (["contacto", "observacion"].includes(v.kind) && !v.reference && !v.notes) {
      ctx.addIssue({ code: "custom", path: ["reference"], message: "Indicá quién lo dijo o qué se observó" });
    }
  });

export const companySchema = z
  .object({
    legal_name: opt,
    trade_name: opt,
    kind: z.enum(companyKind.values).default("otro"),
    website: optUrl,
    locality: opt,
    notes: opt,
    is_demo: bool,
    ...verification,
  })
  .superRefine((v, ctx) => {
    if (!v.legal_name && !v.trade_name) {
      ctx.addIssue({ code: "custom", path: ["trade_name"], message: "Indicá nombre comercial o razón social" });
    }
    requireSourceForStatus(v, ctx);
  });

export const establishmentSchema = z
  .object({
    name: z.string().trim().min(1, "Nombre obligatorio"),
    company_id: optUuid,
    notes: opt,
    is_demo: bool,
    ...placeFields,
    ...verification,
  })
  .superRefine((v, ctx) => {
    refinePlace(v, ctx);
    requireSourceForStatus(v, ctx);
  });

export const assetSchema = z
  .object({
    kind: z.enum(assetKind.values),
    operation: z.enum(assetOperation.values).default("desconocida"),
    title: z.string().trim().min(1, "Título obligatorio"),
    surface_m2: optNumber,
    price_amount: optNumber,
    price_currency: z.enum(["ARS", "USD"]).optional().or(z.literal("")).transform((v) => (v ? v : null)),
    price_observed_on: optDate,
    price_source_id: optUuid,
    establishment_id: optUuid,
    notes: opt,
    is_demo: bool,
    ...placeFields,
    ...verification,
  })
  .superRefine((v, ctx) => {
    refinePlace(v, ctx);
    requireSourceForStatus(v, ctx);
    const price = [v.price_amount, v.price_currency, v.price_observed_on, v.price_source_id];
    if (price.some((x) => x != null) && price.some((x) => x == null)) {
      ctx.addIssue({
        code: "custom",
        path: ["price_amount"],
        message: "El precio publicado requiere monto, moneda, fecha y fuente (o dejar todo vacío)",
      });
    }
    if (v.surface_m2 != null && v.surface_m2 <= 0) {
      ctx.addIssue({ code: "custom", path: ["surface_m2"], message: "Superficie inválida" });
    }
  });

export const contactSchema = z
  .object({
    full_name: z.string().trim().min(1, "Nombre obligatorio"),
    role_title: opt,
    email: z.email("Email inválido").optional().or(z.literal("")).transform((v) => (v ? v : null)),
    phone: opt,
    preferred_channel: z
      .enum(["presencial", "telefono", "whatsapp", "email", "otro"])
      .optional()
      .or(z.literal(""))
      .transform((v) => (v ? v : null)),
    contact_kind: z.enum(contactKind.values).default("persona"),
    contact_permission: z.enum(contactPermission.values).default("sin_definir"),
    introduced_by: opt,
    notes: opt,
    is_demo: bool,
    relation: z.enum(contactRelation.values).default("otro"),
    link_kind: z.enum(entityKind.values).optional(),
    link_id: optUuid,
    ...verification,
  })
  .superRefine((v, ctx) => {
    requireSourceForStatus(v, ctx);
    if ((v.email || v.phone) && !v.source_id) {
      ctx.addIssue({
        code: "custom",
        path: ["source_id"],
        message: "Email o teléfono solo con la fuente que los aportó",
      });
    }
  });

export const evidenceSchema = z
  .object({
    statement: z.string().trim().min(1, "Escribí qué sabemos"),
    quote: opt,
    evidence_type: z.enum(evidenceType.values).default("dato"),
    origin_kind: z.enum(evidenceOrigin.values).default("manual"),
    entity_kind: z.enum([...entityKind.values, "contact"]),
    entity_id: z.uuid(),
    next_verification_step: opt,
    ...verification,
  })
  .superRefine(requireSourceForStatus);

export const targetFieldsSchema = z
  .object({
    status: z.enum(targetStatus.values).default("investigacion"),
    priority: z.coerce.number().int().min(1).max(3).default(2),
    next_action: opt,
    next_action_due: optDate,
    discard_reason: opt,
    vertical_ids: ids,
  })
  .superRefine((v, ctx) => {
    if (v.status === "descartado" && !v.discard_reason) {
      ctx.addIssue({ code: "custom", path: ["discard_reason"], message: "Indicá el motivo del descarte" });
    }
  });

export const visitPlanSchema = z.object({
  title: z.string().trim().min(1, "Título obligatorio"),
  planned_on: z.iso.date({ message: "Fecha obligatoria" }),
  campaign_id: optUuid,
  notes: opt,
});

export const stopStatusSchema = z.enum(stopStatus.values);

export const visitSchema = z.object({
  target_id: z.uuid(),
  stop_id: optUuid,
  visited_at: z.iso.datetime({ local: true, message: "Fecha y hora inválidas" }),
  interlocutor_name: opt,
  contact_id: optUuid,
  consent_status: z.enum(consentStatus.values).default("no_registrado"),
  notes: z.string().trim().min(1, "Las notas no pueden quedar vacías"),
  is_demo: bool,
});

export const inviteSchema = z
  .object({
    email: z.email("Email inválido").transform((v) => v.toLowerCase()),
    role: z.enum(["admin", "member", "viewer"]),
    can_approve_decisions: bool,
  })
  .superRefine((v, ctx) => {
    if (v.role === "viewer" && v.can_approve_decisions) {
      ctx.addIssue({ code: "custom", path: ["can_approve_decisions"], message: "Solo lectura no puede aprobar" });
    }
  });

// --- FormData → objeto -------------------------------------------------------------
/** Campos repetidos (checkbox múltiples) se devuelven como arrays si su nombre termina en `_ids`. */
export function formToObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of new Set(fd.keys())) {
    if (key.startsWith("$ACTION")) continue;
    const all = fd.getAll(key).filter((v): v is string => typeof v === "string");
    out[key] = key.endsWith("_ids") ? all.filter(Boolean) : all[all.length - 1];
  }
  return out;
}

export type FieldErrors = Record<string, string>;

export function zodFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    out[key] ??= issue.message;
  }
  return out;
}

// --- Corte B -----------------------------------------------------------------------
export const findingSchema = z
  .object({
    kind: z.enum(findingKind.values),
    statement: z.string().trim().min(1, "Escribí el hallazgo"),
    evidence: opt,
    analysis: opt,
    verification_status: z.enum(verificationStatus.values).default("unverified"),
    source_id: z.uuid({ message: "Todo hallazgo necesita una fuente" }),
    visit_id: optUuid,
    campaign_id: optUuid,
    vertical_id: optUuid,
    entity: z
      .string()
      .optional()
      .transform((v) => (v ? v : null)),
    origin: z.enum(["manual", "research_externo"]).default("manual"),
  })
  .superRefine(requireSourceForStatus);

export const reviewSchema = z.object({
  verdict: z.enum(["aprobado", "rechazado"]),
  review_note: opt,
});

export const candidateSchema = z.object({
  title: z.string().trim().min(1, "Poné un título"),
  thesis: opt,
  route: z.enum(opportunityRoute.values).default("a_definir"),
  finding_ids: z.array(z.uuid()).min(1, "Elegí al menos un hallazgo aprobado"),
  idempotency_key: z.string().min(8),
});

export const stageSchema = z
  .object({
    stage: z.enum(dealflowStage.values),
    stage_reason: opt,
    next_action: opt,
    next_action_due: optDate,
  })
  .superRefine((v, ctx) => {
    if ((v.stage === "pausada" || v.stage === "descartada") && !v.stage_reason) {
      ctx.addIssue({ code: "custom", path: ["stage_reason"], message: "Indicá el motivo" });
    }
  });

export const decisionRequestSchema = z.object({
  question: z.string().trim().min(1, "Escribí la pregunta a decidir"),
  context: opt,
  due_on: optDate,
});

export const verdictSchema = z.object({
  verdict: z.enum(["approved", "rejected", "deferred"]),
  decision_note: opt,
});

export const taskSchema = z.object({
  title: z.string().trim().min(1, "Poné un título"),
  description: opt,
  assignee_id: optUuid,
  due_on: optDate,
  idempotency_key: z.string().min(8),
});

export const taskStatusSchema = z.enum(taskStatus.values);

export const commentSchema = z.object({ body: z.string().trim().min(1, "El comentario está vacío") });
