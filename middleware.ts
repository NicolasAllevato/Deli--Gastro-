import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getUserRole } from "@/lib/auth/roles";

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            res.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const role = getUserRole(user);
  const { pathname } = req.nextUrl;

  // Un cliente autenticado no puede entrar al portal admin.
  if (pathname.startsWith("/admin") && role !== "admin") {
    return NextResponse.redirect(new URL("/cliente", req.url));
  }

  // El admin usa su propio portal; se lo redirige fuera del portal cliente
  // para mantener los flujos separados.
  if (pathname.startsWith("/cliente") && role === "admin") {
    return NextResponse.redirect(new URL("/admin/tablero", req.url));
  }

  return res;
}

export const config = {
  matcher: ["/admin/:path*", "/cliente/:path*"],
};
