import { supabase } from "@/lib/db/supabase";
import { sendUserDM } from "@/lib/slack/sendUserDM";
import { updateUserMessage } from "@/lib/slack/updateMessage";
import { isInternalIpHash } from "@/lib/stats/internalIps";
import { buildEngagementUrl } from "@/lib/notifications/engagementUrl";
import { STAT_DEFS, TRACKED_EVENT_TYPES, buildStatGridBlocks } from "@/lib/notifications/stats";
import type { EngagementType } from "@/lib/stats/engagement";

type DispatchArgs = {
  type: EngagementType;
  slug: string;
  ipHash: string;
  isBot: boolean;
};

type RenderRow = {
  user_id: string | null;
  brand: string | null;
  brand_name: string | null;
  brand_url: string | null;
};

type PrefsRow = {
  notify_visit: boolean;
  vlad_users: { first_name: string | null; last_name: string | null }[] | null;
};

type NotifRow = { slack_channel: string; slack_ts: string };

type EventRow = { type: EngagementType; ip_hash: string | null };

// vlad_renders.brand is the rep-facing display label (the same name shown
// in /tools/recordings). brand_name / brand_url are the brand the demo
// targets — fall back through them only when the render has no label.
function formatRenderName(r: RenderRow): string {
  return r.brand?.trim() || r.brand_name?.trim() || r.brand_url || "your demo";
}

function formatRepName(prefs: PrefsRow, fallback: string): string {
  const u = prefs.vlad_users?.[0] ?? null;
  const name = [u?.first_name, u?.last_name].filter(Boolean).join(" ").trim();
  return name || fallback;
}

// Slack Block Kit payload. Single markdown block contains the render
// name (as an H3 heading rendered full-width — pipe tables can't span
// columns) and the 6x2 stats table; a small actions block underneath
// holds the "View Stats" button.
export function buildPerRenderBlocks({
  renderName,
  counts,
  viewUrl,
}: {
  renderName: string;
  counts: Map<EngagementType, number>;
  viewUrl: string;
}): unknown[] {
  return [
    ...buildStatGridBlocks(counts, renderName),
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "View Stats" },
          url: viewUrl,
        },
      ],
    },
  ];
}

// Plain-text fallback used by Slack for notification previews and screen
// readers. Mirrors the block content as one stat per line.
function buildFallbackText({
  renderName,
  counts,
}: {
  renderName: string;
  counts: Map<EngagementType, number>;
}): string {
  const lines = STAT_DEFS.map((s) => `${s.emoji} ${s.label}: ${counts.get(s.eventType) ?? 0}`);
  return `Engagement Stats for ${renderName}\n${lines.join("\n")}`;
}

// Recompute counts from vlad_engagement_events on every event. Cheap for
// low-traffic renders; revisit (denormalize counters) if a single render
// starts ingesting thousands of events. Internal-IP filter applied in JS
// because the IN-list is short and the query stays simple.
async function recomputeCounts(slug: string): Promise<Map<EngagementType, number>> {
  const { data } = await supabase
    .from("vlad_engagement_events")
    .select("type, ip_hash")
    .eq("slug", slug)
    .eq("is_bot", false)
    .in("type", [...TRACKED_EVENT_TYPES]);
  const counts = new Map<EngagementType, number>();
  for (const row of (data ?? []) as EventRow[]) {
    if (isInternalIpHash(row.ip_hash)) continue;
    counts.set(row.type, (counts.get(row.type) ?? 0) + 1);
  }
  return counts;
}

// Hook fired from logEngagementEvent after a successful insert of any
// tracked event type. All work is best-effort — never throws back into the
// engagement flow. First event for a slug posts a new DM; every later event
// re-renders the same message in place via chat.update.
export async function notifyRenderEvent(args: DispatchArgs): Promise<void> {
  if (args.isBot) return;
  if (isInternalIpHash(args.ipHash)) return;

  const { data: renderData } = await supabase
    .from("vlad_renders")
    .select("user_id, brand, brand_name, brand_url")
    .eq("slug", args.slug)
    .maybeSingle();
  const render = renderData as RenderRow | null;
  if (!render?.user_id) return;

  const { data: prefsData } = await supabase
    .from("vlad_user_preferences")
    .select("notify_visit, vlad_users!inner(first_name, last_name)")
    .eq("user_id", render.user_id)
    .maybeSingle();
  const prefs = prefsData as PrefsRow | null;
  if (!prefs?.notify_visit) return;

  const counts = await recomputeCounts(args.slug);
  const renderName = formatRenderName(render);
  const repName = formatRepName(prefs, render.user_id);
  const viewUrl = buildEngagementUrl([
    { kind: "presenter", value: render.user_id, label: repName },
    ...(render.brand_url
      ? [{ kind: "merchant", value: render.brand_url, label: render.brand_name ?? render.brand_url }]
      : []),
  ]);
  const blocks = buildPerRenderBlocks({ renderName, counts, viewUrl });
  const text = buildFallbackText({ renderName, counts });

  // Look up the existing notification row. If the table itself is missing
  // (migration 018 not applied) we surface it loudly and bail rather than
  // spam a new chat.postMessage on every event.
  const { data: notifData, error: notifErr } = await supabase
    .from("vlad_render_notifications")
    .select("slack_channel, slack_ts")
    .eq("slug", args.slug)
    .maybeSingle();
  if (notifErr) {
    console.error(
      `[notifyRenderEvent] notification lookup failed for ${args.slug}: ${notifErr.message}. ` +
        `Bailing to avoid posting duplicate DMs. Has migration 018_render_notifications.sql been applied?`,
    );
    return;
  }
  const existing = notifData as NotifRow | null;

  if (existing) {
    const result = await updateUserMessage({
      channel: existing.slack_channel,
      ts: existing.slack_ts,
      text,
      blocks,
    });
    if (result.status === "gone") {
      // Slack message was deleted (or we lost edit perms). Drop the row so
      // the next event posts a fresh DM and starts over.
      await supabase.from("vlad_render_notifications").delete().eq("slug", args.slug);
    } else if (result.status === "error") {
      console.error(
        `[notifyRenderEvent] chat.update failed for ${args.slug}: ${result.slackError}`,
      );
    }
    return;
  }

  // First event for this render — post a new DM.
  const dm = await sendUserDM({ email: render.user_id, text, blocks });
  if (dm.status !== "sent") {
    if (dm.status === "error") {
      console.error(`[notifyRenderEvent] initial DM failed for ${args.slug}: ${dm.slackError}`);
    }
    return;
  }

  // Cache the channel + ts so the next event edits this same message.
  // ignoreDuplicates so a race on concurrent first events doesn't error
  // out — the second-place winner just leaves an orphan Slack message,
  // and chat.update on subsequent events lands on whichever ts the row
  // ended up holding.
  const { error: upsertErr } = await supabase
    .from("vlad_render_notifications")
    .upsert(
      {
        slug: args.slug,
        rep_email: render.user_id,
        slack_channel: dm.channel,
        slack_ts: dm.ts,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "slug", ignoreDuplicates: true },
    );
  if (upsertErr) {
    console.error(
      `[notifyRenderEvent] notification row upsert failed for ${args.slug}: ${upsertErr.message}. ` +
        `Future events will keep posting fresh DMs until this is fixed.`,
    );
  }
}
