import { NextResponse } from "next/server";
import { requireBearerToken } from "@/lib/apiAuth";
import { supabase } from "@/lib/db/supabase";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!requireBearerToken(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const rawEmail = searchParams.get("email");
  const email = rawEmail?.trim().toLowerCase() ?? "";
  if (!email) {
    return NextResponse.json({ error: "Missing email." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("vlad_users")
    .select("id")
    .eq("id", email)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ exists: !!data });
}
