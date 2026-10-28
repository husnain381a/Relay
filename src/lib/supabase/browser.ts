"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requirePublicEnv } from "@/lib/env";

let client: SupabaseClient | undefined;
export function getBrowserClient(): SupabaseClient {
  if (!client) {
    const env = requirePublicEnv();
    client = createBrowserClient(env.supabaseUrl, env.supabasePublishableKey, {
      realtime: { params: { eventsPerSecond: 10 } },
    });
  }
  return client;
}
