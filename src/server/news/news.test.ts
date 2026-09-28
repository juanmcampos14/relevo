import { describe, expect, it } from "vitest";
import { mentions, cleanTitle, topicsOf } from "@/domain/news";
import { feedUrl, parseFeed } from "./google-news";
import { originalUrl, parseBingFeed, thumbnail } from "./bing-news";

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

  it("Añelo: palabra completa, con o sin tilde, sin falsos positivos", () => {
    expect(mentions({ title: "Nuevo puente entre Añelo y Rincón", snippet: null }, ["añelo"])).toBe(true);
    expect(mentions({ title: "AÑELO: obras en el canal", snippet: null }, ["añelo"])).toBe(true);
    expect(mentions({ title: "Anelo crece", snippet: null }, ["añelo"])).toBe(true);
    expect(mentions({ title: "Receta de canelones", snippet: null }, ["añelo"])).toBe(false);
    expect(mentions({ title: "Un anhelo cumplido", snippet: null }, ["añelo"])).toBe(false);
  });

  it("una nota puede ser de los dos temas", () => {
    expect(topicsOf({ title: "Vaca Muerta: puente clave entre Añelo y Rincón", snippet: null })).toEqual(["vaca_muerta", "anelo"]);
    expect(topicsOf({ title: "Añelo proyecta un paseo costero", snippet: null })).toEqual(["anelo"]);
    expect(topicsOf({ title: "El dólar hoy", snippet: null })).toEqual([]);
  });

  it("arma la búsqueda en español de Argentina con ventana de días", () => {
    const u = new URL(feedUrl('"Vaca Muerta"', 7));
    expect(u.searchParams.get("q")).toBe('"Vaca Muerta" when:7d');
    expect(u.searchParams.get("ceid")).toBe("AR:es-419");
    expect(cleanTitle("Nota - Medio", "Medio")).toBe("Nota");
  });

  it("Bing: URL original de la nota, miniatura HTTPS 16:9 y resumen", () => {
    const xml = `<?xml version="1.0"?><rss version="2.0" xmlns:News="x"><channel><item>
<title>Cafe Mart&#237;nez llega a Vaca Muerta</title>
<link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;url=https%3a%2f%2fwww.iprofesional.com%2fenergia%2fnota&amp;mkt=es-ar</link>
<description>Desembarca en A&#241;elo ...</description><pubDate>Mon, 28 Sep 2026 03:31:00 GMT</pubDate>
<News:Source>iProfesional</News:Source><News:Image>http://www.bing.com/th?id=ONUT.abc&amp;pid=News</News:Image></item></channel></rss>`;
    const [i] = parseBingFeed(xml);
    expect(i).toMatchObject({
      url: "https://www.iprofesional.com/energia/nota",
      externalId: "https://www.iprofesional.com/energia/nota",
      title: "Cafe Martínez llega a Vaca Muerta",
      snippet: "Desembarca en Añelo ...",
      sourceName: "iProfesional",
      sourceUrl: "https://www.iprofesional.com",
      publishedAt: "2026-09-28T03:31:00.000Z",
    });
    expect(i.imageUrl).toBe("https://www.bing.com/th?id=ONUT.abc&pid=News&w=400&h=225&c=14");
    expect(thumbnail("https://evil.example/x.jpg")).toBeNull();
    expect(originalUrl("https://www.bing.com/news/apiclick.aspx?url=javascript:alert(1)")).toBe("https://www.bing.com/news/apiclick.aspx?url=javascript:alert(1)");
  });
});
