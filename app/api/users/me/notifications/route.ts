import { NextResponse } from "next/server";
import { supabase } from "@/lib/db/supabase";
import { requireSession } from "@/lib/apiAuth";

export const runtime = "nodejs";

const NOTIFY_KEYS = [
  "notify_visit",
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
    .select("notify_visit, notify_daily_digest, notify_weekly_digest")
    .eq("user_id", session.email)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const row = (data as Partial<Record<NotifyKey, boolean>> | null) ?? {};
  return NextResponse.json({
    notify_visit: !!row.notify_visit,
    notify_daily_digest: !!row.notify_daily_digest,
    notify_weekly_digest: !!row.notify_weekly_digest,
  });
}

// PATCH body: { key: NotifyKey; enabled: boolean }.
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

  const { error } = await supabase
    .from("vlad_user_preferences")
    .upsert(
      { user_id: session.email, [key]: enabled },
      { onConflict: "user_id" },
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
