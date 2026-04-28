import { NextResponse } from "next/server";
import { requireBearerToken } from "@/lib/apiAuth";
import { supabase } from "@/lib/db/supabase";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!requireBearerToken(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("vlad_users")
    .select("id, first_name, last_name")
    .order("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const users = data.map((u) => ({
    name: [u.first_name, u.last_name].filter(Boolean).join(" "),
    email: u.id,
  }));

  return NextResponse.json(users);
}
