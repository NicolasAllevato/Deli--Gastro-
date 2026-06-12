import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Auth desactivada temporalmente — acceso libre a admin y cliente
export function proxy(_req: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/cliente/:path*"],
};
