import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { getServerClient } from "@/lib/supabase/server";
import { safeRedirect } from "@/lib/validation";

const TYPES = new Set([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]);
export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  const next = safeRedirect(
    request.nextUrl.searchParams.get("next"),
    type === "recovery" ? "/auth/reset" : "/",
  );
  if (tokenHash && type && TYPES.has(type)) {
    const client = await getServerClient();
    const { error } = await client.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as EmailOtpType,
    });
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  }
  const url = new URL("/", request.url);
  url.searchParams.set(
    "auth_error",
    "This confirmation link has expired. Request a new one.",
  );
  return NextResponse.redirect(url);
}
