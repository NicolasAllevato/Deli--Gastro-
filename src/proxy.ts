import { NextResponse } from "next/server";

// Auth desactivada temporalmente — acceso libre a admin y cliente
export function proxy(): NextResponse {
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/cliente/:path*"],
};
