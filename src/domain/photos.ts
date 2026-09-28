// Fotografías libres (Unsplash License: uso comercial gratuito, sin atribución obligatoria;
// igual se acredita al autor). Verificadas como NO premium el 28/09/2026.
export type Photo = { src: string; alt: string; author: string; authorUrl: string; pageUrl: string };

const utm = "utm_source=relevo_os&utm_medium=referral";

export const PHOTOS = {
  /** Torre de perforación frente a bardas rojizas, ruta y cielo turquesa. Vertical. */
  rigBardas: {
    src: "https://images.unsplash.com/photo-1640721548496-dbf400c26dd1",
    alt: "Torre de perforación frente a bardas rojizas en un paisaje desértico",
    author: "Khaled Ali",
    authorUrl: `https://unsplash.com/@khkar?${utm}`,
    pageUrl: `https://unsplash.com/photos/e2Pmt5AzQGs?${utm}`,
  },
  /** Amanecer naranja sobre un yacimiento con bombas de extracción. Horizontal. */
  oilfieldSunrise: {
    src: "https://images.unsplash.com/photo-1773097258874-17d6446c3113",
    alt: "Amanecer sobre un yacimiento con bombas de extracción",
    author: "Aritra Roy",
    authorUrl: `https://unsplash.com/@aritraroys?${utm}`,
    pageUrl: `https://unsplash.com/photos/u11YO2-mvWA?${utm}`,
  },
  /** Yacimiento al anochecer visto desde una loma pedregosa. Horizontal. */
  oilfieldDusk: {
    src: "https://images.unsplash.com/photo-1773097259226-8d567dd1a099",
    alt: "Yacimiento petrolero al anochecer visto desde una loma",
    author: "Aritra Roy",
    authorUrl: `https://unsplash.com/@aritraroys?${utm}`,
    pageUrl: `https://unsplash.com/photos/9x5jnhfgtZM?${utm}`,
  },
} satisfies Record<string, Photo>;

/** Portada por workspace: configurable en settings.cover; si no hay, la del yacimiento. */
export function workspaceCover(settings: unknown): Photo {
  const cover = (settings as { cover?: Partial<Photo> } | null)?.cover;
  return cover?.src && cover.author ? ({ ...PHOTOS.oilfieldSunrise, ...cover } as Photo) : PHOTOS.oilfieldSunrise;
}
