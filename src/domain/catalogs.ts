// Catálogos únicos del producto (espejo de los CHECK de la base) con etiquetas en español.
// Si cambia un catálogo, cambia también la migración correspondiente.

function catalog<const T extends Record<string, string>>(labels: T) {
  const values = Object.keys(labels) as [keyof T & string, ...(keyof T & string)[]];
  return { labels, values, label: (v: string | null | undefined) => (v ? (labels as Record<string, string>)[v] ?? v : "—") };
}

// Nivel de verificación (docs/04-modelo-canonico.md §3). "Demo" es la marca is_demo;
// "declarado por contacto" es un origen, no un estado.
export const verificationStatus = catalog({
  unverified: "Sin verificar",
  partially_verified: "Parcialmente verificado",
  publicly_verified: "Verificado públicamente",
  field_verified: "Verificado en campo",
  contradicted: "Contradicho",
  stale: "Desactualizado",
});

export const evidenceOrigin = catalog({
  field: "Campo",
  interview: "Entrevista",
  conversation: "Conversación",
  website: "Sitio web",
  public_registry: "Registro público",
  press: "Prensa",
  aog: "AOG",
  crm_import: "CRM (Sheets)",
  email: "Email",
  manual: "Carga manual",
  ai_research: "Investigación IA",
});

export const evidenceType = catalog({
  dato: "Dato",
  declaracion: "Declaración",
  observacion: "Observación",
  precio: "Precio",
  capacidad: "Capacidad operativa",
  contacto: "Dato de contacto",
  propiedad: "Propiedad",
  documento: "Documento",
  publicacion: "Publicación",
  otro: "Otro",
});

/** Días hasta revalidar por tipo de evidencia. P0: 30 para todos (Tano, 29/09); el modelo ya separa por tipo. */
export const freshnessDays: Record<(typeof evidenceType.values)[number], number> = {
  dato: 30, declaracion: 30, observacion: 30, precio: 30, capacidad: 30,
  contacto: 30, propiedad: 30, documento: 30, publicacion: 30, otro: 30,
};

export const evidenceStance = catalog({
  supports: "A favor",
  contradicts: "En contra",
  contextual: "Contexto",
});

export const assetPartyRole = catalog({
  propietario: "Propietario",
  operador: "Operador",
  intermediario: "Intermediario",
  administrador: "Administrador",
  potencial_comprador: "Potencial comprador",
  potencial_socio: "Potencial socio",
});

export const contactKind = catalog({
  persona: "Persona",
  canal_institucional: "Canal institucional",
});

export const campaignStatus = catalog({
  borrador: "Borrador",
  activa: "Activa",
  pausada: "Pausada",
  finalizada: "Finalizada",
});

// Etapas del objetivo en la misión: idioma del CRM (aprobado 29/09).
export const targetStatus = catalog({
  investigacion: "Investigación",
  calificacion: "Calificación",
  contacto_pendiente: "Contacto pendiente",
  contactado: "Contactado",
  reunion: "Reunión",
  diagnostico: "Diagnóstico",
  oportunidad: "Oportunidad",
  descartado: "Descartado",
});

export const entityKind = catalog({
  company: "Empresa",
  establishment: "Establecimiento",
  asset: "Activo",
});

export const companyKind = catalog({
  operador: "Operador",
  cliente_potencial: "Cliente potencial",
  proveedor: "Proveedor",
  socio_potencial: "Socio potencial",
  competidor: "Competidor",
  inversor_potencial: "Inversor potencial",
  asesor: "Asesor",
  otro: "Otro",
});

export const assetKind = catalog({
  inmueble: "Inmueble",
  terreno: "Terreno",
  local: "Local",
  fondo_de_comercio: "Fondo de comercio",
  otro: "Otro",
});

export const assetOperation = catalog({
  venta: "Venta",
  alquiler: "Alquiler",
  asociacion: "Asociación",
  desconocida: "Desconocida",
});

export const addressStatus = catalog({
  sin_direccion: "Sin dirección",
  no_verificada: "Dirección no verificada",
  verificada: "Dirección verificada",
});

export const sourceKind = catalog({
  url: "Página web",
  documento: "Documento",
  contacto: "Dicho por un contacto",
  observacion: "Observación directa",
  drive: "Archivo en Drive",
  research_externo: "Research externo",
});

export const contactPermission = catalog({
  sin_definir: "Sin definir",
  permitido: "Se puede contactar",
  solo_via_intro: "Solo vía introducción",
  no_contactar: "No contactar",
});

export const contactRelation = catalog({
  dueno: "Dueño/a",
  encargado: "Encargado/a",
  empleado: "Empleado/a",
  referidor: "Referidor/a",
  comprador: "Comprador/a",
  vendedor: "Vendedor/a",
  corredor: "Corredor/a",
  asesor: "Asesor/a",
  otro: "Otro",
});

export const stopStatus = catalog({
  programada: "Programada",
  confirmada: "Confirmada",
  realizada: "Realizada",
  no_realizada: "No realizada",
});

export const consentStatus = catalog({
  no_registrado: "No registrado",
  otorgado: "Otorgado",
  denegado: "Denegado",
  no_aplica: "No aplica",
});

export const role = catalog({
  owner: "Owner",
  admin: "Admin",
  member: "Miembro",
  viewer: "Solo lectura",
});

/** Todo estado distinto de "sin verificar" necesita una fuente registrada. */
export const statusesRequiringSource: ReadonlySet<string> = new Set(verificationStatus.values.filter((v) => v !== "unverified"));

// --- Corte B -----------------------------------------------------------------------
export const findingKind = catalog({
  hecho_declarado: "Hecho declarado",
  observacion: "Observación",
  necesidad: "Necesidad",
  riesgo: "Riesgo",
  pregunta: "Pregunta abierta",
  senal_de_mercado: "Señal de mercado",
  oferta_publicada: "Oferta publicada",
  accion_propuesta: "Acción propuesta",
});

export const findingOrigin = catalog({
  manual: "Carga manual",
  research_externo: "Research externo",
  ia: "IA",
});

export const reviewStatus = catalog({
  pendiente_revision: "Pendiente de revisión",
  aprobado: "Aprobado",
  rechazado: "Rechazado",
});

export const opportunityRoute = catalog({
  a_definir: "A definir",
  adquisicion: "Adquisición",
  participacion: "Participación",
  gestion: "Gestión",
  alianza: "Alianza",
  creacion_propia: "Creación propia",
});

export const opportunityStatus = catalog({
  candidata: "Candidata",
  aprobada: "Aprobada (en dealflow)",
  rechazada: "Rechazada",
});

export const dealflowStage = catalog({
  contacto_identificado: "Contacto identificado",
  primer_contacto: "Primer contacto",
  entrevista_visita: "Entrevista / visita",
  en_validacion: "En validación",
  pre_diligencia: "Pre-diligencia",
  diligencia: "Diligencia",
  propuesta_negociacion: "Propuesta / negociación",
  piloto_acuerdo: "Piloto / acuerdo",
  operacion: "Operación",
  pausada: "Pausada",
  descartada: "Descartada",
});

export const decisionStatus = catalog({
  requested: "Pendiente",
  approved: "Aprobada",
  rejected: "Rechazada",
  deferred: "Diferida",
});

export const taskStatus = catalog({
  todo: "Por hacer",
  in_progress: "En curso",
  blocked: "Bloqueada",
  done: "Hecha",
});
