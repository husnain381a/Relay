/** Read only explicitly public fields. Never spread process.env into client code. */
export function publicEnv() {
  return {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    supabasePublishableKey:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  };
}

export function isSupabaseConfigured() {
  const env = publicEnv();
  return (
    /^https?:\/\//.test(env.supabaseUrl) &&
    env.supabasePublishableKey.length > 10
  );
}

export function requirePublicEnv() {
  if (!isSupabaseConfigured())
    throw new Error(
      "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to .env.local, then restart Relay.",
    );
  return publicEnv();
}
