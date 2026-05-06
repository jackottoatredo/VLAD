import { NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";
import { logEvent } from "@/lib/stats/events";

export const runtime = "nodejs";

// Heartbeat — UserContextProvider pings this once per session (rate-limited
// client-side via localStorage) so DAU reflects "any authed page load that
// day", not just sign-ins (which are rare given long JWT lifetimes).
export async function POST() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  void logEvent({ type: "user_active", userId: session.email });
  return NextResponse.json({ ok: true });
}
