import { describe, expect, it } from "vitest";
import { baseMime, isEmptyCapture, mediaPath, retryDelayMs, syncOne, type CaptureApi, type OutboxItem } from "./capture";

const item: OutboxItem = {
  clientId: "c1",
  workspaceId: "w1",
  body: "nota",
  capturedAt: "2026-10-17T12:00:00.000Z",
  location: null,
  aiConsent: false,
  campaignId: null,
  media: [
    { id: "m1", kind: "photo", mimeType: "image/jpeg", data: new ArrayBuffer(3) },
    { id: "m2", kind: "audio", mimeType: "audio/webm;codecs=opus", data: new ArrayBuffer(5), durationMs: 2000 },
  ],
  state: "pendiente",
  attempts: 0,
};

function fakeApi(over: Partial<CaptureApi> = {}) {
  const calls: string[] = [];
  const api: CaptureApi = {
    upload: async (path, _d, type) => {
      calls.push(`upload ${path} ${type}`);
      return { error: null };
    },
    createCapture: async (p) => {
      calls.push(`create ${p.client_id} ${p.media.length}`);
      return { error: null };
    },
    ...over,
  };
  return { api, calls };
}

describe("captura: reglas puras", () => {
  it("ruta determinística por workspace/captura/archivo y tipo sin parámetros", () => {
    expect(mediaPath("w1", "c1", item.media[1])).toBe("w1/c1/m2.webm");
    expect(baseMime("audio/webm;codecs=opus")).toBe("audio/webm");
  });

  it("vacía = sin texto, sin ubicación y sin archivos", () => {
    expect(isEmptyCapture({ body: "  ", location: null, media: [] })).toBe(true);
    expect(isEmptyCapture({ body: "", location: { lat: 1, lng: 1, accuracy: null }, media: [] })).toBe(false);
  });

  it("espera entre reintentos creciente con techo", () => {
    expect(retryDelayMs(1)).toBe(5_000);
    expect(retryDelayMs(2)).toBe(15_000);
    expect(retryDelayMs(10)).toBe(300_000);
  });
});

describe("syncOne", () => {
  it("sube primero los archivos y después crea la captura", async () => {
    const { api, calls } = fakeApi();
    expect(await syncOne(item, api)).toEqual({ ok: true, id: null });
    expect(calls).toEqual(["upload w1/c1/m1.jpg image/jpeg", "upload w1/c1/m2.webm audio/webm", "create c1 2"]);
  });

  it("un archivo que ya estaba subido (reintento) cuenta como éxito", async () => {
    const { api } = fakeApi({ upload: async () => ({ error: { statusCode: "409", message: "The resource already exists" } }) });
    expect(await syncOne(item, api)).toEqual({ ok: true, id: null });
  });

  it("sin señal: reintentar y no crear la captura a medias", async () => {
    const { api, calls } = fakeApi({
      upload: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    const res = await syncOne(item, api);
    expect(res).toMatchObject({ ok: false, retry: true });
    expect(calls.some((c) => c.startsWith("create"))).toBe(false);
  });

  it("permiso denegado: error visible, sin reintento automático", async () => {
    const { api } = fakeApi({ createCapture: async () => ({ error: { code: "42501", message: "row-level security" } }) });
    expect(await syncOne(item, api)).toMatchObject({ ok: false, retry: false });
  });
});
