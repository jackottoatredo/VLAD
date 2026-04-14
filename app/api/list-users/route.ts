import { NextResponse } from "next/server";
import { supabase } from "@/lib/db/supabase";

export const runtime = "nodejs";

export async function GET() {
  const { data, error } = await supabase
    .from("vlad_users")
    .select("id")
    .order("id");

  if (error) {
    return NextResponse.json({ users: [] });
  }

  return NextResponse.json({ users: data.map((r) => r.id) });
}
