/** Identificador del deploy con el que se armó este código (inyectado en build; "dev" en local). */
export const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";
/** Commit corto, visible en la app: permite confirmar en una prueba qué versión está corriendo. */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "local";
