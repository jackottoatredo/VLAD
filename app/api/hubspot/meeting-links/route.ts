import { NextResponse } from "next/server";
import { supabase } from "@/lib/db/supabase";
import { requireSession } from "@/lib/apiAuth";
import {
  HubSpotError,
  listMeetingLinks,
  lookupUserIdByEmail,
} from "@/lib/hubspot/client";

export const runtime = "nodejs";

// Returns the rep's HubSpot meeting links plus the id of their currently
// selected one (so the dropdown can pre-select it). On the first call for a
// rep we resolve their HubSpot user_id from their email and persist it on
// vlad_users; subsequent calls skip that lookup.
//
// Admin override: when ?email=<other> is supplied AND the caller has the
// admin role, the response reflects that other rep's links + selection.
// The hubspot_user_id cache is also written to that rep's row.

type UserRow = {
  hubspot_user_id: string | null;
  hubspot_meeting_id: string | null;
  book_button_mode: "website_form" | "hidden" | "hubspot";
};

export async function GET(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const overrideEmail = new URL(request.url).searchParams.get("email");
  if (overrideEmail && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const targetEmail = overrideEmail ?? session.email;

  const { data: userRow, error: userErr } = await supabase
    .from("vlad_users")
    .select("hubspot_user_id, hubspot_meeting_id, book_button_mode")
    .eq("id", targetEmail)
    .maybeSingle();

  if (userErr) {
    return NextResponse.json({ error: userErr.message }, { status: 500 });
  }
  if (!userRow) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const row = userRow as UserRow;
  let hubspotUserId = row.hubspot_user_id;

  try {
    if (!hubspotUserId) {
      hubspotUserId = await lookupUserIdByEmail(targetEmail);
      if (!hubspotUserId) {
        return NextResponse.json({
          links: [],
          selectedId: row.hubspot_meeting_id,
          selectedMode: row.book_button_mode,
          reason: "no_hubspot_user",
        });
      }
      // Cache so subsequent requests skip the email→id lookup.
      await supabase
        .from("vlad_users")
        .update({ hubspot_user_id: hubspotUserId })
        .eq("id", targetEmail);
    }

    const links = await listMeetingLinks(hubspotUserId);
    return NextResponse.json({
      links,
      selectedId: row.hubspot_meeting_id,
      selectedMode: row.book_button_mode,
    });
  } catch (err) {
    if (err instanceof HubSpotError && err.isAuth) {
      return NextResponse.json(
        {
          error: "missing_scope",
          links: [],
          selectedId: row.hubspot_meeting_id,
          selectedMode: row.book_button_mode,
          reason: "missing_scope",
        },
        { status: 403 },
      );
    }
    const message = err instanceof Error ? err.message : "HubSpot request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
