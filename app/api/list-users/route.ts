import { NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";
import { supabase } from "@/lib/db/supabase";

export const runtime = "nodejs";

export async function GET() {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("vlad_users")
    .select("id, first_name, last_name")
    .order("id");

  if (error) {
    return NextResponse.json({ users: [] });
  }

  return NextResponse.json({
    users: data.map((r) => r.id),
  });
}
