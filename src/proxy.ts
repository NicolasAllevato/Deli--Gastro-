import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getUserRole } from "@/lib/auth/roles";
import { DEMO_COOKIE, isDemoMode } from "@/lib/demo/mode";
import { accountByRole } from "@/lib/demo/users";
import { DEMO_LEGAL_COOKIE, LEGAL_BUNDLE_VERSION } from "@/lib/legal/documents";

const PORTAL_PREFIXES = ["/admin", "/cliente", "/repartidor"] as const;

const HOME_BY_ROLE = {
  admin: "/admin/ejecutivo",
  cliente: "/cliente",
  repartidor: "/repartidor",
} as const;

function portalOf(pathname: string) {
  return PORTAL_PREFIXES.find((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function toLogin(req: NextRequest): NextResponse {
  const url = new URL("/login", req.url);
  url.searchParams.set("redirectTo", req.nextUrl.pathname);
  return NextResponse.redirect(url);
}

/** Primer ingreso (o documentos nuevos): antes del portal hay que aceptar Términos y Privacidad. */
function toLegal(req: NextRequest): NextResponse {
  const url = new URL("/aceptar-terminos", req.url);
  url.searchParams.set("redirectTo", req.nextUrl.pathname);
  return NextResponse.redirect(url);
}

// Modo demo: la sesión es una cookie con el rol de ejemplo (sin Supabase).
function demoProxy(req: NextRequest): NextResponse {
  const account = accountByRole(req.cookies.get(DEMO_COOKIE)?.value);
  if (!account) return toLogin(req);

  const portal = portalOf(req.nextUrl.pathname);
  if (portal && portal !== `/${account.role}`) {
    return NextResponse.redirect(new URL(account.home, req.url));
  }
  if (req.cookies.get(DEMO_LEGAL_COOKIE)?.value !== LEGAL_BUNDLE_VERSION) return toLegal(req);
  return NextResponse.next();
}

// Producción/desarrollo normal: sesión de Supabase y portales separados por rol.
async function supabaseProxy(req: NextRequest): Promise<NextResponse> {
  const res = NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return toLogin(req);

  const role = getUserRole(user);
  const portal = portalOf(req.nextUrl.pathname);

  // Cada rol sólo entra a su portal; el resto lo redirige al propio.
  if (portal && portal !== `/${role}`) {
    return NextResponse.redirect(new URL(HOME_BY_ROLE[role], req.url));
  }

  // La marca la escribe solo el servidor (app_metadata) al aceptar los dos documentos.
  if (user.app_metadata?.legal_version !== LEGAL_BUNDLE_VERSION) return toLegal(req);

  return res;
}

export async function proxy(req: NextRequest): Promise<NextResponse> {
  return isDemoMode() ? demoProxy(req) : supabaseProxy(req);
}

export const config = {
  matcher: ["/admin/:path*", "/cliente/:path*", "/repartidor/:path*"],
};
