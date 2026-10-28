"use client";
import { z } from "zod";
import { getBrowserClient } from "@/lib/supabase/browser";
import { checkError } from "@/lib/relay/shared";
import { safeRedirect } from "@/lib/validation";

const emailInput = z.email().trim().max(254);
const passwordInput = z
  .string()
  .min(12, "Use at least 12 characters.")
  .max(128);

export async function signIn(email: string, password: string) {
  const { data, error } = await getBrowserClient().auth.signInWithPassword({
    email: emailInput.parse(email),
    password: z.string().min(1).parse(password),
  });
  checkError(error);
  return data;
}
export async function signUp(
  email: string,
  password: string,
  displayName: string,
) {
  const { data, error } = await getBrowserClient().auth.signUp({
    email: emailInput.parse(email),
    password: passwordInput.parse(password),
    options: {
      data: {
        display_name: z.string().trim().min(1).max(80).parse(displayName),
      },
      emailRedirectTo: `${window.location.origin}/auth/callback`,
    },
  });
  checkError(error);
  return data;
}
export async function signOut(scope: "global" | "local" | "others" = "local") {
  const { error } = await getBrowserClient().auth.signOut({ scope });
  checkError(error);
}
export async function requestPasswordReset(email: string) {
  const { error } = await getBrowserClient().auth.resetPasswordForEmail(
    emailInput.parse(email),
    { redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset` },
  );
  checkError(error);
}
export async function updatePassword(password: string) {
  const { error } = await getBrowserClient().auth.updateUser({
    password: passwordInput.parse(password),
  });
  checkError(error);
}
export function authDestination(next: string | null) {
  return safeRedirect(next);
}
