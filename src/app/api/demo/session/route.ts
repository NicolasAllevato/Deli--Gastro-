import { NextResponse } from "next/server";
import { rejectCrossOrigin } from "@/lib/auth/requireRole";
import { cookies } from "next/headers";
import { z } from "zod";
import { DEMO_COOKIE, isDemoMode } from "@/lib/demo/mode";
import { accountByCredentials, accountByRole, toDemoUser } from "@/lib/demo/users";

const loginSchema = z.object({ email: z.string().min(1), password: z.string().min(1) });

const notFound = () => NextResponse.json({ error: "No encontrado." }, { status: 404 });

/** Sesión actual del modo demo. */
export async function GET() {
  if (!isDemoMode()) return notFound();
  const cookieStore = await cookies();
  const account = accountByRole(cookieStore.get(DEMO_COOKIE)?.value);
  return NextResponse.json({ user: account ? toDemoUser(account) : null });
}

/** Inicia sesión con una de las cuentas de ejemplo. */
export async function POST(req: Request) {
  const crossOrigin = rejectCrossOrigin(req);
  if (crossOrigin) return crossOrigin;

  if (!isDemoMode()) return notFound();

  const parsed = loginSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Body inválido." }, { status: 400 });

  const account = accountByCredentials(parsed.data.email, parsed.data.password);
  if (!account) return NextResponse.json({ error: "Credenciales inválidas." }, { status: 401 });

  const cookieStore = await cookies();
  cookieStore.set(DEMO_COOKIE, account.role, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  return NextResponse.json({ ok: true, role: account.role, home: account.home });
}

/** Cierra la sesión demo. */
export async function DELETE(req: Request) {
  const crossOrigin = rejectCrossOrigin(req);
  if (crossOrigin) return crossOrigin;

  if (!isDemoMode()) return notFound();
  const cookieStore = await cookies();
  cookieStore.delete(DEMO_COOKIE);
  return NextResponse.json({ ok: true });
}
