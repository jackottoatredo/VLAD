import { supabase } from "@/lib/db/supabase";
import { sendUserDM } from "@/lib/slack/sendUserDM";
import { isInternalIpHash } from "@/lib/stats/internalIps";
import { buildEngagementUrl } from "@/lib/notifications/engagementUrl";
import { TRACKED_EVENT_TYPES, formatStatLines, buildStatGridBlocks } from "@/lib/notifications/stats";
import type { EngagementType } from "@/lib/stats/engagement";

type Window = "daily" | "weekly";

const DIGEST_TZ = "America/Denver";

type RenderRow = { slug: string; user_id: string | null };
type EventRow = { type: EngagementType; slug: string; ip_hash: string | null; is_bot: boolean | null };
type RepRow = {
  user_id: string;
  vlad_users: { first_name: string | null; last_name: string | null }[] | null;
};

// "Sunday, May 6" — formatted in Mountain Time so the label matches the
// cron tick's local clock.
function formatDigestDate(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: DIGEST_TZ,
  }).format(d);
}

// "April 28 – May 4" — week range label. Used as the heading for weekly.
function formatWeekRange(start: Date, end: Date): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    timeZone: DIGEST_TZ,
  });
  return `${fmt.format(start)} – ${fmt.format(end)}`;
}

function formatRepName(rep: RepRow): string {
  const u = rep.vlad_users?.[0] ?? null;
  const name = [u?.first_name, u?.last_name].filter(Boolean).join(" ").trim();
  return name || rep.user_id;
}

// Slack Block Kit payload for daily/weekly digests. Same shape as the
// per-render notification — title heading + stats table inside a single
// markdown block, with a "View Stats" actions block underneath.
export function buildDigestBlocks({
  headingRange,
  counts,
  viewUrl,
}: {
  headingRange: string;
  counts: Map<EngagementType, number>;
  viewUrl: string;
}): unknown[] {
  return [
    ...buildStatGridBlocks(counts, headingRange),
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

// Heading rendered as the H3 title inside the digest's markdown block.
// Bold prefix ("Daily Summary" / "Weekly Summary") composes with the
// surrounding heading via Slack's markdown block. Exported so the test
// endpoint can generate realistic-looking headings.
export function formatDigestHeading(window: "daily" | "weekly", now = new Date()): string {
  const windowMs = (window === "daily" ? 1 : 7) * 24 * 60 * 60 * 1000;
  const start = new Date(now.getTime() - windowMs);
  if (window === "daily") return `**Daily Summary** - ${formatDigestDate(start)}`;
  return `**Weekly Summary** - ${formatWeekRange(start, now)}`;
}

async function processDigestForWindow(window: Window): Promise<void> {
  const toggleColumn = window === "daily" ? "notify_daily_digest" : "notify_weekly_digest";
  const windowMs = (window === "daily" ? 1 : 7) * 24 * 60 * 60 * 1000;
  const now = new Date();
  const cutoff = new Date(now.getTime() - windowMs);

  const headingRange = formatDigestHeading(window, now);

  // Step 1 — recipients.
  const { data: prefsData } = await supabase
    .from("vlad_user_preferences")
    .select(`user_id, vlad_users!inner(first_name, last_name)`)
    .eq(toggleColumn, true);
  const reps = (prefsData ?? []) as RepRow[];
  if (reps.length === 0) return;

  // Step 2 — every render owned by any opted-in rep.
  const repEmails = reps.map((r) => r.user_id);
  const { data: rendersData } = await supabase
    .from("vlad_renders")
    .select("slug, user_id")
    .in("user_id", repEmails);
  const renders = (rendersData ?? []) as RenderRow[];
  if (renders.length === 0) return;

  const slugToRep = new Map<string, string>();
  for (const r of renders) {
    if (r.user_id) slugToRep.set(r.slug, r.user_id);
  }

  // Step 3 — events in the window.
  const { data: eventsData } = await supabase
    .from("vlad_engagement_events")
    .select("type, slug, ip_hash, is_bot")
    .gte("created_at", cutoff.toISOString())
    .in("slug", [...slugToRep.keys()])
    .in("type", [...TRACKED_EVENT_TYPES]);
  const events = ((eventsData ?? []) as EventRow[])
    .filter((e) => !e.is_bot && !isInternalIpHash(e.ip_hash));

  // Step 4 — fold into per-rep per-type counts.
  const perRep = new Map<string, Map<EngagementType, number>>();
  for (const e of events) {
    const rep = slugToRep.get(e.slug);
    if (!rep) continue;
    let counts = perRep.get(rep);
    if (!counts) {
      counts = new Map();
      perRep.set(rep, counts);
    }
    counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  }

  // Step 5 — DM each rep with non-zero activity.
  for (const rep of reps) {
    const counts = perRep.get(rep.user_id);
    if (!counts || counts.size === 0) continue;
    const repName = formatRepName(rep);
    const viewUrl = buildEngagementUrl([
      { kind: "presenter", value: rep.user_id, label: repName },
    ]);
    const blocks = buildDigestBlocks({ headingRange, counts, viewUrl });
    // Plain-text fallback for notification preview.
    const text = `Engagement Stats for ${headingRange}\n${formatStatLines(counts)}`;
    await sendUserDM({ email: rep.user_id, text, blocks });
  }
}

export async function processDailyDigestTick(): Promise<void> {
  await processDigestForWindow("daily");
}

export async function processWeeklyDigestTick(): Promise<void> {
  await processDigestForWindow("weekly");
}
