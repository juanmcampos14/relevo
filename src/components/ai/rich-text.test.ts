import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RichText } from "./rich-text";

const render = (text: string, labels = new Map()) => renderToStaticMarkup(createElement(RichText, { text, labels }));

describe("links en el texto de RELEVO", () => {
  it("[medio](url) y una URL suelta abren la página original en otra pestaña", () => {
    const html = render("Lo publicó [Río Negro](https://www.rionegro.com.ar/aog-2026) y también https://www.ambito.com/nota-123.");
    expect(html).toContain('<a href="https://www.rionegro.com.ar/aog-2026" target="_blank" rel="noopener noreferrer"');
    expect(html).toContain(">Río Negro</a>");
    expect(html).toContain('href="https://www.ambito.com/nota-123"');
  });
  it("una cita con URL externa abre la fuente, no una página de RELEVO", () => {
    const html = render("Dato [[evidence:00000000-0000-0000-0000-000000000001]]", new Map([["evidence:00000000-0000-0000-0000-000000000001", { label: "evidencia", href: "https://www.zonaprop.com.ar/aviso-1" }]]));
    expect(html).toContain('href="https://www.zonaprop.com.ar/aviso-1" target="_blank"');
  });
});
