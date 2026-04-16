import { NextResponse } from "next/server";
import { supabase } from "@/lib/db/supabase";
import { getPresignedUrl } from "@/lib/storage/r2";
import { requireSession } from "@/lib/apiAuth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Missing id." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("vlad_recordings")
    .select("preview_url")
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Recording not found." }, { status: 404 });
  }

  const row = data as { preview_url: string | null };

  if (!row.preview_url) {
    return NextResponse.json({ error: "No preview available." }, { status: 404 });
  }

  const url = await getPresignedUrl(row.preview_url, 3600);
  return NextResponse.json({ url });
}
