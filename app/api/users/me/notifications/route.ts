import { NextResponse } from "next/server";
import { supabase } from "@/lib/db/supabase";
import { requireSession } from "@/lib/apiAuth";

export const runtime = "nodejs";

const NOTIFY_KEYS = [
  "notify_visit",
  "notify_visit_summary",
  "notify_daily_digest",
  "notify_weekly_digest",
] as const;
type NotifyKey = (typeof NOTIFY_KEYS)[number];

const ALLOWED = new Set<NotifyKey>(NOTIFY_KEYS);

function isNotifyKey(s: unknown): s is NotifyKey {
  return typeof s === "string" && ALLOWED.has(s as NotifyKey);
}

// Read current notification toggles for the logged-in rep.
export async function GET() {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("vlad_user_preferences")
    .select("notify_visit, notify_visit_summary, notify_daily_digest, notify_weekly_digest")
    .eq("user_id", session.email)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const row = (data as Partial<Record<NotifyKey, boolean>> | null) ?? {};
  return NextResponse.json({
    notify_visit: !!row.notify_visit,
    notify_visit_summary: !!row.notify_visit_summary,
    notify_daily_digest: !!row.notify_daily_digest,
    notify_weekly_digest: !!row.notify_weekly_digest,
  });
}

// PATCH body: { key: NotifyKey; enabled: boolean }. The summary toggle
// requires the live ping to be on — turning the live ping off cascades the
// summary off so a stale tab can't end up with a config that the dispatcher
// wouldn't honor anyway.
export async function PATCH(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const { key, enabled } = (body ?? {}) as { key?: unknown; enabled?: unknown };
  if (!isNotifyKey(key)) {
    return NextResponse.json({ error: "Invalid key." }, { status: 400 });
  }
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be boolean." }, { status: 400 });
  }
  if (key === "notify_visit_summary" && enabled) {
    // Server-side gate: don't let the summary be enabled without the live
    // ping. (UI also gates this; this is a defense-in-depth check.)
    const { data: current } = await supabase
      .from("vlad_user_preferences")
      .select("notify_visit")
      .eq("user_id", session.email)
      .maybeSingle();
    const visitOn = (current as { notify_visit?: boolean } | null)?.notify_visit;
    if (!visitOn) {
      return NextResponse.json(
        { error: "Live visit ping must be on to enable the summary." },
        { status: 400 },
      );
    }
  }

  const update: Record<string, boolean> = { [key]: enabled };
  if (key === "notify_visit" && enabled === false) {
    update.notify_visit_summary = false;
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
