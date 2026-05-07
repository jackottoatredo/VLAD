import { NextResponse } from "next/server";
import { supabase } from "@/lib/db/supabase";
import { BOOK_DEMO_URL, INTERACTIVE_DEMO_BASE_URL } from "@/app/config";
import { logEngagementEvent, type EngagementType } from "@/lib/stats/engagement";

export const runtime = "nodejs";

const VISITOR_ID_RE = /^[a-f0-9-]{16,64}$/i;

// Tracked redirect for outbound CTAs on the share page. Both buttons
// route through here so clicks are logged server-side regardless of
// client JS — works for unfurl-bot follow-clicks too.
//
// Whitelist-based to close the open-redirect vulnerability: arbitrary
// `to` values 404 instead of redirecting.

type ShareRow = {
  user_id: string | null;
  brand_url: string | null;
  product_name: string | null;
};

type ResolveContext = {
  row: ShareRow;
  // The rep's saved HubSpot meeting link, if any. Loaded once from
  // vlad_users by user_id; null when unset, when user_id is missing, or
  // on lookup error. Only book-demo uses it.
  hubspotMeetingLink: string | null;
};

const TARGETS: Record<string, { type: EngagementType; resolve: (ctx: ResolveContext) => string | null }> = {
  "book-demo": {
    type: "click_book_demo",
    // Per-rep HubSpot calendar when set, marketing fallback otherwise so
    // unconfigured reps keep working.
    resolve: (ctx) => ctx.hubspotMeetingLink ?? BOOK_DEMO_URL,
  },
  "interactive-demo": {
    type: "click_interactive_demo",
    resolve: ({ row }) => {
      if (!row.brand_url) return null;
      const base = `${INTERACTIVE_DEMO_BASE_URL}${row.brand_url}`;
      return row.product_name?.trim()
        ? `${base}?product=${encodeURIComponent(row.product_name)}`
        : base;
    },
  },
};

type TargetKey = keyof typeof TARGETS;

function isTargetKey(s: string): s is TargetKey {
  return s in TARGETS;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const { searchParams } = new URL(request.url);
  const to = searchParams.get("to") ?? "";

  if (!isTargetKey(to)) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const { data, error } = await supabase
    .from("vlad_renders")
    .select("user_id, brand_url, product_name")
    .eq("slug", slug)
    .single();

  if (error || !data) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const row = data as ShareRow;

  // Per-rep config only matters for book-demo. Skip the extra query for
  // other targets.
  let hubspotMeetingLink: string | null = null;
  if (to === "book-demo" && row.user_id) {
    const { data: userRow } = await supabase
      .from("vlad_users")
      .select("book_button_mode, hubspot_meeting_link")
      .eq("id", row.user_id)
      .maybeSingle();
    const u = userRow as
      | { book_button_mode: "website_form" | "hidden" | "hubspot"; hubspot_meeting_link: string | null }
      | null;
    // 'hidden' means viewers shouldn't have been shown a button; treat
    // any sneak-in click as 404 rather than redirect to the fallback.
    if (u?.book_button_mode === "hidden") {
      return new NextResponse("Not Found", { status: 404 });
    }
    if (u?.book_button_mode === "hubspot" && u.hubspot_meeting_link?.trim()) {
      hubspotMeetingLink = u.hubspot_meeting_link;
    }
  }

  const target = TARGETS[to];
  const destination = target.resolve({ row, hubspotMeetingLink });
  if (!destination) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const vRaw = searchParams.get("v");
  const visitorId = vRaw && VISITOR_ID_RE.test(vRaw) ? vRaw : null;

  void logEngagementEvent({
    type: target.type,
    slug,
    headers: request.headers,
    visitorId,
    payload: { to },
  });

  return new NextResponse(null, {
    status: 302,
    headers: {
      Location: destination,
      // Must log every click — never serve a cached redirect.
      "Cache-Control": "no-store",
    },
  });
}
