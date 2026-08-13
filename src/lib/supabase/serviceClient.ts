/**
 * Server-only Supabase client (service role). Bypasses RLS.
 * Never import this from a `"use client"` file. Never prefix the key
 * with NEXT_PUBLIC_ — it must not land in the browser bundle.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function getServiceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
