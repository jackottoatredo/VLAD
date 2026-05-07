import { supabase } from "@/lib/db/supabase";
import { sendUserDM } from "@/lib/slack/sendUserDM";
import { isInternalIpHash } from "@/lib/stats/internalIps";
import { buildEngagementUrl } from "@/lib/notifications/engagementUrl";
import type { EngagementType } from "@/lib/stats/engagement";

type Window = "daily" | "weekly";

type RenderRow = {
  slug: string;
  user_id: string | null;
  brand_name: string | null;
  brand_url: string | null;
};

type EventRow = {
  type: EngagementType;
  slug: string;
  ip_hash: string | null;
  is_bot: boolean | null;
};

type RepRow = {
  user_id: string;
  // Supabase JS returns nested relations as arrays even on !inner joins
  // where it's effectively one row. Treat as a single record.
  vlad_users: { first_name: string | null; last_name: string | null }[] | null;
};

type BrandTotals = {
  brandName: string;
  brandUrl: string | null;
  visits: number;
  completions: number;
  bookClicks: number;
};

type RepTotals = {
  totalVisits: number;
  totalCompletions: number;
  totalBookClicks: number;
  brands: Map<string, BrandTotals>;
};

function emptyTotals(): RepTotals {
  return {
    totalVisits: 0,
    totalCompletions: 0,
    totalBookClicks: 0,
    brands: new Map(),
  };
}

function formatTotals(window: Window, repName: string, repEmail: string, totals: RepTotals): string {
  const periodLabel = window === "daily" ? "Yesterday" : "Last week";
  const header =
    `:bar_chart: ${periodLabel} on your shares: ${totals.totalVisits} visits, ` +
    `${totals.totalCompletions} video completions, ` +
    `${totals.totalBookClicks} booking ${totals.totalBookClicks === 1 ? "click" : "clicks"}.`;

  const sortedBrands = [...totals.brands.values()]
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 5);

  const lines = sortedBrands.map((b) => {
    const url = buildEngagementUrl([
      { kind: "presenter", value: repEmail, label: repName },
      ...(b.brandUrl ? [{ kind: "merchant", value: b.brandUrl, label: b.brandName }] : []),
    ]);
    const detail = [
      `${b.visits} visit${b.visits === 1 ? "" : "s"}`,
      b.completions > 0 ? `${b.completions} completion${b.completions === 1 ? "" : "s"}` : null,
      b.bookClicks > 0 ? `${b.bookClicks} booking ${b.bookClicks === 1 ? "click" : "clicks"}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    return `• *${b.brandName}* — ${detail}  <${url}|view>`;
  });

  if (lines.length === 0) return header;
  return `${header}\nTop brands:\n${lines.join("\n")}`;
}

async function processDigestForWindow(window: Window): Promise<void> {
  const toggleColumn = window === "daily" ? "notify_daily_digest" : "notify_weekly_digest";
  const windowMs = (window === "daily" ? 1 : 7) * 24 * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - windowMs).toISOString();

  // Step 1 — recipients.
  const { data: prefsData } = await supabase
    .from("vlad_user_preferences")
    .select(`user_id, vlad_users!inner(first_name, last_name)`)
    .eq(toggleColumn, true);
  const reps = (prefsData ?? []) as RepRow[];
  if (reps.length === 0) return;

  // Step 2 — every render owned by any opted-in rep. One query for all.
  const repEmails = reps.map((r) => r.user_id);
  const { data: rendersData } = await supabase
    .from("vlad_renders")
    .select("slug, user_id, brand_name, brand_url")
    .in("user_id", repEmails);
  const renders = (rendersData ?? []) as RenderRow[];
  if (renders.length === 0) return;

  const slugToRender = new Map<string, RenderRow>();
  for (const r of renders) slugToRender.set(r.slug, r);

  // Step 3 — events in the window for those slugs.
  const slugs = renders.map((r) => r.slug);
  const { data: eventsData } = await supabase
    .from("vlad_engagement_events")
    .select("type, slug, ip_hash, is_bot")
    .gte("created_at", cutoff)
    .in("slug", slugs);
  const events = ((eventsData ?? []) as EventRow[])
    .filter((e) => !e.is_bot && !isInternalIpHash(e.ip_hash));

  // Step 4 — fold into per-rep, per-brand totals.
  const perRep = new Map<string, RepTotals>();
  for (const e of events) {
    const render = slugToRender.get(e.slug);
    if (!render?.user_id) continue;
    let totals = perRep.get(render.user_id);
    if (!totals) {
      totals = emptyTotals();
      perRep.set(render.user_id, totals);
    }
    const brandKey = render.brand_url ?? render.brand_name ?? render.slug;
    let brandTotals = totals.brands.get(brandKey);
    if (!brandTotals) {
      brandTotals = {
        brandName: render.brand_name ?? render.brand_url ?? render.slug,
        brandUrl: render.brand_url,
        visits: 0,
        completions: 0,
        bookClicks: 0,
      };
      totals.brands.set(brandKey, brandTotals);
    }
    if (e.type === "human_visit") {
      totals.totalVisits++;
      brandTotals.visits++;
    } else if (e.type === "video_end") {
      totals.totalCompletions++;
      brandTotals.completions++;
    } else if (e.type === "click_book_demo") {
      totals.totalBookClicks++;
      brandTotals.bookClicks++;
    }
  }

  // Step 5 — DM each rep with non-zero activity.
  for (const rep of reps) {
    const totals = perRep.get(rep.user_id);
    if (!totals || totals.totalVisits + totals.totalCompletions + totals.totalBookClicks === 0) {
      continue;
    }
    const userRow = rep.vlad_users?.[0] ?? null;
    const repName = [userRow?.first_name, userRow?.last_name]
      .filter(Boolean)
      .join(" ")
      .trim() || rep.user_id;
    const text = formatTotals(window, repName, rep.user_id, totals);
    await sendUserDM({ email: rep.user_id, text });
  }
}

export async function processDailyDigestTick(): Promise<void> {
  await processDigestForWindow("daily");
}

export async function processWeeklyDigestTick(): Promise<void> {
  await processDigestForWindow("weekly");
}
