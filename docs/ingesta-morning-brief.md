# Ingesta del Morning Brief → RELEVO OS

Cada ítem del Morning Brief entra como **hallazgo pendiente de revisión** (origen `research_externo`,
verificación `fuente_publica_sin_verificar`) con su fuente (URL, medio, fecha). **Nunca crea oportunidades**:
un humano revisa, aprueba y, si corresponde, propone una candidata.

## Opción A — API (automatizada)

1. En RELEVO OS → **Integraciones** (owner/admin) → *Crear token*. Se muestra una sola vez; en la base queda solo su hash.
2. Enviar:

```
POST https://relevo-juan-campos.vercel.app/api/ingest/findings
Authorization: Bearer rlv_…
Content-Type: application/json
```

```json
{
  "source_system": "morning-brief",
  "items": [
    {
      "url": "https://medio.example/nota",
      "title": "Título de la nota",
      "publisher": "Medio",
      "published_at": "2026-09-28",
      "statement": "Qué dice la fuente, en una afirmación concreta",
      "kind": "senal_de_mercado",
      "evidence": "Cita textual (opcional)",
      "analysis": "Por qué importa para RELEVO (opcional)",
      "topic": "inmuebles",
      "entity_hint": "Empresa o lugar mencionado (opcional)"
    }
  ]
}
```

- Obligatorios: `url`, `title`, `statement`. Máximo 50 ítems y 512 KB por pedido.
- `kind`: `hecho_declarado`, `observacion`, `necesidad`, `riesgo`, `pregunta`, `senal_de_mercado` (default), `oferta_publicada`, `accion_propuesta`.
- Respuesta: `{ received, created, duplicates, rejected: [{index, error}], finding_ids }` — 201 si creó algo, 200 si todo era duplicado.
- **Idempotente**: misma URL canónica (sin `utm_*`, sin `#`, sin `www.`) + misma afirmación = mismo hallazgo. Reenviar un lote no duplica.
- 401 sin token / token revocado; 400 JSON inválido o fuera de formato.

## Opción B — Manual

Integraciones → *Importar un lote a mano*: pegar el mismo JSON (o directamente el array de `items`).

## Qué NO hace (todavía)

- No vincula automáticamente `entity_hint` a empresas o activos (evita adivinar); queda guardado en `ingest_meta` para la revisión.
- No lee Google Drive / Sheets (P2: OAuth).
