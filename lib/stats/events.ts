import { supabase } from "@/lib/db/supabase";

export type EventType =
  | "user_active"
  | "login"
  | "recording_created"
  | "render_started"
  | "render_completed"
  | "render_failed";

export type LogEventArgs = {
  type: EventType;
  userId?: string | null;
  targetId?: string | null;
  payload?: Record<string, unknown>;
};

// Append a row to vlad_event_log. Swallows errors — logging must never break
// a user-facing flow. Safe to await or fire-and-forget via `void logEvent(...)`.
export async function logEvent(args: LogEventArgs): Promise<void> {
  try {
    const { error } = await supabase.from("vlad_event_log").insert({
      type: args.type,
      user_id: args.userId ?? null,
      target_id: args.targetId ?? null,
      payload: args.payload ?? {},
    });
    if (error) console.error(`[events] insert failed for ${args.type}:`, error.message);
  } catch (err) {
    console.error(`[events] insert threw for ${args.type}:`, err);
  }
}
