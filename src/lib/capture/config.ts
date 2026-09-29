// Lo mínimo para capturar sin señal. No incluye datos del workspace, solo identificadores.
export type CaptureConfig = { slug: string; workspaceId: string; campaignId: string | null; aiAllowed: boolean; canEdit: boolean };

export const CAPTURE_CONFIG_KEY = "relevo:capture-config";

export function readCaptureConfig(raw: string | null): CaptureConfig | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as Partial<CaptureConfig>;
    if (typeof c.slug !== "string" || typeof c.workspaceId !== "string") return null;
    return { slug: c.slug, workspaceId: c.workspaceId, campaignId: c.campaignId ?? null, aiAllowed: c.aiAllowed === true, canEdit: c.canEdit === true };
  } catch {
    return null;
  }
}
