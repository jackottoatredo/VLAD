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

export async function GET(request: Request) {
  if (!requireBearerToken(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const email = searchParams.get("email")?.trim().toLowerCase() ?? "";
  if (!email) {
    return NextResponse.json({ error: "Missing email." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("vlad_renders")
    .select(RENDER_FIELDS)
    .eq("user_id", email)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const renders = ((data ?? []) as RenderRow[]).map((r) => ({
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
  }));

  return NextResponse.json({ renders });
}
