import { NextResponse } from "next/server";
import { supabase } from "@/lib/db/supabase";
import { requireSession } from "@/lib/apiAuth";

export const runtime = "nodejs";

const RENDER_FIELDS = "id, product_recording_id, merchant_recording_id, brand, video_url, slug, poster_key, gif_key, status, progress, seen, stale, job_id, job_request, created_at";

export async function GET() {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("vlad_renders")
    .select(RENDER_FIELDS)
    .eq("user_id", session.email)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ renders: data });
}

type CreateBody = {
  merchantRecordingId?: unknown;
  productRecordingId?: unknown;
  brand?: unknown;
};

export async function POST(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  if (typeof body.merchantRecordingId !== "string" || typeof body.productRecordingId !== "string") {
    return NextResponse.json({ error: "Missing merchantRecordingId or productRecordingId." }, { status: 400 });
  }

  const brand = typeof body.brand === "string" ? body.brand : null;

  const { data, error } = await supabase
    .from("vlad_renders")
    .insert({
      user_id: session.email,
      merchant_recording_id: body.merchantRecordingId,
      product_recording_id: body.productRecordingId,
      brand,
      video_url: null,
      status: "done",
      progress: 100,
      seen: false,
    })
    .select(RENDER_FIELDS)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ render: data });
}

type PatchBody = {
  id?: unknown;
  /**
   * When 'error', marks the row as failed — used by the UI to recover from
   * orphan in-progress rows whose BullMQ job has been evicted (worker crash,
   * Redis flush). Default behavior (no status field) sets seen=true.
   */
  status?: unknown;
};

export async function PATCH(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  if (typeof body.id !== "string") {
    return NextResponse.json({ error: "Missing id." }, { status: 400 });
  }

  const update: Record<string, unknown> =
    body.status === "error" ? { status: "error" } : { seen: true };

  const { error } = await supabase
    .from("vlad_renders")
    .update(update)
    .eq("id", body.id)
    .eq("user_id", session.email);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
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
    .from("vlad_renders")
    .delete()
    .eq("id", body.id)
    .eq("user_id", session.email);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
