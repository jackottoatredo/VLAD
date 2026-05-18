import { NextResponse } from "next/server";
import { requireBearerToken } from "@/lib/apiAuth";
import { supabase } from "@/lib/db/supabase";

export const runtime = "nodejs";

const RENDER_FIELDS =
  "id, slug, brand, brand_name, brand_url, product_recording_id, product_name, video_url, poster_key, status, progress, stale, created_at";

type RenderRow = {
  id: string;
  slug: string | null;
  brand: string | null;
  brand_name: string | null;
  brand_url: string | null;
  product_recording_id: string | null;
  product_name: string | null;
  video_url: string | null;
  poster_key: string | null;
  status: "pending" | "rendering" | "done" | "error";
  progress: number | null;
  stale: boolean;
  created_at: string;
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!requireBearerToken(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing id." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("vlad_renders")
    .select(RENDER_FIELDS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const r = data as RenderRow;
  const render = {
    id: r.id,
    slug: r.slug,
    brand: r.brand,
    brandName: r.brand_name,
    brandUrl: r.brand_url,
    productRecordingId: r.product_recording_id,
    productName: r.product_name,
    videoUrl: r.video_url,
    posterKey: r.poster_key,
    status: r.status,
    progress: r.progress,
    stale: r.stale,
    createdAt: r.created_at,
  };

  return NextResponse.json({ render });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!requireBearerToken(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing id." }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const email = searchParams.get("email")?.trim().toLowerCase() ?? "";
  if (!email) {
    return NextResponse.json({ error: "Missing email." }, { status: 400 });
  }

  const { data: row, error: lookupErr } = await supabase
    .from("vlad_renders")
    .select("id, user_id")
    .eq("id", id)
    .maybeSingle();

  if (lookupErr) {
    return NextResponse.json({ error: lookupErr.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if ((row as { user_id: string }).user_id !== email) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const { error: deleteErr } = await supabase
    .from("vlad_renders")
    .delete()
    .eq("id", id);

  if (deleteErr) {
    return NextResponse.json({ error: deleteErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
