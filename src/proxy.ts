import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { getUserRole } from "@/lib/auth/roles";
import { DEMO_COOKIE, isDemoMode } from "@/lib/demo/mode";
import { cleanEnv } from "@/lib/clean-env";
import { accountByRole } from "@/lib/demo/users";
import { DEMO_LEGAL_COOKIE, LEGAL_BUNDLE_VERSION } from "@/lib/legal/documents";
import { dataBackend, sessionUser } from "@/lib/data";

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
    cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_URL),
    cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
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

/** Mismas reglas que supabaseProxy, con el usuario que deja la sesión de Better Auth. */
function guardPortal(req: NextRequest, user: Pick<User, "app_metadata"> | null, res: NextResponse): NextResponse {
  if (!user) return toLogin(req);
  const role = getUserRole(user);
  const portal = portalOf(req.nextUrl.pathname);
  if (portal && portal !== `/${role}`) {
    return NextResponse.redirect(new URL(HOME_BY_ROLE[role], req.url));
  }
  if (user.app_metadata?.legal_version !== LEGAL_BUNDLE_VERSION) return toLegal(req);
  return res;
}

// Etapa 3 del corte (DATA_BACKEND=d1): sesión de Better Auth en D1.
async function d1Proxy(req: NextRequest): Promise<NextResponse> {
  const user = await sessionUser(req.headers);
  return guardPortal(req, user, NextResponse.next());
}

export async function proxy(req: NextRequest): Promise<NextResponse> {
  if (isDemoMode()) return demoProxy(req);
  return dataBackend() === "d1" ? d1Proxy(req) : supabaseProxy(req);
}

export const config = {
  matcher: ["/admin/:path*", "/cliente/:path*", "/repartidor/:path*"],
};
