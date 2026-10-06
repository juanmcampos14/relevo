import "server-only";

import { createSign } from "node:crypto";

// Acceso de solo lectura al Sheet operativo con una cuenta de servicio de Google (el Sheet se comparte
// como lector con su email). Sin dependencias: JWT firmado con la clave de la cuenta → token → Drive API.
// Credencial: GOOGLE_SERVICE_ACCOUNT_JSON (el JSON de la clave, en Vercel; nunca en el repo).

type ServiceAccount = { client_email: string; private_key: string };

export function serviceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw) as Partial<ServiceAccount>;
    return sa.client_email && sa.private_key ? { client_email: sa.client_email, private_key: sa.private_key.replace(/\\n/g, "\n") } : null;
  } catch {
    return null;
  }
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/drive.readonly", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 600 }));
  const sign = createSign("RSA-SHA256");
  sign.update(`${head}.${claims}`);
  const jwt = `${head}.${claims}.${b64url(sign.sign(sa.private_key))}`;
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }) });
  if (!res.ok) throw new Error(`Google no dio acceso (${res.status}).`);
  return ((await res.json()) as { access_token: string }).access_token;
}

/** Cuándo cambió el Sheet por última vez (si no cambió desde la última sincronización, no se baja nada). */
export async function sheetModifiedAt(sheetId: string): Promise<string> {
  const sa = serviceAccount();
  if (!sa) throw new Error("Falta GOOGLE_SERVICE_ACCOUNT_JSON.");
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(sheetId)}?fields=modifiedTime`, { headers: { authorization: `Bearer ${await accessToken(sa)}` } });
  if (res.status === 404) throw new Error("La cuenta de servicio no ve el Sheet: compartilo como lector con su email.");
  if (!res.ok) throw new Error(`No pude leer el Sheet (${res.status}).`);
  return ((await res.json()) as { modifiedTime: string }).modifiedTime;
}

/** El Sheet entero como .xlsx (mismo formato que ya leen el importador del CRM y el del Radar). */
export async function exportSheet(sheetId: string): Promise<ArrayBuffer> {
  const sa = serviceAccount();
  if (!sa) throw new Error("Falta GOOGLE_SERVICE_ACCOUNT_JSON.");
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(sheetId)}/export?mimeType=${encodeURIComponent("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}`, { headers: { authorization: `Bearer ${await accessToken(sa)}` } });
  if (!res.ok) throw new Error(`No pude bajar el Sheet (${res.status}).`);
  return res.arrayBuffer();
}
