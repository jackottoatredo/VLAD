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
  brand_url: string | null;
  product_name: string | null;
};

const TARGETS: Record<string, { type: EngagementType; resolve: (row: ShareRow) => string | null }> = {
  "book-demo": {
    type: "click_book_demo",
    resolve: () => BOOK_DEMO_URL,
  },
  "interactive-demo": {
    type: "click_interactive_demo",
    resolve: (row) => {
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
    .select("brand_url, product_name")
    .eq("slug", slug)
    .single();

  if (error || !data) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const target = TARGETS[to];
  const destination = target.resolve(data as ShareRow);
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
