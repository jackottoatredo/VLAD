import { supabase } from "@/lib/db/supabase";
import { jobsQueue } from "@/lib/queue/connection";
import { isInternalIpHash } from "@/lib/stats/internalIps";
import { sendUserDM } from "@/lib/slack/sendUserDM";
import { buildEngagementUrl } from "@/lib/notifications/engagementUrl";

const VISIT_SUMMARY_DELAY_MS = 5 * 60 * 1000;

type DispatchArgs = {
  slug: string;
  visitorId: string | null;
  ipHash: string;
  isBot: boolean;
  /** Timestamp of the human_visit row insert. Used as the visit-summary
   *  window start. */
  insertedAt: Date;
};

type RenderRow = {
  user_id: string | null;
  brand_name: string | null;
  product_name: string | null;
  brand_url: string | null;
};

type PrefsRow = {
  notify_visit: boolean;
  notify_visit_summary: boolean;
  // Supabase JS hydrates nested relations as arrays even when only one row
  // can match.
  vlad_users: { first_name: string | null; last_name: string | null }[] | null;
};

type VisitorRow = { city: string | null; region: string | null; country: string | null };

function formatLocation(v: VisitorRow | null): string {
  if (!v) return "Someone";
  const parts = [v.city, v.region].filter(Boolean);
  if (parts.length) return `Someone in ${parts.join(", ")}`;
  if (v.country) return `Someone in ${v.country}`;
  return "Someone";
}

function formatRenderName(r: RenderRow): string {
  const brand = r.brand_name?.trim();
  const product = r.product_name?.trim();
  if (brand && product) return `${brand} — ${product}`;
  if (brand) return brand;
  if (product) return product;
  return r.brand_url ?? "your demo";
}

// Hook fired from logEngagementEvent after a successful human_visit insert.
// All work is best-effort and silent on failure — engagement logging must
// never be impacted by Slack issues.
export async function notifyOnVisit(args: DispatchArgs): Promise<void> {
  if (args.isBot || !args.visitorId) return;
  if (isInternalIpHash(args.ipHash)) return;

  const { data: renderData } = await supabase
    .from("vlad_renders")
    .select("user_id, brand_name, product_name, brand_url")
    .eq("slug", args.slug)
    .maybeSingle();
  const render = renderData as RenderRow | null;
  if (!render?.user_id) return;

  const { data: prefsData } = await supabase
    .from("vlad_user_preferences")
    .select("notify_visit, notify_visit_summary, vlad_users!inner(first_name, last_name)")
    .eq("user_id", render.user_id)
    .maybeSingle();
  const prefs = prefsData as PrefsRow | null;
  if (!prefs?.notify_visit) return;

  const { data: visitorData } = await supabase
    .from("vlad_engagement_visitors")
    .select("city, region, country")
    .eq("visitor_id", args.visitorId)
    .maybeSingle();
  const visitor = visitorData as VisitorRow | null;

  const userRow = prefs.vlad_users?.[0] ?? null;
  const repName = [userRow?.first_name, userRow?.last_name]
    .filter(Boolean)
    .join(" ")
    .trim() || render.user_id;

  const renderLabel = formatRenderName(render);
  const location = formatLocation(visitor);
  const viewUrl = buildEngagementUrl([
    { kind: "presenter", value: render.user_id, label: repName },
    ...(render.brand_url
      ? [{
          kind: "merchant",
          value: render.brand_url,
          label: render.brand_name ?? render.brand_url,
        }]
      : []),
  ]);

  const text = `:eyes: ${location} just opened *${renderLabel}*. <${viewUrl}|View engagement>`;

  const dmResult = await sendUserDM({ email: render.user_id, text });
  if (dmResult.status !== "sent") return;

  if (!prefs.notify_visit_summary) return;

  await jobsQueue.add(
    "visit_summary",
    {
      type: "visit_summary",
      repEmail: render.user_id,
      visitorId: args.visitorId,
      slug: args.slug,
      parentTs: dmResult.ts,
      visitStartedAt: args.insertedAt.toISOString(),
    },
    { delay: VISIT_SUMMARY_DELAY_MS },
  );
}
