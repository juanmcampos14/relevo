import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Dimension, Gap } from "@/domain/readiness";
import { GAPS, metrics as evidenceMetrics, type EvidenceLink } from "@/domain/readiness";
import { ECONOMICS, type EconomicFact } from "@/domain/economics";
import { STAGE_LABEL, caseStage, opportunityCriteria } from "@/domain/case";
import { BASIS, CHANNEL, evidenceProvenance, isStrongSource } from "@/domain/provenance";
import { companyName } from "@/server/entities";
import { qualityChecks } from "@/server/quality";
import type { ToolContext } from "./tools";
import { ANELO, PLACE_CATEGORIES, PLACE_CATEGORY_KEYS, formatDistance, type PlaceCategory, type Point } from "@/domain/geo";
import { geocode, memoryNearby, placesNearby } from "@/server/geo";
import { structureLater } from "@/server/capture/background";
import { missionBrief } from "./mission";
import { fold } from "@/domain/crm-import/map";
import { ContactEventInput, applyContactEvent } from "./contact-events";
import { randomUUID } from "node:crypto";
import { RelationshipInput, applyRelationship } from "./relationships";
import { setAside } from "./set-aside";
import { applyCorrection, forgetMovesAbout, liveFocus, stepTaken } from "@/server/mission/focus";

/** Centro de una consulta territorial: el punto pedido, donde está el usuario o Añelo. */
function centerOf(a: Record<string, unknown>, ctx: ToolContext): { point: Point; label: string } {
  if (typeof a.lat === "number" && typeof a.lng === "number") return { point: { lat: a.lat, lng: a.lng }, label: `${a.lat.toFixed(5)}, ${a.lng.toFixed(5)}` };
  if (ctx.here) return { point: { lat: ctx.here.lat, lng: ctx.here.lng }, label: "donde está el usuario (GPS del teléfono)" };
  return { point: ANELO, label: "centro de Añelo" };
}

// Herramientas de conocimiento del asistente: la memoria completa (no solo la pantalla actual), con la
// procedencia de cada dato. Todas son de lectura; open_page solo navega.

const ref = (type: string, id: string) => `${type}:${id}`;
const clip = (s: string | null | undefined, n = 400) => (s && s.length > n ? `${s.slice(0, n)}…` : s ?? null);
const strict = <T extends Record<string, unknown>>(properties: T, required: (keyof T)[] = []) => ({ type: "object" as const, properties, required: required as string[], additionalProperties: false });

export const KNOWLEDGE_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "find",
    description: "Búsqueda global en la memoria: empresas, activos, establecimientos, personas (por nombre o cargo), hipótesis, evidencia (por texto: p. ej. 'reintegro', '18.000'), capturas y entidades sin identificar. Usala antes de afirmar que algo no existe.",
    input_schema: strict({ query: { type: "string" } }, ["query"]),
  },
  {
    name: "list_hypotheses",
    description: "Hipótesis, findings y casos con su etapa (señal, en validación, caso, oportunidad), casos independientes, contraevidencia, faltantes, economía conocida y qué les falta para ser oportunidad. Filtros: maturity, with_economics, missing_buyer, include_inactive.",
    input_schema: strict({
      maturity: { type: "string", enum: ["idea", "hipotesis", "finding", "caso", "todas"] },
      all_missions: { type: "boolean", description: "true para ver las de todas las misiones (por defecto, la de trabajo)" },
      with_economics: { type: "boolean" },
      missing_buyer: { type: "boolean" },
      include_inactive: { type: "boolean", description: "Incluir casos pausados, cerrados o descartados" },
    }),
  },
  {
    name: "get_hypothesis",
    description: "Estado completo de una hipótesis 'finding:uuid': qué sabemos / creemos / contradice / falta (dimensiones), evidencia con canal y base (observado, declarado, documentado…), economía, criterios de oportunidad, validaciones, pedidos de ayuda e historia (reformulaciones, cambios de estado).",
    input_schema: strict({ ref: { type: "string" } }, ["ref"]),
  },
  {
    name: "get_capture",
    description: "Una captura 'capture:uuid': texto, resumen, qué todavía no sabemos, propuestas y su estado, evidencia que dejó (con canal y base) y si es duplicado de otra.",
    input_schema: strict({ ref: { type: "string" } }, ["ref"]),
  },
  {
    name: "get_person",
    description: "Una persona 'contact:uuid': con quién está, qué afirmó (cada dato con su evidencia, canal y base), acciones y de dónde salió.",
    input_schema: strict({ ref: { type: "string" } }, ["ref"]),
  },
  {
    name: "changes_since",
    description: "Qué cambió en los últimos N días: evidencia nueva (y a qué hipótesis afecta), hipótesis nuevas, reformulaciones, contraevidencia, cambios de estado, capturas procesadas, decisiones y pedidos de ayuda.",
    input_schema: strict({ days: { type: "integer", minimum: 1, maximum: 90 } }, ["days"]),
  },
  {
    name: "quality_checks",
    description: "Alarmas de calidad: personas sin empresa, actividades sin entidad, fuentes sin URL, empresas sin fuente, evidencia vencida, prioridad alta sin responsable o sin próxima acción, oportunidades sin comprador o sin economía, casos sin hito, contradicciones sin resolver, posibles duplicados.",
    input_schema: strict({}),
  },
  {
    name: "upcoming_agenda",
    description: "Agenda de los próximos N días: visitas planificadas con sus paradas y tareas que vencen (incluidas validaciones de hipótesis). Sirve para preparar reuniones.",
    input_schema: strict({ days: { type: "integer", minimum: 1, maximum: 30 } }, ["days"]),
  },
  {
    name: "pending_for_team",
    description: "Qué espera a cada persona del equipo: decisiones por votar y pedidos de ayuda abiertos (a quién, qué, para qué caso).",
    input_schema: strict({}),
  },
  {
    name: "list_members",
    description: "Miembros del workspace con su referencia 'member:uuid' (para proponer un pedido de ayuda).",
    input_schema: strict({}),
  },
  {
    name: "record_field_note",
    description: "Guarda lo que el usuario cuenta de campo (una observación, una conversación, cifras) como CAPTURA original con su ubicación, y la procesa: propone persona, empresa, activo, evidencia (observado ≠ declarado), hipótesis y próximas acciones para que el usuario apruebe. Usala cuando el usuario relata algo que vio, escuchó o le dijeron (\"hoy vi…\", \"hablé con…\", \"me dijeron…\"). No la uses para preguntas. Pasá el relato tal cual en text; en focus, la hipótesis o el tema de la conversación si viene de antes.",
    input_schema: strict({ text: { type: "string" }, focus: { type: "string", description: "Hipótesis o tema del que se viene hablando (opcional)" } }, ["text"]),
  },
  {
    name: "project_status",
    description: "¿Dónde quedamos? Estado de un proyecto 'campaign:uuid' (o de la misión): objetivo, entidades, hipótesis y su estado, capturas recientes, tareas hechas y pendientes, decisiones, pedidos de ayuda y lo que cambió últimamente.",
    input_schema: strict({ ref: { type: "string" } }, ["ref"]),
  },
  {
    name: "locate",
    description: "Ubica un lugar por nombre o dirección (\"Añelo\", \"Ruta 7 y 17, Añelo\", \"parque industrial de Añelo\") y devuelve coordenadas.",
    input_schema: strict({ query: { type: "string" } }, ["query"]),
  },
  {
    name: "places_nearby",
    description: "Lugares reales alrededor de un punto (por defecto, donde está el usuario o el centro de Añelo): por categoría (ferreteria, corralon, electricidad, sanitarios, seguridad_industrial, alojamiento, gastronomia, gimnasio, lavadero, combustible, supermercado, taller, industria) o por texto. Devuelve nombre, distancia, dirección, horarios y la FUENTE (Google Places u OpenStreetMap) con sus límites: cero resultados no significa cero oferta. Complementá con la búsqueda web.",
    input_schema: strict({
      category: { type: "string", enum: [...PLACE_CATEGORY_KEYS] },
      query: { type: "string", description: "Texto libre si no hay categoría" },
      lat: { type: "number" }, lng: { type: "number" },
      radius_m: { type: "integer", minimum: 100, maximum: 25000 },
    }),
  },
  {
    name: "memory_nearby",
    description: "Lo que RELEVO ya tiene alrededor de un punto: activos, empresas (establecimientos) y capturas con coordenadas, con distancias. Por defecto, donde está el usuario o el centro de Añelo.",
    input_schema: strict({ lat: { type: "number" }, lng: { type: "number" }, radius_m: { type: "integer", minimum: 100, maximum: 50000 } }),
  },
  {
    name: "show_map",
    description: "Abre el mapa para el usuario centrado en un punto con un radio, con nuestra memoria y, si se indica, una categoría de lugares reales (p. ej. ferreteria). Usala cuando pide ver algo en el mapa o después de un análisis territorial.",
    input_schema: strict({ lat: { type: "number" }, lng: { type: "number" }, radius_m: { type: "integer", minimum: 100, maximum: 25000 }, category: { type: "string", enum: [...PLACE_CATEGORY_KEYS] } }),
  },
  {
    name: "morning_brief",
    description: "El Morning Brief de RELEVO (parte diario de inteligencia externa: Vaca Muerta News, medios regionales, oficiales y corporativos, cruzado con la memoria). Sin 'date' trae el último generado; incluye señales (hecho/declaración/inferencia, fuente, vertical, empresa), acciones sugeridas, preguntas para campo, historias vivas y watchlist. Usalo para '¿qué hay hoy?', '¿qué dijo el brief?', '¿qué pasó con X en las noticias?' o para cruzar noticias con una hipótesis. Lo externo es contexto: no prueba demanda.",
    input_schema: strict({ date: { type: "string", description: "YYYY-MM-DD (opcional)" } }),
  },
  {
    name: "context_documents",
    description: "Documentos de contexto del equipo (p. ej. la presentación de las 16 verticales: metodología, ficha común por vertical, preguntas de campo; el kickoff de la misión). Sin 'document_ref' lista los vigentes con su resumen; con 'document_ref' devuelve el texto completo (o los párrafos que contienen 'query'). Usalo para entender por qué y cómo se pensó el trabajo, qué preguntas hacer en una vertical o cómo encaja algo en el mapa. NO es evidencia: si la evidencia o la memoria dicen otra cosa, mandan ellas.",
    input_schema: strict({ document_ref: { type: "string", description: "document:uuid" }, query: { type: "string" } }),
  },
  {
    name: "mission_brief",
    description: "Todo lo que el Brain sabe de una misión en una llamada (por defecto la misión activa, p. ej. Añelo): fechas y momento (preparación / en curso), documentos del plan, hipótesis con qué creemos, nivel de evidencia, gaps y quién puede ayudar, objetivos y prioridades, contactos con borrador de primer contacto listo, follow-ups hasta el fin de la misión, agenda, guiones AOG, activos del Radar con último precio, historias vivas, señales recientes y cobertura de ubicaciones. Usala para 'preparame el viaje', '¿qué estamos intentando comprobar?', '¿con quién hablo?', '¿qué hago esta semana para la misión?'. Es materia prima: sintetizá lo importante ahora, no la repitas.",
    input_schema: strict({ ref: { type: "string", description: "campaign:uuid (opcional: por defecto la misión activa)" }, detail: { type: "boolean", description: "true para el detalle completo (hipótesis, guiones AOG, activos, follow-ups, señales). Por defecto trae solo lo que RELEVO ya preparó." } }),
  },
  {
    name: "aog_plan",
    description: "Plan de AOG Patagonia que RELEVO ya preparó: a quién buscar, por qué, qué sabemos, qué queremos descubrir, con quién hablar, qué preguntar y qué cambiaría con la respuesta; y qué no vale el tiempo. Usala para '¿a quién busco en AOG?' y para 'estoy frente a X, ¿entro?' (si X no está en el plan, buscala con find).",
    input_schema: strict({ company: { type: "string", description: "Nombre de la empresa si preguntan por una en particular (opcional)" } }),
  },
  {
    name: "research_questions",
    description: "Preguntas del diseño de investigación: guiones de conversación AOG (aog=true), preguntas de entrevista, de Voice, reglas y controles, con las hipótesis que validan. Filtros: finding_ref (preguntas de una hipótesis), aog, kind (entrevista, regla, voice, control), query (texto). Usala para preparar una conversación o una visita.",
    input_schema: strict({
      finding_ref: { type: "string" },
      aog: { type: "boolean" },
      kind: { type: "string", enum: ["entrevista", "regla", "voice", "control"] },
      query: { type: "string" },
    }),
  },
  {
    name: "signals",
    description: "Señales externas guardadas (Morning Brief y Radar) con su historia: qué pasó, hecho/declaración/inferencia, fuente, fecha, vertical, empresas e hipótesis relacionadas. Filtros: query (texto), days (por defecto 30), company_ref, finding_ref. Son contexto: no prueban demanda.",
    input_schema: strict({ query: { type: "string" }, days: { type: "integer", minimum: 1, maximum: 365 }, company_ref: { type: "string" }, finding_ref: { type: "string" }, all_missions: { type: "boolean", description: "true para ver las de todas las misiones (por defecto, la de trabajo)" } }),
  },
  {
    name: "record_contact_event",
    description: "Registra lo que la persona te cuenta de su outreach y lo APLICA en el momento (queda auditado y se puede deshacer): event='mensaje_enviado' (\"ya le escribí a…\"): cierra el pendiente de contactarlo y deja un seguimiento si no responde (follow_up_on opcional; por defecto 3 días hábiles). event='reunion_confirmada' (\"X confirmó el miércoles 11:30\"): agrega la reunión a la agenda de la misión con su objetivo y devuelve el link para Calendar. Antes, identificá a la persona o la empresa (find / get_person): si hay más de una posible, preguntá cuál en vez de registrar. Convertí 'el miércoles' a fecha real según hoy.",
    input_schema: strict({
      event: { type: "string", enum: ["mensaje_enviado", "reunion_confirmada"] },
      contact_ref: { type: "string" },
      company_ref: { type: "string" },
      channel: { type: "string", description: "WhatsApp, LinkedIn, mail, llamada…" },
      date: { type: "string", description: "YYYY-MM-DD (reunión)" },
      time: { type: "string", description: "HH:MM (reunión)" },
      place: { type: "string" },
      objective: { type: "string", description: "Para qué es la reunión: qué queremos validar y con qué hipótesis" },
      note: { type: "string" },
      follow_up_on: { type: "string", description: "YYYY-MM-DD" },
    }, ["event"]),
  },
  {
    name: "set_aside",
    description: "La persona dice que algo ya no importa o que no se lo muestres más (\"sacá ese terreno\", \"esa empresa no nos sirve\", \"descartá esa idea\"). Lo descarta en la misión de trabajo SIN borrarlo: queda el motivo y la historia, y deja de aparecer. ref: 'asset:…', 'company:…', 'establishment:…' o 'finding:…' (identificalo antes). reason: en sus palabras. Lo hacés vos, en el momento; nunca le pidas que lo haga en otra pantalla. Se puede deshacer.",
    input_schema: strict({ ref: { type: "string" }, reason: { type: "string" } }, ["ref", "reason"]),
  },
  {
    name: "mission_people",
    description: "Las personas que conoce la misión de trabajo (es exactamente el número de 'Lo que ya conozco'): con quién están o estuvieron, si la relación sigue vigente y por qué cuentan. Para \"¿quiénes son esas 44 personas?\", \"¿a quién conocemos de YPF?\", \"¿a quién conocemos relacionado con terrenos?\". query opcional filtra por nombre, empresa o activo.",
    input_schema: strict({ query: { type: "string" } }),
  },
  {
    name: "watch_for",
    description: "La persona pide que le avisen si aparece algo (\"avisame cuando haya locales chicos en Añelo\", \"si aparece una contratista nueva, avisame\"). Queda como pedido de aviso de la misión: la vigilancia lo mira durante el día y avisa (mail + inicio) solo si aparece algo que lo cumple. criterion: qué tiene que aparecer, concreto y en sus palabras; queries: 1 a 3 búsquedas de noticias o avisos que ayuden a encontrarlo. No lo conviertas en una tarea. Confirmá en una línea.",
    input_schema: strict({ criterion: { type: "string" }, queries: { type: "array", items: { type: "string" } } }, ["criterion"]),
  },
  {
    name: "switch_mission",
    description: "Cambia la misión de trabajo cuando la persona lo pide (\"entrá a Vaca Muerta\", \"quiero trabajar en Locales Zona Norte\"). mission_ref = 'campaign:…' de las misiones del contexto. Después respondé en una línea en qué misión están y qué movería ahí.",
    input_schema: strict({ mission_ref: { type: "string" } }, ["mission_ref"]),
  },
  {
    name: "create_mission",
    description: "Crea una misión nueva cuando la persona quiere investigar algo distinto (\"quiero investigar locales en San Isidro\"). Proponé en una línea nombre y objetivo y creala cuando diga que sí; no hagas una entrevista: lo que definió (tamaño, zona, presupuesto, concepto) va en declared y lo que falte se aprende después. Entra directo a trabajar en ella y RELEVO prepara un primer panorama por detrás.",
    input_schema: strict({
      name: { type: "string", description: "2 a 4 palabras" },
      objective: { type: "string", description: "Una oración, con verbo" },
      context: { type: "string", description: "zona · rubros · tipo de oportunidades" },
      zone: { type: "string" },
      queries: { type: "array", items: { type: "string" }, description: "3 a 6 búsquedas de noticias para vigilarla" },
      declared: { type: "array", items: { type: "string" }, description: "Lo que la persona definió (tamaño, zona, presupuesto, concepto, restricciones): contexto, no evidencia" },
    }, ["name", "objective", "context"]),
  },
  {
    name: "update_relationship",
    description: "La persona corrige quién trabaja dónde (\"Nicolás Raviola ya no trabaja en Pecom\", \"ahora está en Vista como jefe de compras\"). Lo APLICA en el momento, sin borrar historia: change='ya_no_esta' deja la relación como anterior (fecha, quién lo validó, evidencia), deja de recomendar a esa persona para esa empresa, cierra los pendientes de contactarla y abre 'encontrar a quien la reemplaza'; change='ahora_esta' la vincula con su cargo (role). Antes identificá a la persona y la empresa (find / get_person). Después de aplicarlo, seguí el trabajo: buscá la persona nueva o el canal y proponé el próximo paso. Se puede deshacer.",
    input_schema: strict({
      change: { type: "string", enum: ["ya_no_esta", "ahora_esta"] },
      contact_ref: { type: "string" },
      company_ref: { type: "string" },
      role: { type: "string", description: "Cargo actual (ahora_esta)" },
      since: { type: "string", description: "YYYY-MM-DD, si se sabe desde cuándo" },
      note: { type: "string", description: "Cómo lo supo, en sus palabras (\"lo vi en LinkedIn\")" },
    }, ["change", "contact_ref", "company_ref"]),
  },
  {
    name: "research_in_background",
    description: "Investiga POR DETRÁS una idea o pregunta abierta de la calle (\"esta zona me parece buena para una cafetería\", \"¿hay algo acá para un depósito?\") sin hacer esperar a la persona: mirás territorio, web y memoria, y la lectura queda en su inicio con el próximo paso listo. Usala cuando la respuesta necesita investigar en serio (varias búsquedas); después respondé en una línea qué vas a mirar (\"Sí, hay una señal interesante. Voy a mirar oferta cercana, movimiento y locales disponibles; te lo dejo en el inicio.\"). question: lo que hay que investigar, completo y con el lugar. title: cómo se verá en el inicio (p. ej. \"Cafetería gourmet en Libertador y Tagle\").",
    input_schema: strict({ question: { type: "string" }, title: { type: "string" } }, ["question", "title"]),
  },
  {
    name: "adjust_focus",
    description: "Corrige las prioridades del home cuando la persona lo pide (\"esto primero\", \"FERRELEC mañana\", \"sacame esto\", \"esto ya no importa\", \"ya lo hice\", \"sumá ver locales en Libertador\"). action: primero | posponer (until YYYY-MM-DD) | sacar | hecha | agregar (title y, si se puede, refs de empresas o personas). focus_id sale de las prioridades del contexto. note: por qué, en sus palabras (le sirve al Brain). Se aplica en el momento; confirmá en una línea.",
    input_schema: strict({
      action: { type: "string", enum: ["primero", "posponer", "sacar", "hecha", "agregar"] },
      focus_id: { type: "string" },
      until: { type: "string", description: "YYYY-MM-DD (posponer)" },
      title: { type: "string", description: "Qué hay que hacer (agregar), con verbo" },
      refs: { type: "array", items: { type: "string" } },
      note: { type: "string" },
    }, ["action"]),
  },
  {
    name: "open_page",
    description: "Lleva al usuario a una pantalla: una referencia 'tipo:uuid' (empresa, activo, persona, hipótesis, captura, oportunidad…) o una vista ('hoy', 'ejecutiva', 'red', 'personas', 'evidencia', 'calidad', 'actividades', 'capturas', 'sin_identificar'). Usala cuando el usuario pide ir, abrir o mostrar algo.",
    input_schema: strict({ target: { type: "string" }, query: { type: "string", description: "Filtro de búsqueda para vistas de lista (opcional)" } }, ["target"]),
  },
];

export const KNOWLEDGE_TOOL_NAMES = new Set(KNOWLEDGE_TOOLS.map((t) => t.name));

const Str = z.string();
const provenanceOf = (e: { origin_kind: string; verification_status: string; declared_by: string | null }, speaker?: string | null) => {
  const p = evidenceProvenance({ ...e, speaker });
  return { channel: CHANNEL[p.channel], basis: BASIS[p.basis], detail: p.detail ?? null };
};
const since = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

function track(ctx: ToolContext, value: unknown) {
  const text = JSON.stringify(value);
  for (const m of text.matchAll(/"ref":"([a-z]+:[0-9a-f-]{36})"/g)) ctx.seenRefs.add(m[1]);
  return text;
}

export async function runKnowledgeTool(name: string, a: Record<string, unknown>, ctx: ToolContext): Promise<{ content: string; isError?: boolean }> {
  const { db } = ctx;
  const base = `/w/${ctx.slug}`;
  switch (name) {
    case "find": {
      const q = Str.min(2).safeParse(a.query);
      if (!q.success) return { content: "La búsqueda necesita al menos 2 letras", isError: true };
      const term = `%${q.data.replace(/[%_\\]/g, "\\$&").replace(/[,()]/g, " ")}%`;
      // Trabajo de fondo (sin usuario, con permisos de sistema): solo lo de esta misión o la memoria común,
      // nunca lo que nació en otra misión (puede ser privada).
      const m = ctx.background ? ctx.missionId ?? "00000000-0000-0000-0000-000000000000" : null;
      const own = <T extends { or: (f: string) => T }>(q: T) => (m ? q.or(`origin_campaign_id.is.null,origin_campaign_id.eq.${m}`) : q);
      const inMission = <T extends { eq: (c: string, v: string) => T }>(q: T) => (m ? q.eq("campaign_id", m) : q);
      const [c, as, es, ct, f, ev, cap, u] = await Promise.all([
        own(db.from("companies").select("id, trade_name, legal_name, activity, locality").or(`trade_name.ilike.${term},legal_name.ilike.${term},activity.ilike.${term}`)).limit(10),
        own(db.from("assets").select("id, title, kind, operation, locality").or(`title.ilike.${term},address_text.ilike.${term}`)).limit(10),
        own(db.from("establishments").select("id, name, address_text").or(`name.ilike.${term},address_text.ilike.${term}`)).limit(10),
        own(db.from("contacts").select("id, full_name, role_title, contact_kind").or(`full_name.ilike.${term},role_title.ilike.${term}`)).limit(10),
        inMission(db.from("findings").select("id, statement, maturity, case_status").ilike("statement", term).neq("review_status", "rechazado")).limit(10),
        inMission(db.from("evidence").select("id, statement, origin_kind, verification_status, declared_by, capture_id, company_id").ilike("statement", term)).limit(12),
        inMission(db.from("captures").select("id, captured_at, ai_summary, status").or(`body.ilike.${term},ai_summary.ilike.${term}`)).limit(8),
        db.from("unresolved_entities").select("id, kind, label").ilike("label", term).is("resolved_at", null).limit(8),
      ]);
      return {
        content: track(ctx, {
          companies: (c.data ?? []).map((x) => ({ ref: ref("company", x.id), name: companyName(x), activity: x.activity, locality: x.locality })),
          assets: (as.data ?? []).map((x) => ({ ref: ref("asset", x.id), name: x.title, kind: x.kind, operation: x.operation, locality: x.locality })),
          establishments: (es.data ?? []).map((x) => ({ ref: ref("establishment", x.id), name: x.name, address: x.address_text })),
          people: (ct.data ?? []).map((x) => ({ ref: ref("contact", x.id), name: x.full_name, role: x.role_title, kind: x.contact_kind })),
          hypotheses: (f.data ?? []).map((x) => ({ ref: ref("finding", x.id), statement: x.statement, maturity: x.maturity, case_status: x.case_status })),
          evidence: (ev.data ?? []).map((x) => ({ ref: ref("evidence", x.id), statement: x.statement, provenance: provenanceOf(x), capture: x.capture_id ? { ref: ref("capture", x.capture_id) } : null, company: x.company_id ? { ref: ref("company", x.company_id) } : null })),
          captures: (cap.data ?? []).map((x) => ({ ref: ref("capture", x.id), captured_at: x.captured_at, summary: clip(x.ai_summary, 200), status: x.status })),
          unidentified: (u.data ?? []).map((x) => ({ kind: x.kind, label: x.label, note: "entidad sin identificar (organización o persona real todavía desconocida)" })),
        }),
      };
    }
    case "list_hypotheses": {
      let q = db
        .from("findings")
        .select("id, statement, maturity, case_status, finding_assessments(created_at, summary, gaps, dimensions, economics, independent_cases, contradicts, discovery), opportunity_findings(opportunities(status))")
        .neq("review_status", "rechazado")
        .limit(100);
      // Las de la misión de trabajo (la memoria es compartida: all_missions=true para ver las de todas).
      if (ctx.missionId && (a.all_missions !== true || ctx.background)) q = q.eq("campaign_id", ctx.missionId);
      if (typeof a.maturity === "string" && a.maturity !== "todas") q = q.eq("maturity", a.maturity);
      if (a.include_inactive !== true) q = q.eq("case_status", "activo");
      const { data } = await q;
      const rows = (data ?? []).map((f) => {
        const as = [...f.finding_assessments].sort((x, y) => y.created_at.localeCompare(x.created_at))[0];
        const dims = (as?.dimensions ?? []) as unknown as Dimension[];
        const gaps = (as?.gaps ?? []) as Gap[];
        const economics = (as?.economics ?? []) as unknown as EconomicFact[];
        const cases = as?.independent_cases ?? 0;
        const crit = opportunityCriteria({ dims, gaps, metrics: { independentCases: cases, contradicts: as?.contradicts ?? 0 }, economics, nextMilestone: "—" });
        const buyer = dims.some((d) => (d.key === "comprador" || d.key === "decisor") && d.status === "sabido");
        return {
          ref: ref("finding", f.id),
          statement: f.statement,
          stage: STAGE_LABEL[caseStage({ maturity: f.maturity, independentCases: cases, hasOpportunity: f.opportunity_findings.some((o) => o.opportunities && o.opportunities.status !== "rechazada") })],
          case_status: f.case_status,
          independent_cases: cases,
          contradicting: as?.contradicts ?? 0,
          summary: clip(as?.summary, 300),
          gaps: gaps.map((g) => GAPS[g]?.label ?? g),
          discovery: as?.discovery ? { belief: (as.discovery as { belief?: string }).belief, evidence_level: (as.discovery as { evidence_level?: string }).evidence_level } : null,
          economics: economics.map((e) => ({ variable: ECONOMICS[e.variable], value: e.value, basis: e.basis === "estimado" ? "inferido (estimación)" : e.basis, formula: e.formula })),
          buyer_known: buyer,
          missing_for_opportunity: crit.items.filter((i) => !i.ok && i.key !== "hito").map((i) => i.label),
          assessed: !!as,
        };
      });
      const filtered = rows.filter((r) => (a.with_economics === true ? r.economics.some((e) => !e.basis.startsWith("inferido")) : true) && (a.missing_buyer === true ? !r.buyer_known : true));
      return { content: track(ctx, filtered) };
    }
    case "get_hypothesis": {
      const m = Str.regex(/^finding:([0-9a-f-]{36})$/).safeParse(a.ref);
      if (!m.success) return { content: "Referencia inválida: usá 'finding:uuid'", isError: true };
      const id = m.data.split(":")[1];
      const [{ data: f }, { data: as }, { data: revs }, { data: helps }, { data: props }, { data: tasks }] = await Promise.all([
        db.from("findings").select("id, statement, maturity, case_status, kind, analysis, created_at, finding_evidence(stance, evidence(id, statement, quote, origin_kind, verification_status, declared_by, observed_at, capture_id, company_id, stated_by_contact_id, visit_id, source_id, about_unresolved_id, stated_by_unresolved_id, stated_by:contacts!evidence_workspace_id_stated_by_contact_id_fkey(full_name, role_title)))").eq("id", id).maybeSingle(),
        db.from("finding_assessments").select("created_at, summary, gaps, dimensions, economics, discovery").eq("finding_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        db.from("finding_revisions").select("kind, relation, previous_value, new_value, reason, created_at").eq("finding_id", id).order("created_at"),
        db.from("help_requests").select("kind, ask, status, result").eq("finding_id", id),
        db.from("proposals").select("payload, status").eq("finding_id", id).eq("status", "propuesta"),
        db.from("tasks").select("id, title, status, due_on").eq("finding_id", id),
      ]);
      if (!f) return { content: "No encontrado o sin acceso", isError: true };
      const rows = f.finding_evidence.filter((x) => x.evidence);
      const links = rows.map((x) => ({ ...x.evidence!, stance: x.stance })) as unknown as EvidenceLink[];
      const m2 = evidenceMetrics(links, new Date().toISOString().slice(0, 10));
      const dims = (as?.dimensions ?? []) as unknown as Dimension[];
      const economics = (as?.economics ?? []) as unknown as EconomicFact[];
      const milestone = tasks?.find((t) => t.status !== "done")?.title ?? (props?.[0]?.payload as { title?: string } | undefined)?.title ?? null;
      const crit = opportunityCriteria({ dims, gaps: (as?.gaps ?? []) as Gap[], metrics: m2, economics, nextMilestone: milestone, strongSources: rows.filter((r) => r.stance === "supports" && isStrongSource(r.evidence!)).length });
      return {
        content: track(ctx, {
          ref: ref("finding", id),
          statement: f.statement,
          maturity: f.maturity,
          case_status: f.case_status,
          counts: { supports: m2.supports, contradicts: m2.contradicts, independent_cases: m2.independentCases },
          assessment: as ? { at: as.created_at, summary: as.summary, dimensions: dims.map((d) => ({ dimension: d.key, status: d.status, summary: d.summary, evidence: d.evidence_ids.map((e) => ({ ref: ref("evidence", e) })) })), gaps: ((as.gaps ?? []) as Gap[]).map((g) => GAPS[g]?.label ?? g) } : "sin evaluar todavía",
          discovery: as?.discovery ?? null,
          economics: economics.map((e) => ({ variable: ECONOMICS[e.variable], value: e.value, basis: e.basis === "estimado" ? "inferido (estimación)" : e.basis, formula: e.formula, evidence: e.evidence_ids.map((x) => ({ ref: ref("evidence", x) })) })),
          opportunity_criteria: crit.items.map((i) => ({ criterion: i.label, met: i.ok, detail: i.detail })),
          evidence: rows.map((r) => ({
            ref: ref("evidence", r.evidence!.id),
            stance: r.stance,
            statement: r.evidence!.statement,
            quote: clip(r.evidence!.quote, 200),
            provenance: provenanceOf(r.evidence!, r.evidence!.stated_by?.full_name),
            observed_at: r.evidence!.observed_at,
            capture: r.evidence!.capture_id ? { ref: ref("capture", r.evidence!.capture_id) } : null,
          })),
          next_validations: [...(tasks ?? []).filter((t) => t.status !== "done").map((t) => ({ ref: ref("task", t.id), title: t.title, due_on: t.due_on, scheduled: true })), ...(props ?? []).map((p) => ({ title: (p.payload as { title?: string }).title, scheduled: false }))],
          help_requests: helps ?? [],
          history: (revs ?? []).map((r) => ({ at: r.created_at, kind: r.kind, relation: r.relation, from: r.previous_value, to: r.new_value, reason: r.reason })),
        }),
      };
    }
    case "get_capture": {
      const m = Str.regex(/^capture:([0-9a-f-]{36})$/).safeParse(a.ref);
      if (!m.success) return { content: "Referencia inválida: usá 'capture:uuid'", isError: true };
      const id = m.data.split(":")[1];
      const [{ data: c }, { data: props }, { data: ev }] = await Promise.all([
        db.from("captures").select("id, captured_at, body, ai_summary, ai_unknowns, status, duplicate_of, transcripts(text)").eq("id", id).maybeSingle(),
        db.from("proposals").select("kind, status, payload").eq("capture_id", id).order("position"),
        db.from("evidence").select("id, statement, origin_kind, verification_status, declared_by, media_start_ms, stated_by:contacts!evidence_workspace_id_stated_by_contact_id_fkey(full_name)").eq("capture_id", id),
      ]);
      if (!c) return { content: "No encontrado o sin acceso", isError: true };
      return {
        content: track(ctx, {
          ref: ref("capture", id),
          captured_at: c.captured_at,
          status: c.status,
          duplicate_of: c.duplicate_of ? { ref: ref("capture", c.duplicate_of), note: "misma conversación: no cuenta como fuente nueva" } : null,
          note: clip(c.body, 1500),
          transcript: clip(c.transcripts.map((t) => t.text).filter(Boolean).join("\n"), 3000),
          summary: c.ai_summary,
          unknowns: c.ai_unknowns,
          proposals: (props ?? []).map((p) => ({ kind: p.kind, status: p.status, what: String((p.payload as Record<string, unknown>).statement ?? (p.payload as Record<string, unknown>).name ?? (p.payload as Record<string, unknown>).title ?? (p.payload as Record<string, unknown>).role ?? "") })),
          evidence: (ev ?? []).map((e) => ({ ref: ref("evidence", e.id), statement: e.statement, provenance: provenanceOf(e, e.stated_by?.full_name), audio_second: e.media_start_ms != null ? Math.floor(e.media_start_ms / 1000) : null })),
        }),
      };
    }
    case "get_person": {
      const m = Str.regex(/^contact:([0-9a-f-]{36})$/).safeParse(a.ref);
      if (!m.success) return { content: "Referencia inválida: usá 'contact:uuid'", isError: true };
      const id = m.data.split(":")[1];
      const [{ data: c }, { data: said }, { data: tasks }] = await Promise.all([
        db.from("contacts").select("id, full_name, role_title, contact_kind, contact_permission, relationship_status, outreach_draft, profile_url, email, phone, contact_links(valid_until, ended_note, role_title, companies(id, trade_name, legal_name))").eq("id", id).maybeSingle(),
        db.from("evidence").select("id, statement, origin_kind, verification_status, declared_by, observed_at, capture_id").eq("stated_by_contact_id", id).limit(40),
        db.from("tasks").select("id, title, status, due_on").eq("contact_id", id),
      ]);
      if (!c) return { content: "No encontrado o sin acceso", isError: true };
      return {
        content: track(ctx, {
          ref: ref("contact", id),
          name: c.full_name, role: c.role_title, kind: c.contact_kind, may_contact: c.contact_permission, relationship: c.relationship_status,
          profile_url: c.profile_url, email: c.email, phone: c.phone,
          outreach_draft: c.outreach_draft ?? null,
          companies: c.contact_links.flatMap((l) => (l.companies && !l.valid_until ? [{ ref: ref("company", l.companies.id), name: companyName(l.companies), role: l.role_title }] : [])),
          // Dónde estuvo antes (no borrar historia; no presentarla como vigente).
          former: c.contact_links.flatMap((l) => (l.companies && l.valid_until ? [{ ref: ref("company", l.companies.id), name: companyName(l.companies), was: l.role_title, until: l.valid_until, note: l.ended_note }] : [])),
          stated: (said ?? []).map((e) => ({ ref: ref("evidence", e.id), statement: e.statement, provenance: provenanceOf(e, c.full_name), observed_at: e.observed_at, capture: e.capture_id ? { ref: ref("capture", e.capture_id) } : null })),
          tasks: (tasks ?? []).map((t) => ({ ref: ref("task", t.id), title: t.title, status: t.status, due_on: t.due_on })),
        }),
      };
    }
    case "changes_since": {
      const days = typeof a.days === "number" ? Math.min(Math.max(a.days, 1), 90) : 7;
      const s = since(days);
      const [{ data: ev }, { data: nf }, { data: revs }, { data: caps }, { data: dec }, { data: helps }] = await Promise.all([
        db.from("finding_evidence").select("stance, created_at, findings(id, statement), evidence(id, statement, origin_kind, verification_status, declared_by)").gte("created_at", s).order("created_at", { ascending: false }).limit(40),
        db.from("findings").select("id, statement, maturity, review_status, created_at").gte("created_at", s).neq("review_status", "rechazado").limit(20),
        db.from("finding_revisions").select("kind, relation, previous_value, new_value, reason, created_at, findings(id, statement)").gte("created_at", s).limit(20),
        db.from("captures").select("id, captured_at, status, ai_summary").gte("captured_at", s).order("captured_at", { ascending: false }).limit(20),
        db.from("decisions").select("id, question, status, decided_at, created_at").or(`created_at.gte.${s},decided_at.gte.${s}`).limit(20),
        db.from("help_requests").select("kind, ask, status, result, updated_at").gte("updated_at", s).limit(20),
      ]);
      return {
        content: track(ctx, {
          window_days: days,
          evidence_linked: (ev ?? []).map((x) => ({ stance: x.stance, at: x.created_at, hypothesis: x.findings ? { ref: ref("finding", x.findings.id), statement: x.findings.statement } : null, evidence: x.evidence ? { ref: ref("evidence", x.evidence.id), statement: x.evidence.statement, provenance: provenanceOf(x.evidence) } : null })),
          new_hypotheses: (nf ?? []).map((x) => ({ ref: ref("finding", x.id), statement: x.statement, maturity: x.maturity, pending_review: x.review_status === "pendiente_revision" })),
          revisions: (revs ?? []).map((r) => ({ at: r.created_at, kind: r.kind, relation: r.relation, from: r.previous_value, to: r.new_value, reason: r.reason, hypothesis: r.findings ? { ref: ref("finding", r.findings.id) } : null })),
          captures: (caps ?? []).map((c) => ({ ref: ref("capture", c.id), at: c.captured_at, status: c.status, summary: clip(c.ai_summary, 160) })),
          decisions: (dec ?? []).map((d) => ({ ref: ref("decision", d.id), question: d.question, status: d.status })),
          help_requests: helps ?? [],
        }),
      };
    }
    case "morning_brief": {
      let q = db.from("briefs").select("id, brief_date, status, content, generated_at").eq("status", "generado").order("brief_date", { ascending: false }).limit(1);
      if (typeof a.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(a.date)) q = db.from("briefs").select("id, brief_date, status, content, generated_at").eq("brief_date", a.date).limit(1);
      const [{ data: briefs }, { data: stories }] = await Promise.all([
        q,
        db.from("brief_stories").select("id, title, summary, status, watch_reason, first_seen_on, last_seen_on").neq("status", "cerrada").order("last_seen_on", { ascending: false }).limit(20),
      ]);
      const b = briefs?.[0];
      if (!b) return { content: JSON.stringify({ note: "Todavía no hay un Morning Brief generado.", stories: stories ?? [] }) };
      const c = b.content as { headline_points?: unknown; signals?: { id: string; headline: string; summary: string; basis: string; change: string; source_url: string; publisher: string; vertical: string; companies: string[]; company_ids: string[]; finding_ids: string[]; reading: string; story_title: string | null }[]; actions?: unknown; field_questions?: unknown; watchlist?: unknown; connections?: unknown; quiet_day_note?: string };
      return {
        content: track(ctx, {
          brief_date: b.brief_date, generated_at: b.generated_at, page: `${base}/brief/${b.id}`, quiet_day_note: c.quiet_day_note || null,
          headline_points: c.headline_points, connections: c.connections, actions: c.actions, field_questions: c.field_questions, watchlist: c.watchlist,
          signals: (c.signals ?? []).map((s) => ({ headline: s.headline, summary: s.summary, basis: s.basis, change: s.change, vertical: s.vertical, companies: s.companies, source: s.source_url || null, publisher: s.publisher, reading_inference: s.reading, story: s.story_title, memory: [...s.company_ids.map((id) => ({ ref: `company:${id}` })), ...s.finding_ids.map((id) => ({ ref: `finding:${id}` }))] })),
          stories: stories ?? [],
        }),
      };
    }
    case "context_documents": {
      const id = typeof a.document_ref === "string" ? a.document_ref.replace(/^document:/, "") : null;
      if (!id) {
        const { data } = await db.from("context_documents").select("id, title, kind, summary, source_url").eq("status", "vigente").order("kind").order("title");
        return { content: track(ctx, { note: "Documentos de contexto: explican el plan original; no son evidencia.", documents: (data ?? []).map((d) => ({ ref: `document:${d.id}`, title: d.title, kind: d.kind, summary: d.summary, url: d.source_url })) }) };
      }
      const { data: d } = await db.from("context_documents").select("id, title, body, source_url, updated_at").eq("id", id).maybeSingle();
      if (!d) return { content: "No existe ese documento.", isError: true };
      const q = typeof a.query === "string" ? a.query.trim().toLowerCase() : "";
      const parts = d.body.split(/\n{2,}/);
      const body = q ? parts.filter((p) => p.toLowerCase().includes(q)).join("\n\n") || `(sin párrafos con "${a.query}"; texto completo abajo)\n\n${d.body}` : d.body;
      return { content: track(ctx, { ref: `document:${d.id}`, title: d.title, url: d.source_url, updated_at: d.updated_at, hierarchy: "evidencia actual → memoria operativa → decisiones → fuentes → documentos de contexto", body: body.slice(0, 20000) }) };
    }
    case "quality_checks": {
      const checks = await qualityChecks(db, ctx.slug, new Date().toISOString().slice(0, 10));
      return { content: track(ctx, checks.filter((c) => c.items.length).map((c) => ({ check: c.label, why: c.why, count: c.items.length, examples: c.items.slice(0, 5).map((i) => ({ ...(/^(company|contact|finding|opportunity|source|task|capture|evidence):/.test(i.ref) ? { ref: i.ref } : {}), label: i.label })) }))) };
    }
    case "upcoming_agenda": {
      const days = typeof a.days === "number" ? a.days : 2;
      const today = new Date().toISOString().slice(0, 10);
      const until = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
      const [{ data: plans }, { data: tasks }] = await Promise.all([
        db.from("visit_plans").select("id, title, planned_on, visit_stops(id, target_time, status, campaign_targets(next_action, companies(id, trade_name, legal_name), establishments(id, name), assets(id, title)))").gte("planned_on", today).lte("planned_on", until).order("planned_on"),
        db.from("tasks").select("id, title, due_on, kind, finding_id, findings(statement), contacts(id, full_name)").neq("status", "done").gte("due_on", today).lte("due_on", until).order("due_on"),
      ]);
      return {
        content: track(ctx, {
          visits: (plans ?? []).map((p) => ({ title: p.title, date: p.planned_on, stops: p.visit_stops.map((s) => { const t = s.campaign_targets; return { time: s.target_time, status: s.status, next_action: t?.next_action, place: t?.companies ? { ref: ref("company", t.companies.id), name: companyName(t.companies) } : t?.establishments ? { ref: ref("establishment", t.establishments.id), name: t.establishments.name } : t?.assets ? { ref: ref("asset", t.assets.id), name: t.assets.title } : null }; }) })),
          tasks: (tasks ?? []).map((t) => ({ ref: ref("task", t.id), title: t.title, due_on: t.due_on, kind: t.kind, validates: t.finding_id ? { ref: ref("finding", t.finding_id), statement: t.findings?.statement } : null, with: t.contacts ? { ref: ref("contact", t.contacts.id), name: t.contacts.full_name } : null })),
        }),
      };
    }
    case "pending_for_team": {
      const [{ data: dec }, { data: helps }, { data: profiles }] = await Promise.all([
        db.from("decisions").select("id, question, due_on, opportunity_id").eq("status", "requested"),
        db.from("help_requests").select("kind, ask, target, due_on, status, assignee_id, finding_id").in("status", ["abierto", "en_curso"]),
        db.from("profiles").select("user_id, display_name, email"),
      ]);
      const name = (id: string | null) => profiles?.find((p) => p.user_id === id)?.display_name ?? profiles?.find((p) => p.user_id === id)?.email ?? "—";
      return {
        content: track(ctx, {
          decisions_to_vote: (dec ?? []).map((d) => ({ ref: ref("decision", d.id), question: d.question, due_on: d.due_on, opportunity: d.opportunity_id ? { ref: ref("opportunity", d.opportunity_id) } : null, note: "votan quienes aprueban decisiones" })),
          help_requests: (helps ?? []).map((h) => ({ for: name(h.assignee_id), kind: h.kind, ask: h.ask, target: h.target, due_on: h.due_on, status: h.status, case: h.finding_id ? { ref: ref("finding", h.finding_id) } : null })),
        }),
      };
    }
    case "list_members": {
      const { data } = await db.from("profiles").select("user_id, display_name, email");
      return { content: track(ctx, (data ?? []).map((p) => ({ ref: ref("member", p.user_id), name: p.display_name || p.email }))) };
    }
    case "record_field_note": {
      const text = Str.min(3).max(8000).safeParse(a.text);
      if (!text.success) return { content: "La nota está vacía.", isError: true };
      if (!ctx.workspaceId || !ctx.userId) return { content: "No se puede guardar la captura en este contexto.", isError: true };
      const here = ctx.here;
      const { data: id, error } = await db.rpc("create_capture", {
        p: {
          workspace_id: ctx.workspaceId, client_id: crypto.randomUUID(), body: text.data, captured_at: new Date().toISOString(), ai_consent: true, media: [],
          campaign_id: ctx.campaignId ?? null,
          ...(here ? { latitude: here.lat, longitude: here.lng, location_accuracy_m: here.accuracy ?? null } : {}),
        },
      });
      if (error || !id) return { content: `No se pudo guardar la captura: ${error?.message ?? "sin id"}`, isError: true };
      const captureId = id as string;
      ctx.seenRefs.add(ref("capture", captureId));
      // Se estructura en background (persona, empresa, evidencia, hipótesis, seguimiento): la respuesta no espera.
      await structureLater(db, { workspaceId: ctx.workspaceId, settings: ctx.settings, userId: ctx.userId, captureId, focus: typeof a.focus === "string" ? a.focus : undefined });
      return {
        content: JSON.stringify({
          saved: true,
          location: here ? "con la ubicación del teléfono" : "sin ubicación",
          note: "Quedó guardado el original y el Brain lo estructura en segundo plano (guarda lo seguro; lo ambiguo queda pendiente). Respondé corto qué entendiste y qué vas a hacer; no describas lo que se guardó ni pidas aprobación.",
        }),
      };
    }
    case "project_status": {
      const m = Str.regex(/^campaign:([0-9a-f-]{36})$/).safeParse(a.ref);
      if (!m.success) return { content: "Referencia inválida: usá 'campaign:uuid' (buscá el proyecto con find o campaign_overview).", isError: true };
      const id = m.data.split(":")[1];
      const since14 = since(14);
      const [{ data: c }, { data: targets }, { data: fs }, { data: caps }, { data: helps }] = await Promise.all([
        db.from("campaigns").select("id, name, kind, objective, zone, status, created_at").eq("id", id).maybeSingle(),
        db.from("campaign_targets").select("id, status, next_action, next_action_due, companies(id, trade_name, legal_name), establishments(id, name), assets(id, title, price_amount, price_currency, surface_m2), tasks(id, title, status, due_on, completed_at)").eq("campaign_id", id).limit(100),
        db.from("findings").select("id, statement, maturity, case_status, finding_assessments(created_at, summary, gaps)").eq("campaign_id", id).neq("review_status", "rechazado").limit(50),
        db.from("captures").select("id, captured_at, ai_summary, status").eq("campaign_id", id).order("captured_at", { ascending: false }).limit(10),
        db.from("help_requests").select("kind, ask, status, result, finding_id").in("status", ["abierto", "en_curso", "resuelto"]).limit(50),
      ]);
      if (!c) return { content: "No encontrado o sin acceso", isError: true };
      const findingIds = new Set((fs ?? []).map((f) => f.id));
      return {
        content: track(ctx, {
          ref: ref("campaign", id), name: c.name, kind: c.kind === "proyecto" ? "proyecto" : "misión", objective: c.objective, status: c.status, since: c.created_at,
          entities: (targets ?? []).map((t) => ({
            ref: t.companies ? ref("company", t.companies.id) : t.establishments ? ref("establishment", t.establishments.id) : t.assets ? ref("asset", t.assets.id) : null,
            name: t.companies ? companyName(t.companies) : t.establishments?.name ?? t.assets?.title,
            price: t.assets?.price_amount ? `${t.assets.price_currency} ${t.assets.price_amount}` : null,
            surface_m2: t.assets?.surface_m2 ?? null,
            status: t.status, next_action: t.next_action, next_action_due: t.next_action_due,
            done: t.tasks.filter((k) => k.status === "done").map((k) => ({ title: k.title, at: k.completed_at })),
            pending: t.tasks.filter((k) => k.status !== "done").map((k) => ({ ref: ref("task", k.id), title: k.title, due_on: k.due_on })),
          })),
          hypotheses: (fs ?? []).map((f) => {
            const as = [...f.finding_assessments].sort((x, y) => y.created_at.localeCompare(x.created_at))[0];
            return { ref: ref("finding", f.id), statement: f.statement, maturity: f.maturity, case_status: f.case_status, summary: as?.summary ?? null, gaps: ((as?.gaps ?? []) as Gap[]).map((g) => GAPS[g]?.label ?? g) };
          }),
          recent_captures: (caps ?? []).map((k) => ({ ref: ref("capture", k.id), at: k.captured_at, summary: clip(k.ai_summary, 200), status: k.status, recent: k.captured_at >= since14 })),
          help_requests: (helps ?? []).filter((h) => h.finding_id && findingIds.has(h.finding_id)),
        }),
      };
    }
    case "mission_brief": {
      const m = typeof a.ref === "string" ? Str.regex(/^campaign:([0-9a-f-]{36})$/).safeParse(a.ref) : null;
      if (m && !m.success) return { content: "Referencia inválida: usá 'campaign:uuid' o nada para la misión activa.", isError: true };
      const brief = await missionBrief(db, m?.success && !ctx.background ? m.data.split(":")[1] : ctx.missionId ?? null);
      if (!brief) return { content: "No hay una misión activa.", isError: true };
      // Primera respuesta rápida: solo lo preparado (síntesis del día + contactos para mover). El detalle, si lo piden.
      if (a.detail !== true && brief.prepared && !brief.prepared.stale) {
        // Las referencias de la síntesis vienen del Brain (verificadas al prepararla): quedan citables.
        for (const r of JSON.stringify(brief.prepared).matchAll(/"([a-z]+:[0-9a-f-]{36})"/g)) ctx.seenRefs.add(r[1]);
        return {
          content: track(ctx, {
            mission: { ref: brief.mission.ref, name: brief.mission.name, objective: brief.mission.objective, dates: brief.mission.dates, today: brief.mission.today, days_to_start: brief.mission.days_to_start, moment: brief.mission.moment, declared_context: brief.mission.declared_context, at_start: brief.mission.at_start, watching_for: brief.mission.watching_for },
            prepared: brief.prepared,
            // La historia y el estado de la misión (para poner al día a quien se suma o vuelve).
            state: await missionStateLean(db, brief.mission.ref.split(":")[1]),
            contacts_to_move: { ...brief.contacts_to_move, items: brief.contacts_to_move.items.slice(0, 8) },
            more: "Para el detalle (hipótesis, guiones AOG, activos, follow-ups, señales) llamá mission_brief con detail=true, solo si lo piden.",
          }),
        };
      }
      return { content: track(ctx, brief) };
    }
    case "aog_plan": {
      const { data: c } = ctx.missionId ? await db.from("campaigns").select("synthesis").eq("id", ctx.missionId).maybeSingle() : { data: null };
      const plan = (c?.synthesis as { aog?: { opening: string; targets: { company_ref: string; contact_ref: string; name: string; hypothesis_refs: string[] }[]; not_worth: string[]; computed_at: string } } | null)?.aog;
      if (!plan) return { content: "Todavía no hay un plan de AOG preparado: respondé con lo que sepas (research_questions con aog=true y mission_brief) y decí que se está preparando." };
      const q = typeof a.company === "string" ? fold(a.company) : null;
      const targets = q ? plan.targets.filter((t) => fold(t.name).includes(q) || q.includes(fold(t.name))) : plan.targets;
      for (const t of plan.targets) for (const r of [t.company_ref, t.contact_ref, ...t.hypothesis_refs]) if (r) ctx.seenRefs.add(r);
      return { content: JSON.stringify(q ? { found_in_plan: targets.length > 0, targets } : plan) };
    }
    case "research_questions": {
      let q = db.from("research_questions").select("id, code, kind, industry, dimension, question, next_action, source_url, question_findings(findings(id, statement))").order("code").limit(60);
      if (a.aog === true) q = q.ilike("industry", "AOG%");
      if (typeof a.kind === "string") q = q.eq("kind", a.kind as "entrevista");
      if (typeof a.query === "string" && a.query.trim()) {
        const term = `%${a.query.trim().replace(/[%_\\]/g, "\\$&").replace(/[,()]/g, " ")}%`;
        q = q.or(`question.ilike.${term},industry.ilike.${term},dimension.ilike.${term}`);
      }
      if (typeof a.finding_ref === "string") {
        const f = Str.regex(/^finding:([0-9a-f-]{36})$/).safeParse(a.finding_ref);
        if (!f.success) return { content: "Referencia inválida: usá 'finding:uuid'", isError: true };
        const { data: ids } = await db.from("question_findings").select("question_id").eq("finding_id", f.data.split(":")[1]);
        q = q.in("id", (ids ?? []).map((x) => x.question_id));
      }
      const { data } = await q;
      return {
        content: track(ctx, (data ?? []).map((r) => ({
          code: r.code, kind: r.kind, about: r.industry, topic: r.dimension, question: r.question, next_action: r.next_action, source: r.source_url,
          hypotheses: r.question_findings.flatMap((x) => (x.findings ? [{ ref: ref("finding", x.findings.id), statement: clip(x.findings.statement, 140) }] : [])),
        }))),
      };
    }
    case "signals": {
      const days = typeof a.days === "number" ? a.days : 30;
      let q = db.from("brief_signals").select("headline, summary, basis, change, happened_on, publisher, source_url, vertical, origin, company_ids, finding_ids, asset_ids, brief_stories(title)").gte("created_at", since(days)).order("happened_on", { ascending: false, nullsFirst: false }).limit(30);
      if (ctx.missionId && (a.all_missions !== true || ctx.background)) q = q.contains("campaign_ids", [ctx.missionId]);
      if (typeof a.query === "string" && a.query.trim()) {
        const term = `%${a.query.trim().replace(/[%_\\]/g, "\\$&").replace(/[,()]/g, " ")}%`;
        q = q.or(`headline.ilike.${term},summary.ilike.${term}`);
      }
      for (const [key, col] of [["company_ref", "company_ids"], ["finding_ref", "finding_ids"]] as const) {
        if (typeof a[key] !== "string") continue;
        const r = Str.regex(/^[a-z]+:([0-9a-f-]{36})$/).safeParse(a[key]);
        if (!r.success) return { content: `Referencia inválida en ${key}`, isError: true };
        q = q.contains(col, [r.data.split(":")[1]]);
      }
      const { data } = await q;
      return {
        content: track(ctx, (data ?? []).map((s) => ({
          headline: s.headline, summary: clip(s.summary, 300), basis: s.basis, change: s.change, on: s.happened_on, publisher: s.publisher, source: s.source_url, vertical: s.vertical,
          from: s.origin === "radar_sheet" ? "Radar" : s.origin === "captura" ? "captura" : "Morning Brief", story: s.brief_stories?.title ?? null,
          memory: [...s.company_ids.map((id) => ({ ref: ref("company", id) })), ...s.finding_ids.map((id) => ({ ref: ref("finding", id) })), ...s.asset_ids.map((id) => ({ ref: ref("asset", id) }))],
        }))),
      };
    }
    case "record_contact_event": {
      const input = ContactEventInput.safeParse(a);
      if (!input.success) return { content: `No pude registrarlo: ${input.error.issues.map((i) => i.message).join("; ")}`, isError: true };
      for (const r of [input.data.contact_ref, input.data.company_ref]) {
        if (r && !ctx.seenRefs.has(r)) return { content: `Antes identificá ${r} con find o get_person (no registro sobre referencias no verificadas).`, isError: true };
      }
      if (!ctx.workspaceId || !ctx.userId || !ctx.saveApplied) return { content: "No disponible en este contexto.", isError: true };
      try {
        const { summary, effects } = await applyContactEvent(db, { workspaceId: ctx.workspaceId, userId: ctx.userId, campaignId: ctx.campaignId ?? null }, input.data);
        // El home cambia en el momento: lo que era esto se resuelve y aparece lo siguiente (si se deshace, vuelve).
        const step = ctx.missionId ? await stepTaken(db, ctx.missionId, input.data, summary).catch(() => null) : null;
        await ctx.saveApplied({ action: "contact_event", payload: input.data, summary, after: { ...effects, focus_resolved: step?.resolved.map((x) => x.id) ?? [] } });
        return { content: JSON.stringify({ applied: true, summary, home: step?.resolved.length ? { resolved: step.resolved.map((x) => x.title), next: step.next?.title ?? null } : null, calendar: effects.calendar_url ? "La tarjeta de la conversación ya muestra el botón 'Agregar a Calendar': no pegues el link." : null, undo: "La persona puede deshacerlo desde la tarjeta de la conversación." }) };
      } catch (e) {
        return { content: `No pude registrarlo: ${(e as Error).message}`, isError: true };
      }
    }
    case "set_aside": {
      const r = typeof a.ref === "string" ? a.ref : "";
      if (!/^(asset|company|establishment|finding):[0-9a-f-]{36}$/.test(r)) return { content: "Necesito la referencia de lo que hay que sacar (asset, company, establishment o finding).", isError: true };
      if (!ctx.seenRefs.has(r)) return { content: `Antes identificá ${r} (find o get_record).`, isError: true };
      if (!ctx.workspaceId || !ctx.missionId || !ctx.saveApplied) return { content: "No disponible en este contexto.", isError: true };
      const reason = typeof a.reason === "string" && a.reason.trim() ? a.reason.trim().slice(0, 300) : "Ya no importa";
      try {
        const { summary, effects } = await setAside(db, { workspaceId: ctx.workspaceId, missionId: ctx.missionId }, r, reason);
        await ctx.saveApplied({ action: "set_aside", payload: { ref: r, reason }, summary, after: effects });
        ctx.onFocusChange?.();
        return { content: JSON.stringify({ applied: true, summary, note: "Confirmá en una línea que ya no aparece (se puede deshacer desde la tarjeta)." }) };
      } catch (e) {
        return { content: `No pude sacarlo: ${(e as Error).message}`, isError: true };
      }
    }
    case "mission_people": {
      if (!ctx.missionId) return { content: "No hay una misión de trabajo.", isError: true };
      const { missionPeople } = await import("@/server/surface");
      const all = await missionPeople(db, ctx.missionId);
      const q = typeof a.query === "string" && a.query.trim() ? fold(a.query) : null;
      const rows = q ? all.filter((p) => fold(`${p.name} ${p.role ?? ""} ${p.links.map((l) => l.with).join(" ")}`).includes(q)) : all;
      return { content: track(ctx, { total_in_mission: all.length, shown: rows.length, people: rows.map((p) => ({ ref: ref("contact", p.id), name: p.name, role: p.role, links: p.links, counts_because: p.why })) }) };
    }
    case "watch_for": {
      if (!ctx.missionId) return { content: "No hay una misión de trabajo.", isError: true };
      const criterion = Str.min(5).max(300).safeParse(a.criterion);
      if (!criterion.success) return { content: "Decime qué tiene que aparecer para avisarte.", isError: true };
      const { addCriterion } = await import("@/server/mission/watch");
      const { data: m } = await db.from("campaigns").select("watch").eq("id", ctx.missionId).single();
      const watch = addCriterion((m?.watch ?? null) as never, { text: criterion.data, queries: Array.isArray(a.queries) ? a.queries.filter((q): q is string => typeof q === "string").slice(0, 3) : [], by: ctx.userName ?? null });
      const { error } = await db.from("campaigns").update({ watch: watch as never }).eq("id", ctx.missionId);
      if (error) return { content: `No pude dejarlo: ${error.message}`, isError: true };
      return { content: JSON.stringify({ applied: true, watching: watch.criteria?.map((c) => c.text), note: "Confirmá en una línea que lo vas a vigilar durante el día y que avisás solo si aparece algo que lo cumple." }) };
    }
    case "switch_mission": {
      const r = typeof a.mission_ref === "string" ? a.mission_ref : "";
      const id = /^campaign:[0-9a-f-]{36}$/.test(r) ? r.split(":")[1] : null;
      const { data: m } = id ? await db.from("campaigns").select("id, name, objective").eq("id", id).eq("kind", "mision").eq("status", "activa").maybeSingle() : { data: null };
      if (!m) return { content: "No encontré esa misión entre las activas.", isError: true };
      ctx.onMissionChange?.(m.id);
      return { content: JSON.stringify({ switched: true, mission: m.name, objective: m.objective }) };
    }
    case "create_mission": {
      if (!ctx.workspaceId || !ctx.userId) return { content: "No disponible en este contexto.", isError: true };
      const name = Str.min(2).max(120).safeParse(a.name);
      const objective = Str.min(5).max(600).safeParse(a.objective);
      const context = Str.min(2).max(400).safeParse(a.context);
      if (!name.success || !objective.success || !context.success) return { content: "Falta nombre, objetivo o contexto.", isError: true };
      const { createMission } = await import("@/server/mission/create");
      const r = await createMission(db, { workspaceId: ctx.workspaceId, userId: ctx.userId, slug: ctx.slug, settings: ctx.settings, draft: { name: name.data, objective: objective.data, context: context.data, zone: typeof a.zone === "string" ? a.zone : "", queries: Array.isArray(a.queries) ? a.queries.filter((q): q is string => typeof q === "string") : [], declared: Array.isArray(a.declared) ? a.declared.filter((q): q is string => typeof q === "string") : [] } });
      if (!r.ok) return { content: `No pude crearla: ${r.message}`, isError: true };
      ctx.seenRefs.add(`campaign:${r.id}`);
      ctx.onMissionChange?.(r.id);
      return { content: JSON.stringify({ created: true, ref: `campaign:${r.id}`, note: "Ya están trabajando en la misión nueva. Decí en una línea que la creaste y que estás armando un primer panorama que va a aparecer en el inicio." }) };
    }
    case "update_relationship": {
      const input = RelationshipInput.safeParse(a);
      if (!input.success) return { content: `No pude aplicarlo: ${input.error.issues.map((i) => i.message).join("; ")}`, isError: true };
      for (const r of [input.data.contact_ref, input.data.company_ref]) {
        if (!ctx.seenRefs.has(r)) return { content: `Antes identificá ${r} con find o get_person.`, isError: true };
      }
      if (!ctx.workspaceId || !ctx.userId || !ctx.saveApplied) return { content: "No disponible en este contexto.", isError: true };
      try {
        const { summary, effects } = await applyRelationship(db, { workspaceId: ctx.workspaceId, userId: ctx.userId, userName: ctx.userName ?? null, campaignId: ctx.missionId ?? ctx.campaignId ?? null }, input.data);
        await ctx.saveApplied({ action: "relationship_change", payload: input.data, summary, after: effects });
        if (ctx.missionId) await forgetMovesAbout(db, ctx.missionId, [input.data.contact_ref, input.data.company_ref]).catch(() => null);
        return { content: JSON.stringify({ applied: true, summary, next: "Seguí el trabajo: intentá encontrar a la persona nueva (memoria, web, sitio de la empresa, avisos de empleo) o el canal para pedirla, y proponé el próximo paso. No digas 'gracias por avisarme'." }) };
      } catch (e) {
        return { content: `No pude aplicarlo: ${(e as Error).message}`, isError: true };
      }
    }
    case "research_in_background": {
      const question = Str.min(5).max(2000).safeParse(a.question);
      const title = Str.min(3).max(120).safeParse(a.title);
      if (!question.success || !title.success) return { content: "Falta qué investigar (question) y cómo llamarlo (title).", isError: true };
      if (!ctx.workspaceId || !ctx.userId) return { content: "No disponible en este contexto.", isError: true };
      // Import diferido: la investigación usa el mismo motor que esta conversación.
      const { researchLater } = await import("@/server/mission/research");
      await researchLater(db, { workspaceId: ctx.workspaceId, slug: ctx.slug, userId: ctx.userId, settings: ctx.settings, question: question.data, title: title.data, here: ctx.here ?? null, place: ctx.place ?? null, missionId: ctx.missionId ?? null });
      return { content: JSON.stringify({ started: true, note: "Respondé en una o dos oraciones qué vas a mirar y que lo dejás en el inicio. No inventes resultados." }) };
    }
    case "adjust_focus": {
      if (!ctx.missionId) return { content: "No hay una misión activa con prioridades.", isError: true };
      const action = String(a.action);
      const id = typeof a.focus_id === "string" ? a.focus_id : "";
      const note = typeof a.note === "string" ? a.note.slice(0, 300) : null;
      const { focus } = await liveFocus(db, ctx.missionId);
      if (action !== "agregar" && !focus.items.some((x) => x.id === id)) return { content: `No encontré esa prioridad. Las de ahora: ${JSON.stringify(focus.items.filter((x) => x.status === "activa" || x.status === "pospuesta").map((x) => ({ focus_id: x.id, title: x.title })))}`, isError: true };
      if (action === "posponer" && !(typeof a.until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(a.until))) return { content: "Para posponer necesito el día (until YYYY-MM-DD).", isError: true };
      if (action === "agregar" && !(typeof a.title === "string" && a.title.trim())) return { content: "Para agregar necesito qué hay que hacer (title).", isError: true };
      const refs = Array.isArray(a.refs) ? a.refs.filter((r): r is string => typeof r === "string" && ctx.seenRefs.has(r)) : [];
      const c =
        action === "primero" ? { kind: "primero" as const, id }
        : action === "posponer" ? { kind: "posponer" as const, id, until: String(a.until), note }
        : action === "sacar" ? { kind: "sacar" as const, id, note }
        : action === "hecha" ? { kind: "hecha" as const, id, note }
        : { kind: "agregar" as const, id: randomUUID(), title: String(a.title).trim().slice(0, 200), why: note, refs, first: true };
      const next = await applyCorrection(db, ctx.missionId, c, ctx.userId ?? null);
      if (!next) return { content: "No pude cambiar las prioridades.", isError: true };
      ctx.onFocusChange?.();
      const { now } = await liveFocus(db, ctx.missionId, new Date(), ctx.userId);
      return { content: JSON.stringify({ applied: true, home_now: now.map((x) => x.title) }) };
    }
    case "locate": {
      const q = Str.min(2).safeParse(a.query);
      if (!q.success) return { content: "Decime qué lugar ubicar.", isError: true };
      const g = await geocode(q.data);
      return { content: g ? JSON.stringify({ ...g, source: "OpenStreetMap / Nominatim" }) : "No encontré ese lugar en el mapa." };
    }
    case "places_nearby": {
      const center = centerOf(a, ctx);
      const category = typeof a.category === "string" && a.category in PLACE_CATEGORIES ? (a.category as PlaceCategory) : null;
      const radius = typeof a.radius_m === "number" ? a.radius_m : 5000;
      const r = await placesNearby(center.point, radius, category, typeof a.query === "string" ? a.query : undefined);
      return {
        content: JSON.stringify({
          center: center.label, radius_m: radius, category: category ? PLACE_CATEGORIES[category].label : a.query ?? "comercios y servicios",
          source: r.source, error: r.error ?? null, count: r.places.length,
          places: r.places.slice(0, 40).map((p) => ({ ...p, distance: formatDistance(p.distance_m) })),
          provenance: "Canal: web / fuente externa · Base: documentado (listado público), no verificado en campo",
        }),
      };
    }
    case "memory_nearby": {
      const center = centerOf(a, ctx);
      const radius = typeof a.radius_m === "number" ? a.radius_m : 5000;
      const pts = await memoryNearby(db, ctx.slug, center.point, radius);
      return { content: track(ctx, { center: center.label, radius_m: radius, count: pts.length, items: pts.slice(0, 60).map((p) => ({ ref: p.ref, kind: p.kind, name: p.name, distance: formatDistance(p.distance_m), detail: p.detail })) }) };
    }
    case "show_map": {
      const center = centerOf(a, ctx);
      const params = new URLSearchParams({ lat: String(center.point.lat), lng: String(center.point.lng), r: String(typeof a.radius_m === "number" ? a.radius_m : 5000) });
      if (typeof a.category === "string" && a.category in PLACE_CATEGORIES) params.set("cat", a.category);
      const href = `${base}/mapa?${params}`;
      ctx.navigate?.(href);
      return { content: `Listo: se abre el mapa (${href}).` };
    }
    case "open_page": {
      const target = String(a.target ?? "").trim();
      const q = typeof a.query === "string" && a.query.trim() ? `?q=${encodeURIComponent(a.query.trim())}` : "";
      const views: Record<string, string> = {
        hoy: base, ejecutiva: base, red: `${base}/explorar`, personas: `${base}/explorar/personas${q}`, evidencia: `${base}/explorar/evidencia${q}`, calidad: `${base}/explorar/calidad`,
        actividades: `${base}/explorar/actividades`, capturas: `${base}/capturas`, sin_identificar: `${base}/explorar/sin-identificar`, empresas: `${base}/explorar/registros${q}`,
        mapa: `${base}/mapa`, proyectos: `${base}/explorar`,
      };
      let href: string | null = views[target] ?? null;
      const m = target.match(/^([a-z]+):([0-9a-f-]{36})$/);
      if (m) {
        if (!ctx.seenRefs.has(target)) return { content: "Esa referencia no salió de ninguna consulta: buscala primero.", isError: true };
        const [, t, id] = m;
        href = t === "company" || t === "establishment" || t === "asset" ? `${base}/e/${t}/${id}` : t === "contact" ? `${base}/explorar/personas/${id}` : t === "finding" ? `${base}/hallazgos/${id}` : t === "capture" ? `${base}/capturas/${id}` : t === "opportunity" ? `${base}/oportunidades/o/${id}` : t === "campaign" ? `${base}/explorar/c/${id}` : null;
      }
      if (!href) return { content: `No sé abrir '${target}'.`, isError: true };
      ctx.navigate?.(href);
      return { content: `Listo: se abre ${href} para el usuario.` };
    }
    default:
      return { content: `Herramienta desconocida: ${name}`, isError: true };
  }
}

async function missionStateLean(db: ToolContext["db"], campaignId: string) {
  const { data } = await db.from("campaigns").select("synthesis").eq("id", campaignId).maybeSingle();
  const st = (data?.synthesis as { state?: Record<string, unknown> } | null)?.state;
  if (!st) return null;
  const pick = (k: string) => st[k] ?? null;
  return { story: pick("story"), searching: pick("searching"), since_start: pick("since_start"), unknowns: pick("unknowns"), next_days: pick("next_days"), you_can_help: pick("you_can_help"), fronts: Array.isArray(st.fronts) ? (st.fronts as { name: string; believe: string; know: string }[]).map((f) => ({ name: f.name, believe: f.believe, know: f.know })) : null };
}
