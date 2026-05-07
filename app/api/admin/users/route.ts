import { NextResponse } from "next/server";
import { supabase } from "@/lib/db/supabase";
import { requireSession } from "@/lib/apiAuth";

export const runtime = "nodejs";

// Admin-only directory of vlad_users for the settings-page admin picker.
// Returns a flat list ordered by first name; vlad_users is small enough
// that pagination isn't worth it.

type Row = {
  id: string;
  first_name: string;
  last_name: string;
  role: "user" | "admin";
};

export async function GET() {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("vlad_users")
    .select("id, first_name, last_name, role")
    .order("first_name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ users: (data as Row[]) ?? [] });
}
