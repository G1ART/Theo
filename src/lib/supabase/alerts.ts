import { supabase } from "./client";

export type DigestEventRow = {
  id: string;
  user_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
  sent_at: string | null;
};

export type DigestFrequency = "off" | "daily" | "weekly";

export type AlertPreferences = {
  id: string;
  user_id: string;
  digest_frequency: DigestFrequency;
  new_work_alerts: boolean;
  /** Liked works: exhibited, price listed, sold. The triggers read it. */
  liked_work_alerts: boolean;
  created_at: string;
  updated_at: string;
};

export type SavedInterest = {
  id: string;
  user_id: string;
  interest_type: "artist" | "medium" | "price_band" | "exhibition";
  interest_value: string;
  created_at: string;
};

export async function getAlertPreferences(): Promise<{
  data: AlertPreferences | null;
  error: unknown;
}> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { data: null, error: null };
  const { data, error } = await supabase
    .from("alert_preferences")
    .select("*")
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (error) return { data: null, error };
  return { data: data as AlertPreferences | null, error: null };
}

export async function upsertAlertPreferences(
  fields: { digest_frequency?: DigestFrequency; new_work_alerts?: boolean; liked_work_alerts?: boolean }
): Promise<{ error: unknown }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { error: new Error("Not authenticated") };

  const { error } = await supabase.from("alert_preferences").upsert(
    {
      user_id: session.user.id,
      ...fields,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  return { error };
}

export async function listSavedInterests(): Promise<{
  data: SavedInterest[];
  error: unknown;
}> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { data: [], error: null };
  const { data, error } = await supabase
    .from("saved_interests")
    .select("*")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false });
  if (error) return { data: [], error };
  return { data: (data ?? []) as SavedInterest[], error: null };
}

export async function addSavedInterest(
  interestType: SavedInterest["interest_type"],
  interestValue: string
): Promise<{ error: unknown }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { error: new Error("Not authenticated") };
  const { error } = await supabase.from("saved_interests").insert({
    user_id: session.user.id,
    interest_type: interestType,
    interest_value: interestValue.trim(),
  });
  return { error };
}

export async function removeSavedInterest(id: string): Promise<{ error: unknown }> {
  const { error } = await supabase.from("saved_interests").delete().eq("id", id);
  return { error };
}

export async function listPendingDigestEvents(
  limit = 50
): Promise<{ data: DigestEventRow[]; error: unknown }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { data: [], error: null };
  const { data, error } = await supabase
    .from("digest_events")
    .select("*")
    .eq("user_id", session.user.id)
    .is("sent_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return { data: [], error };
  return { data: (data ?? []) as DigestEventRow[], error: null };
}
