import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const serverKey = process.env.SUPABASE_SECRET_KEY;
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  if (
    !secret ||
    secret.length < 32 ||
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  )
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!serverKey)
    return NextResponse.json(
      { error: "Scheduled dispatch is not configured." },
      { status: 503 },
    );
  const client = createClient(publicEnv().supabaseUrl, serverKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.rpc("process_scheduled_messages");
  if (error) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "scheduled_dispatch_failed",
        code: error.code,
      }),
    );
    return NextResponse.json({ error: "Dispatch failed." }, { status: 503 });
  }
  return NextResponse.json(
    { processed: data },
    { headers: { "Cache-Control": "no-store" } },
  );
}
