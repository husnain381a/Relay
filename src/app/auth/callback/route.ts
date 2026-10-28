import { NextResponse, type NextRequest } from "next/server";
import { getServerClient } from "@/lib/supabase/server";
import { safeRedirect } from "@/lib/validation";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = safeRedirect(request.nextUrl.searchParams.get("next"));
  if (code) {
    const client = await getServerClient();
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  }
  const url = new URL("/", request.url);
  url.searchParams.set(
    "auth_error",
    "This sign-in link is invalid or expired. Request a new one.",
  );
  return NextResponse.redirect(url);
}
