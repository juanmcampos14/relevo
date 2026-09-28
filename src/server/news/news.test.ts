import { describe, expect, it } from "vitest";
import { mentions, cleanTitle } from "@/domain/news";
import { feedUrl, parseFeed } from "./google-news";

const XML = `<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>Chevron quiere triplicar su producción en Vaca Muerta - Clarín</title>
<link>https://news.google.com/rss/articles/AAA</link><guid isPermaLink="false">AAA</guid>
<pubDate>Sun, 27 Sep 2026 12:00:28 GMT</pubDate>
<description>&lt;a href="x"&gt;Chevron quiere triplicar su producción en Vaca Muerta&lt;/a&gt;&amp;nbsp;Clarín</description>
<source url="https://www.clarin.com">Clarín</source></item>
<item><title>El dólar hoy - Ámbito</title><link>https://news.google.com/rss/articles/BBB</link><guid>BBB</guid>
<pubDate>no es fecha</pubDate><source url="https://ambito.com">Ámbito</source></item>
<item><title>Sin link</title></item>
</channel></rss>`;

describe("radar de noticias", () => {
  it("parsea el RSS: título limpio, medio, fecha y descarta ítems inválidos", () => {
    const items = parseFeed(XML);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      externalId: "AAA",
      title: "Chevron quiere triplicar su producción en Vaca Muerta",
      sourceName: "Clarín",
      sourceUrl: "https://www.clarin.com",
      publishedAt: "2026-09-27T12:00:28.000Z",
      snippet: null, // la descripción repetía el título
    });
    expect(items[1].publishedAt).toBeNull();
  });

  it("el filtro exige que la nota nombre el término (sin importar mayúsculas ni acentos)", () => {
    expect(mentions({ title: "Récord en VACA MUERTA", snippet: null }, ["vaca muerta"])).toBe(true);
    expect(mentions({ title: "El dólar hoy", snippet: "mercados" }, ["vaca muerta"])).toBe(false);
  });

  it("arma la búsqueda en español de Argentina con ventana de días", () => {
    const u = new URL(feedUrl('"Vaca Muerta"', 7));
    expect(u.searchParams.get("q")).toBe('"Vaca Muerta" when:7d');
    expect(u.searchParams.get("ceid")).toBe("AR:es-419");
    expect(cleanTitle("Nota - Medio", "Medio")).toBe("Nota");
  });
});
