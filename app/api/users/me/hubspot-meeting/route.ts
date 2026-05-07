import { NextResponse } from "next/server";
import { supabase } from "@/lib/db/supabase";
import { requireSession } from "@/lib/apiAuth";

export const runtime = "nodejs";

// Lightweight read used by the share-export modal's status footer
// ("Booking link: <name>" with edit link). Returns the rep's mode and,
// when mode='hubspot', the cached meeting name. The settings page reads
// richer data via /api/hubspot/meeting-links.
export async function GET() {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("vlad_user_preferences")
    .select("book_button_mode, hubspot_meeting_name")
    .eq("user_id", session.email)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const row = data as { book_button_mode?: string; hubspot_meeting_name?: string | null } | null;
  const mode =
    row?.book_button_mode === "hidden" || row?.book_button_mode === "hubspot"
      ? row.book_button_mode
      : "website_form";
  return NextResponse.json({
    mode,
    meetingName: mode === "hubspot" ? row?.hubspot_meeting_name ?? null : null,
  });
}

// PATCH body discriminated by `mode`. The /v/[slug]/go redirect reads
// book_button_mode + the cached meeting fields to decide what destination
// to send viewers to:
//   { mode: 'website_form' }                       → BOOK_DEMO_URL fallback
//   { mode: 'hidden' }                             → button not shown
//   { mode: 'hubspot', id, link, name }            → redirect to HubSpot link
//
// In the website_form / hidden modes we clear the meeting fields so stale
// names don't linger if the rep later switches back without re-picking.

type HubSpotBody = { mode: "hubspot"; id: unknown; link: unknown; name: unknown };
type SimpleBody = { mode: "website_form" | "hidden" };
type Body = HubSpotBody | SimpleBody;

function isMode(s: unknown): s is "website_form" | "hidden" | "hubspot" {
  return s === "website_form" || s === "hidden" || s === "hubspot";
}

export async function PATCH(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  if (!body || typeof body !== "object" || !isMode((body as { mode?: unknown }).mode)) {
    return NextResponse.json(
      { error: "mode must be 'website_form', 'hidden', or 'hubspot'." },
      { status: 400 },
    );
  }

  const update: Record<string, unknown> = { book_button_mode: body.mode };

  if (body.mode === "hubspot") {
    const { id, link, name } = body;
    if (
      typeof id !== "string" ||
      !id.trim() ||
      typeof link !== "string" ||
      !link.trim() ||
      typeof name !== "string" ||
      !name.trim()
    ) {
      return NextResponse.json(
        { error: "id, link, and name are required when mode='hubspot'." },
        { status: 400 },
      );
    }
    update.hubspot_meeting_id = id.trim();
    update.hubspot_meeting_link = link.trim();
    update.hubspot_meeting_name = name.trim();
  } else {
    update.hubspot_meeting_id = null;
    update.hubspot_meeting_link = null;
    update.hubspot_meeting_name = null;
  }

  const { error } = await supabase
    .from("vlad_user_preferences")
    .upsert(
      { user_id: session.email, ...update },
      { onConflict: "user_id" },
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
