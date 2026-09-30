import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// /api/ingest y /api/cron se autentican con token propio (no con sesión de usuario).
// /r/ y /api/r/: formularios públicos de investigación (sin sesión; validan todo en el servidor).
// /offline, /sw.js, manifest e íconos: la app instalable y el modo sin señal (sin datos privados).
const PUBLIC_PATHS = ["/login", "/auth", "/api/ingest", "/api/cron", "/api/r/", "/r/", "/offline", "/sw.js", "/manifest.webmanifest", "/icon", "/apple-icon", "/api/version"];

// Refresca la sesión en cada request y exige login fuera de las rutas públicas.
// La autorización real vive en RLS; esto solo evita renderizar páginas sin sesión.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  const isPublic = PUBLIC_PATHS.some((p) => request.nextUrl.pathname.startsWith(p));

  if (!data?.claims && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
