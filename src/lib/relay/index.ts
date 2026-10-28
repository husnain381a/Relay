"use client";
import { getBrowserClient } from "@/lib/supabase/browser";
import { createRelay } from "./service";
export const relay = createRelay(getBrowserClient);
export { RelayError } from "./shared";
export type { RelayService } from "./service";
