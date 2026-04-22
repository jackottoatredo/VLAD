import { NextResponse } from "next/server";
import { supabase } from "@/lib/db/supabase";
import {
  uploadToR2,
  downloadBufferFromR2,
  getPresignedUrl,
} from "@/lib/storage/r2";
import { requireSession, sanitizePresenter } from "@/lib/apiAuth";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RequestBody = {
  flowId?: unknown;
  name?: unknown;
  status?: unknown;
  type?: unknown;
  productName?: unknown;
  merchantId?: unknown;
  metadata?: unknown;
  webcamSettings?: unknown;
  /** R2 key of the rendered preview video (e.g. composites/presenter/session/file.mp4) */
  previewVideoR2Key?: unknown;
};

/**
 * Upsert a vlad_recordings row for a flow. Handles:
 *   - New saved recording
 *   - New draft
 *   - Finalize draft (draft → saved)
 *   - Re-save of existing saved recording (edit-save) → marks downstream renders stale
 *
 * Raw mouse + webcam stay at sessions/{presenter}/{flowId}/ and are referenced by
 * that path. Preview (when provided) is copied to recordings/{flowId}/preview.mp4.
 */
export async function POST(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const flowId = typeof body.flowId === "string" ? body.flowId.trim() : "";
  if (!UUID_RE.test(flowId)) {
    return NextResponse.json({ error: "Missing or invalid flowId." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Missing name." }, { status: 400 });
  }

  const status = body.status === "draft" || body.status === "saved" ? body.status : null;
  if (!status) {
    return NextResponse.json({ error: "Invalid status." }, { status: 400 });
  }

  if (body.type !== "product" && body.type !== "merchant") {
    return NextResponse.json({ error: "Invalid type." }, { status: 400 });
  }

  const safePresenter = sanitizePresenter(session.email);

  const { data: existing } = await supabase
    .from("vlad_recordings")
    .select("id, user_id, status, name, preview_url, mouse_events_url, webcam_url")
    .eq("id", flowId)
    .maybeSingle();

  if (existing && existing.user_id !== session.email) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const { data: collision } = await supabase
    .from("vlad_recordings")
    .select("id")
    .eq("user_id", session.email)
    .eq("name", name)
    .neq("id", flowId)
    .maybeSingle();

  if (collision) {
    return NextResponse.json({ error: "Name already exists.", code: "NAME_COLLISION" }, { status: 409 });
  }

  // Preserve existing URLs if the row already exists (important for old
  // saved recordings whose mouse/webcam live at recordings/{id}/ rather than
  // sessions/{presenter}/{flowId}/). For new inserts we use the session path.
  let mouseR2Key: string;
  let webcamR2Key: string | null;
  if (existing && existing.mouse_events_url) {
    mouseR2Key = existing.mouse_events_url;
    webcamR2Key = typeof existing.webcam_url === "string" && existing.webcam_url ? existing.webcam_url : null;
  } else {
    mouseR2Key = `sessions/${safePresenter}/${flowId}/mouse.json`;
    const sessionWebcamKey = `sessions/${safePresenter}/${flowId}/webcam.webm`;
    let webcamExists = false;
    try {
      await downloadBufferFromR2(sessionWebcamKey);
      webcamExists = true;
    } catch {
      webcamExists = false;
    }
    webcamR2Key = webcamExists ? sessionWebcamKey : null;
    try {
      await downloadBufferFromR2(mouseR2Key);
    } catch {
      return NextResponse.json({ error: "Session not uploaded yet." }, { status: 404 });
    }
  }

  let previewKey: string | null = existing?.preview_url ?? null;
  if (typeof body.previewVideoR2Key === "string" && body.previewVideoR2Key.trim()) {
    try {
      const previewBuffer = await downloadBufferFromR2(body.previewVideoR2Key.trim());
      previewKey = `recordings/${flowId}/preview.mp4`;
      await uploadToR2(previewKey, previewBuffer, "video/mp4");
    } catch {
      // Preview wasn't available (common for save-as-draft before render finishes).
    }
  }

  const metadata = body.metadata != null && typeof body.metadata === "object" ? body.metadata : {};
  const webcamSettings =
    body.webcamSettings != null && typeof body.webcamSettings === "object"
      ? body.webcamSettings
      : null;

  const row = {
    id: flowId,
    user_id: session.email,
    type: body.type,
    name,
    product_name: body.type === "product" && typeof body.productName === "string" ? body.productName : null,
    merchant_id: body.type === "merchant" && typeof body.merchantId === "string" ? body.merchantId : null,
    mouse_events_url: mouseR2Key,
    webcam_url: webcamR2Key,
    preview_url: previewKey,
    webcam_settings: webcamSettings,
    metadata,
    status,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("vlad_recordings").upsert(row, { onConflict: "id" });

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Name already exists.", code: "NAME_COLLISION" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (existing && existing.status === "saved" && status === "saved") {
    await supabase
      .from("vlad_renders")
      .update({ stale: true })
      .or(`product_recording_id.eq.${flowId},merchant_recording_id.eq.${flowId}`);
  }

  let previewUrl: string | null = null;
  if (previewKey) {
    try {
      previewUrl = await getPresignedUrl(previewKey);
    } catch {
      previewUrl = null;
    }
  }

  return NextResponse.json({ ok: true, recordingId: flowId, name, status, previewUrl });
}
