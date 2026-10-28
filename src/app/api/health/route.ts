import { NextResponse } from "next/server";
import { isSupabaseConfigured, publicEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
export async function GET() {
  if (!isSupabaseConfigured())
    return NextResponse.json(
      { status: "setup_required", checks: { configuration: false } },
      { status: 503 },
    );
  const env = publicEnv();
  try {
    const response = await fetch(`${env.supabaseUrl}/auth/v1/health`, {
      headers: { apikey: env.supabasePublishableKey },
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Auth unavailable");
    return NextResponse.json(
      {
        status: "ok",
        checks: { configuration: true, auth: true },
        note: "Database authorization and Realtime require authenticated release smoke tests.",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { status: "degraded", checks: { configuration: true, auth: false } },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
