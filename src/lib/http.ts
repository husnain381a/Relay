import "server-only";
import { ZodError } from "zod";
import { NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { HttpError } from "./http-security";
export { assertSameOrigin, HttpError, readJson } from "./http-security";

export async function authenticatedClient() {
  if (!isSupabaseConfigured())
    throw new HttpError(
      503,
      "Relay’s backend is not configured. Add the Supabase environment variables and restart the server.",
    );
  const client = await getServerClient();
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user) throw new HttpError(401, "Sign in to continue.");
  return { client, user };
}
export async function api(handler: () => Promise<unknown>) {
  const requestId = crypto.randomUUID();
  const started = Date.now();
  try {
    const data = await handler();
    return NextResponse.json(
      { data, requestId },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "X-Request-ID": requestId,
        },
      },
    );
  } catch (error) {
    const dbCode =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
    const status =
      error instanceof HttpError
        ? error.status
        : error instanceof ZodError
          ? 400
          : dbCode === "42501"
            ? 403
            : dbCode === "23505"
              ? 409
              : dbCode === "P0001"
                ? 400
                : 500;
    // No tokens, cookies, body text, query params or user identifiers enter logs.
    console.error(
      JSON.stringify({
        level: "error",
        event: "api_error",
        requestId,
        status,
        code: dbCode || undefined,
        durationMs: Date.now() - started,
      }),
    );
    const message =
      error instanceof ZodError
        ? error.issues.map((issue) => issue.message).join(" ")
        : error instanceof HttpError || (status < 500 && error instanceof Error)
          ? error.message
          : "The request could not be completed. Try again or share the request ID with support.";
    return NextResponse.json(
      { error: message, requestId },
      {
        status,
        headers: {
          "Cache-Control": "private, no-store",
          "X-Request-ID": requestId,
        },
      },
    );
  }
}
