import { supabase } from "@/lib/db/supabase";
import { sendUserDM } from "@/lib/slack/sendUserDM";
import { isInternalIpHash } from "@/lib/stats/internalIps";
import { describeEvent, formatVisitOffset } from "@/lib/notifications/eventVerbs";
import type { EngagementType } from "@/lib/stats/engagement";
import type { VisitSummaryJobPayload } from "@/lib/queue/payloads";

type EventRow = {
  type: EngagementType;
  payload: Record<string, unknown> | null;
  ip_hash: string | null;
  is_bot: boolean | null;
  created_at: string;
};

export async function processVisitSummary(payload: VisitSummaryJobPayload): Promise<void> {
  // Re-check the toggle at fire time — the rep may have flipped it off in
  // the 5 minutes since the live ping.
  const { data: prefs } = await supabase
    .from("vlad_user_preferences")
    .select("notify_visit_summary")
    .eq("user_id", payload.repEmail)
    .maybeSingle();
  if (!(prefs as { notify_visit_summary?: boolean } | null)?.notify_visit_summary) return;

  const { data: events } = await supabase
    .from("vlad_engagement_events")
    .select("type, payload, ip_hash, is_bot, created_at")
    .eq("slug", payload.slug)
    .eq("visitor_id", payload.visitorId)
    .gte("created_at", payload.visitStartedAt)
    .order("created_at", { ascending: true });

  const visitStartedAt = new Date(payload.visitStartedAt);
  const followUps = ((events ?? []) as EventRow[])
    .filter((e) => !e.is_bot)
    .filter((e) => !isInternalIpHash(e.ip_hash))
    // The triggering human_visit row appears first; everything after is a
    // follow-up. Drop visit rows so we don't summarize "they opened the
    // share" inside the reply to "they opened the share".
    .filter((e) => e.type !== "human_visit");

  let text: string;
  if (followUps.length === 0) {
    text = "No further activity in the 5-minute window.";
  } else {
    const lines = followUps.map((e) => {
      const at = formatVisitOffset(new Date(e.created_at), visitStartedAt);
      return `• ${at} — ${describeEvent(e.type, e.payload ?? {})}`;
    });
    text = `Activity in the next 5 minutes:\n${lines.join("\n")}`;
  }

  await sendUserDM({
    email: payload.repEmail,
    text,
    threadTs: payload.parentTs,
  });
}
