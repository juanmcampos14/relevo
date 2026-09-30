import "server-only";

// Entrega de email detrás de una interfaz: RELEVO orquesta, el proveedor solo entrega.
// Hoy Resend (API HTTP simple, idempotencia por clave); se reemplaza sin tocar el brief.

export type EmailMessage = { to: string; subject: string; html: string; text: string; idempotencyKey: string };
export type SendResult = { ok: true; messageId: string | null } | { ok: false; error: string; retryable: boolean };
export interface EmailProvider {
  name: string;
  send(msg: EmailMessage): Promise<SendResult>;
}

export function resendProvider(apiKey: string, from: string): EmailProvider {
  return {
    name: "resend",
    async send(msg) {
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "idempotency-key": msg.idempotencyKey },
          body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
          signal: AbortSignal.timeout(20_000),
        });
        const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
        if (res.ok) return { ok: true, messageId: body.id ?? null };
        return { ok: false, error: `Resend ${res.status}: ${body.message ?? body.name ?? "error"}`, retryable: res.status === 429 || res.status >= 500 };
      } catch (e) {
        return { ok: false, error: `Resend: ${(e as Error).message}`, retryable: true };
      }
    },
  };
}

/** Proveedor configurado en el entorno, o null (el brief se genera igual y el envío queda pendiente). */
export function configuredEmailProvider(): EmailProvider | null {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.BRIEF_FROM_EMAIL;
  return key && from ? resendProvider(key, from) : null;
}
