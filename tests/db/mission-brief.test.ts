// Misión como contexto: el análisis de una hipótesis suma su capa de discovery (qué creemos, nivel de
// evidencia, quién puede ayudar, con ids verificados) y el mission brief trae en una llamada lo que el
// Brain sabe de la misión. IA simulada; RLS real con un usuario owner.
import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { assessFinding } from "@/server/findings/assess";
import { missionBrief } from "@/server/ai/mission";
import { cleanup, createWorkspace, newPool } from "./harness";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const pool = newPool();
const admin = createClient<Database>(URL, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
const email = `tano-m-${randomUUID().slice(0, 8)}@test.local`;
const password = randomUUID();
let ws: string, userId: string, db: SupabaseClient<Database>, mission: string, finding: string, company: string, contact: string, question: string, evidence: string, signal: string, buyer: string;
const prompts: string[] = [];

const fakeClient = () =>
  ({
    beta: {
      messages: {
        parse: async (req: { messages: { content: string }[] }) => {
          prompts.push(req.messages[0].content);
          return {
            stop_reason: "end_turn",
            usage: { input_tokens: 2000, output_tokens: 600 },
            parsed_output: {
              summary: "Solo diseño y una declaración relacionada.",
              dimensions: [{ key: "problema", status: "creido", summary: "La vacancia rota.", evidence_ids: [] }],
              next_validations: [{ title: "Hablar con el operador", why: "Nadie lo validó.", gap: "evidencia_insuficiente", who: "Operador" }],
              economics: [{ variable: "volumen", value: "120 camas publicadas por el hotel", basis: "declarado", formula: null, evidence_ids: [`evidence:${evidence}`] }],
              discovery: {
                belief: "La rotación pesa más que el inventario.",
                why: "Un operador declaró ocupación alta; el resto es diseño.",
                evidence_level: "media",
                evidence_summary: "Una declaración relacionada.",
                evidence_refs: [`evidence:${evidence}`, "evidence:00000000-0000-0000-0000-000000000000"],
                signal_refs: [`signal:${signal}`],
                question_refs: [`question:${question}`],
                who_can_help: [
                  { ref: `contact:${contact}`, purpose: "inteligencia", why: "Opera camas", ask: "¿Cuánto dura una asignación?" },
                  { ref: `contact:${buyer}`, purpose: "vender_crear", why: "Compra camas para cuadrillas", ask: "¿Cuántas camas pagan y cuántas usan?" },
                ],
              },
            },
          };
        },
      },
    },
  }) as unknown as Anthropic;

beforeAll(async () => {
  ws = await createWorkspace(pool, "Misión");
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  userId = data.user.id;
  await pool.query(`insert into memberships (workspace_id, user_id, role, can_approve_decisions) values ($1, $2, 'owner', true)`, [ws, userId]);
  const q = async (sql: string, p: unknown[]) => (await pool.query(sql, p)).rows[0].id as string;
  mission = await q(`insert into campaigns (workspace_id, name, kind, status, starts_on, ends_on) values ($1, 'Añelo — Discovery', 'mision', 'activa', '2026-10-16', '2026-10-26') returning id`, [ws]);
  const src = await q(`insert into sources (workspace_id, kind, title) values ($1, 'crm', 'CRM') returning id`, [ws]);
  company = await q(`insert into companies (workspace_id, trade_name, sector) values ($1, 'Hotel Prueba', 'Alojamiento') returning id`, [ws]);
  contact = await q(`insert into contacts (workspace_id, full_name, role_title, outreach_draft) values ($1, 'Martín Prueba', 'Encargado', 'Hola Martín…') returning id`, [ws]);
  await pool.query(`insert into contact_links (workspace_id, contact_id, company_id) values ($1, $2, $3)`, [ws, contact, company]);
  await pool.query(`insert into campaign_targets (workspace_id, campaign_id, company_id, priority, purpose) values ($1, $2, $3, 1, 'comprar_asociar')`, [ws, mission, company]);
  const op = await q(`insert into companies (workspace_id, trade_name, sector) values ($1, 'Operadora Prueba', 'Comprador corporativo') returning id`, [ws]);
  buyer = await q(`insert into contacts (workspace_id, full_name, role_title) values ($1, 'Ana Compras', 'Gerente de Compras') returning id`, [ws]);
  await pool.query(`insert into contact_links (workspace_id, contact_id, company_id) values ($1, $2, $3)`, [ws, buyer, op]);
  finding = await q(`insert into findings (workspace_id, source_id, kind, statement, maturity, dedup_key) values ($1, $2, 'necesidad', 'Rotación y asignación de vacancia pesan más que inventario total', 'hipotesis', 'crm:H-VA-09') returning id`, [ws, src]);
  await pool.query(`insert into finding_companies (workspace_id, finding_id, company_id) values ($1, $2, $3)`, [ws, finding, company]);
  question = await q(`insert into research_questions (workspace_id, code, kind, industry, question, origin) values ($1, 'VO-Q04', 'entrevista', 'AOG · Hotel Prueba', '¿Cuánto dura una asignación de cama?', 'crm') returning id`, [ws]);
  await pool.query(`insert into question_findings (workspace_id, question_id, finding_id) values ($1, $2, $3)`, [ws, question, finding]);
  evidence = await q(`insert into evidence (workspace_id, source_id, company_id, statement, evidence_type, origin_kind, verification_status) values ($1, $2, $3, 'El encargado declaró 80% de ocupación', 'dato', 'crm_import', 'unverified') returning id`, [ws, src, company]);
  signal = await q(`insert into brief_signals (workspace_id, origin, basis, signal_type, section, vertical, headline, change, relevance, position, finding_ids, happened_on) values ($1, 'radar_sheet', 'hecho', 'demanda', 'anelo', 'Alojamiento + campamentos', 'Nueva base con 120 personas', 'nuevo', 'media', 0, array[$2]::uuid[], '2026-09-30') returning id`, [ws, finding]);
  db = createClient<Database>(URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { error: e } = await db.auth.signInWithPassword({ email, password });
  if (e) throw e;
});
afterAll(async () => {
  await cleanup(pool, [ws], [{ id: userId, email }]);
  await pool.end();
});

describe("misión como contexto", () => {
  it("el análisis ve empresas, gente, evidencia relacionada, preguntas y señales, y guarda el discovery verificado", async () => {
    const res = await assessFinding(db, { workspaceId: ws, settings: { ai_processing_consent: true }, userId, findingId: finding, client: fakeClient(), today: "2026-10-01" });
    expect(res.ok).toBe(true);
    const prompt = prompts.at(-1)!;
    for (const s of [`company:${company}`, `contact:${contact}`, "tiene borrador de primer contacto", "propósito para la misión: comprar_asociar", `evidence:${evidence}`, `question:${question}`, `signal:${signal}`, "LADO DEMANDA", `contact:${buyer} · Ana Compras (Gerente de Compras)`]) expect(prompt).toContain(s);
    const { data } = await db.from("finding_assessments").select("discovery, economics").eq("finding_id", finding).single();
    // El propósito definido en el objetivo de la misión manda sobre lo que diga el modelo; el comprador entra del lado demanda.
    expect(data!.discovery).toMatchObject({
      evidence_level: "media",
      evidence_refs: [`evidence:${evidence}`],
      who_can_help: [
        { ref: `contact:${contact}`, name: "Martín Prueba · Hotel Prueba", purpose: "comprar_asociar" },
        { ref: `contact:${buyer}`, name: "Ana Compras · Operadora Prueba", purpose: "vender_crear" },
      ],
    });
    // Lo publicado por la propia empresa queda DECLARADO con su evidencia, no estimado.
    expect(data!.economics).toEqual([expect.objectContaining({ variable: "volumen", basis: "declarado", evidence_ids: [evidence] })]);
  });

  it("el mission brief trae misión, momento, hipótesis con lo que creemos y quién ayuda, outreach listo y guiones AOG", async () => {
    const b = (await missionBrief(db, null, new Date("2026-10-01T15:00:00Z")))!;
    expect(b.mission).toMatchObject({ name: "Añelo — Discovery", moment: "preparación", days_to_start: 15 });
    expect(b.hypotheses).toMatchObject({ total: 1, analyzed: 1 });
    expect(b.hypotheses.items[0]).toMatchObject({ code: "H-VA-09", evidence_level: "media", belief: "La rotación pesa más que el inventario.", companies: 1, questions: 1 });
    expect(b.hypotheses.items[0].who_can_help[0]).toMatchObject({ name: "Martín Prueba · Hotel Prueba", purpose: "Comprar / asociarnos" });
    expect(b.outreach_ready).toEqual([expect.objectContaining({ name: "Martín Prueba", company: expect.objectContaining({ name: "Hotel Prueba" }) })]);
    expect(b.targets).toMatchObject({ total: 1, with_purpose: 1 });
    expect(b.aog_scripts[0]).toMatchObject({ code: "VO-Q04", entity: "Hotel Prueba" });
  });
});
