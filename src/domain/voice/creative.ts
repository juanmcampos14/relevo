// Creatividad común de Voice of Añelo: la MISMA imagen para los anuncios A y B (solo cambia el texto del
// anuncio). Sin botón dibujado (Meta muestra su CTA), sin personas ficticias ni testimonios.
// draft=true agrega la leyenda de borrador; la pieza final se genera con draft=false al aprobarla.

export type CreativeFormat = "feed" | "story";

export function voiceCreativeSvg(format: CreativeFormat, draft: boolean): string {
  const w = 1080;
  const h = format === "feed" ? 1350 : 1920;
  const top = format === "feed" ? 0 : 285; // story: zona segura arriba y abajo
  const y = (n: number) => top + n;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<rect width="${w}" height="${h}" fill="#102C32"/>
<rect x="92" y="${y(142)}" width="90" height="10" fill="#C8E277"/>
<text x="92" y="${y(230)}" font-family="Arial,Helvetica,sans-serif" font-size="38" font-weight="bold" fill="#C8E277">RELEVO</text>
<text x="92" y="${y(290)}" font-family="Arial,Helvetica,sans-serif" font-size="27" fill="#D4E4E3">RELEVAMIENTO PRIVADO · AÑELO</text>
<text font-family="Arial,Helvetica,sans-serif" font-size="84" font-weight="bold" fill="#FFFFFF"><tspan x="92" y="${y(560)}">Voice</tspan><tspan x="92" y="${y(665)}">of Añelo</tspan></text>
<text x="92" y="${y(800)}" font-family="Arial,Helvetica,sans-serif" font-size="34" fill="#D4E4E3">Comida · Descanso · Traslados · Servicios</text>
<rect x="92" y="${y(880)}" width="896" height="2" fill="#2D5A60"/>
<text x="92" y="${y(960)}" font-family="Arial,Helvetica,sans-serif" font-size="28" fill="#D4E4E3">Experiencias reales de quienes viven y trabajan ahí.</text>
<text x="92" y="${y(1010)}" font-family="Arial,Helvetica,sans-serif" font-size="28" fill="#D4E4E3">Participación voluntaria · sin datos de contacto.</text>
${draft ? `<text x="92" y="${y(1186)}" font-family="Arial,Helvetica,sans-serif" font-size="24" fill="#91ADAD">BORRADOR PARA REVISIÓN · NO PUBLICADO</text>` : ""}
</svg>`;
}

/** URL de destino de cada anuncio: parámetros dinámicos de Meta + variante fija (sirve aunque falten macros). */
export function adDestinationUrl(base: string, variant: string) {
  return `${base}?utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.id}}&utm_content={{ad.id}}&cid={{campaign.id}}&asid={{adset.id}}&aid={{ad.id}}&pl={{placement}}&src={{site_source_name}}&v=${variant}`;
}
