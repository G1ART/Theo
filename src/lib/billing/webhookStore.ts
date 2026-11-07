import type { SupabaseClient } from "@supabase/supabase-js";

export async function claimStripeEvent(
  admin: SupabaseClient,
  eventId: string,
  eventType: string,
): Promise<"claimed" | "duplicate" | "error"> {
  const { error } = await admin.from("stripe_webhook_events").insert({
    event_id: eventId,
    event_type: eventType,
  });
  if (!error) return "claimed";
  if (error.code === "23505") return "duplicate";
  const message = (error.message ?? "").toLowerCase();
  if (message.includes("duplicate") || message.includes("unique")) return "duplicate";
  return "error";
}

export async function releaseStripeEvent(admin: SupabaseClient, eventId: string): Promise<void> {
  await admin.from("stripe_webhook_events").delete().eq("event_id", eventId);
}
