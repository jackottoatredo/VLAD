import { NextResponse } from "next/server";
import { supabase } from "@/lib/db/supabase";
import { requireSession } from "@/lib/apiAuth";

export const runtime = "nodejs";

const NOTIFY_KEYS = [
  "notify_visit",
  "notify_daily_digest",
  "notify_weekly_digest",
  "notify_new_user_signup",
] as const;
type NotifyKey = (typeof NOTIFY_KEYS)[number];

const ALLOWED = new Set<NotifyKey>(NOTIFY_KEYS);

// Keys only admins are allowed to read or toggle.
const ADMIN_ONLY_KEYS = new Set<NotifyKey>(["notify_new_user_signup"]);

function isNotifyKey(s: unknown): s is NotifyKey {
  return typeof s === "string" && ALLOWED.has(s as NotifyKey);
}

// Read current notification toggles for the logged-in rep. Admin-only keys
// are stripped for non-admin sessions so the UI never sees a value it can't
// toggle.
export async function GET() {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("vlad_user_preferences")
    .select(
      "notify_visit, notify_daily_digest, notify_weekly_digest, notify_new_user_signup",
    )
    .eq("user_id", session.email)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const row = (data as Partial<Record<NotifyKey, boolean>> | null) ?? {};
  const isAdmin = session.role === "admin";
  const payload: Record<NotifyKey, boolean> = {
    notify_visit: !!row.notify_visit,
    notify_daily_digest: !!row.notify_daily_digest,
    notify_weekly_digest: !!row.notify_weekly_digest,
    notify_new_user_signup: !!row.notify_new_user_signup,
  };
  if (!isAdmin) {
    for (const key of ADMIN_ONLY_KEYS) delete (payload as Partial<typeof payload>)[key];
  }
  return NextResponse.json(payload);
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
  if (ADMIN_ONLY_KEYS.has(key) && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
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
