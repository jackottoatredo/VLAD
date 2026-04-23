import { NextResponse } from "next/server";
import { supabase } from "@/lib/db/supabase";
import { requireSession } from "@/lib/apiAuth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const name = searchParams.get("name");

  if (type && type !== "product" && type !== "merchant") {
    return NextResponse.json({ error: "Invalid type." }, { status: 400 });
  }

  // Live duplicate check used by the name modal.
  if (name != null) {
    const { data, error } = await supabase
      .from("vlad_recordings")
      .select("id")
      .eq("user_id", session.email)
      .eq("name", name)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ exists: !!data });
  }

  let query = supabase
    .from("vlad_recordings")
    .select("id, type, name, product_name, merchant_id, preview_url, status, metadata, created_at, updated_at")
    .eq("user_id", session.email)
    .order("updated_at", { ascending: false });

  if (type) {
    query = query.eq("type", type);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ recordings: data });
}

export async function DELETE(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { id?: unknown };
  try {
    body = (await request.json()) as { id?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  if (typeof body.id !== "string") {
    return NextResponse.json({ error: "Missing id." }, { status: 400 });
  }

  const { error } = await supabase
    .from("vlad_recordings")
    .delete()
    .eq("id", body.id)
    .eq("user_id", session.email);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
