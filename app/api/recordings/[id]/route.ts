import { NextResponse } from "next/server";
import { supabase } from "@/lib/db/supabase";
import { getPresignedUrl } from "@/lib/storage/r2";
import { requireSession } from "@/lib/apiAuth";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RecordingRow = {
  id: string;
  user_id: string;
  type: "product" | "merchant";
  name: string;
  product_name: string | null;
  merchant_id: string | null;
  mouse_events_url: string | null;
  webcam_url: string | null;
  preview_url: string | null;
  webcam_settings: unknown;
  metadata: Record<string, unknown>;
  status: "draft" | "saved";
  created_at: string;
  updated_at: string;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("vlad_recordings")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const row = data as RecordingRow;
  if (row.user_id !== session.email) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  let previewUrl: string | null = null;
  if (row.preview_url) {
    try {
      previewUrl = await getPresignedUrl(row.preview_url, 3600);
    } catch {
      previewUrl = null;
    }
  }

  return NextResponse.json({
    recording: {
      id: row.id,
      type: row.type,
      name: row.name,
      productName: row.product_name,
      merchantId: row.merchant_id,
      status: row.status,
      webcamSettings: row.webcam_settings ?? null,
      metadata: row.metadata ?? {},
      previewUrl,
      previewR2Key: row.preview_url,
      mouseEventsR2Key: row.mouse_events_url,
      webcamR2Key: row.webcam_url,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
  });
}

type PatchBody = {
  name?: unknown;
  status?: unknown;
  metadata?: unknown;
  webcamSettings?: unknown;
  previewR2Key?: unknown;
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { data: existing } = await supabase
    .from("vlad_recordings")
    .select("id, user_id, status")
    .eq("id", id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (existing.user_id !== session.email) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  let nameChanged = false;

  if (typeof body.name === "string" && body.name.trim()) {
    const name = body.name.trim();
    const { data: collision } = await supabase
      .from("vlad_recordings")
      .select("id")
      .eq("user_id", session.email)
      .eq("name", name)
      .neq("id", id)
      .maybeSingle();
    if (collision) {
      return NextResponse.json({ error: "Name already exists.", code: "NAME_COLLISION" }, { status: 409 });
    }
    update.name = name;
    nameChanged = true;
  }

  if (body.status === "draft" || body.status === "saved") {
    update.status = body.status;
  }

  if (body.metadata != null && typeof body.metadata === "object") {
    update.metadata = body.metadata;
  }

  if (body.webcamSettings != null && typeof body.webcamSettings === "object") {
    update.webcam_settings = body.webcamSettings;
  }

  if (typeof body.previewR2Key === "string" && body.previewR2Key.trim()) {
    update.preview_url = body.previewR2Key.trim();
  }

  const statusAfter = typeof update.status === "string" ? update.status : existing.status;
  const shouldMarkStale =
    existing.status === "saved" &&
    statusAfter === "saved" &&
    (update.metadata !== undefined || update.preview_url !== undefined || update.webcam_settings !== undefined || nameChanged);

  const { error } = await supabase
    .from("vlad_recordings")
    .update(update)
    .eq("id", id);

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Name already exists.", code: "NAME_COLLISION" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (shouldMarkStale) {
    await supabase
      .from("vlad_renders")
      .update({ stale: true })
      .or(`product_recording_id.eq.${id},merchant_recording_id.eq.${id}`);
  }

  return NextResponse.json({ ok: true });
}
