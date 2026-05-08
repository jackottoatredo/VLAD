import { NextResponse } from "next/server";
import { supabase } from "@/lib/db/supabase";
import {
  uploadToR2,
  downloadBufferFromR2,
  getPresignedUrl,
  recordingDir,
} from "@/lib/storage/r2";
import { requireSession } from "@/lib/apiAuth";
import { logEvent } from "@/lib/stats/events";
import { slugifyPart, joinNameParts, deriveMerchantNameFromUrl } from "@/lib/naming";
import { reserveUniqueName } from "@/lib/db/reserveName";
import { invalidateRenderCacheForRecording } from "@/lib/cache/render-cache";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RequestBody = {
  flowId?: unknown;
  /** Optional user-supplied tag (free text). Server slugifies + appends to prefix. */
  tag?: unknown;
  status?: unknown;
  type?: unknown;
  productName?: unknown;
  merchantId?: unknown;
  metadata?: unknown;
  webcamSettings?: unknown;
  /** R2 key of the rendered preview video (e.g. composites/userId/session/file.mp4) */
  previewVideoR2Key?: unknown;
};

/**
 * Upsert a vlad_recordings row for a flow. Handles:
 *   - New saved recording   (server reserves a fresh name from prefix+tag)
 *   - New draft             (same; tag may be empty)
 *   - Finalize draft        (draft → saved, keeps the existing name)
 *   - Re-save existing      (saved → saved, keeps the existing name; downstream renders flagged stale)
 *
 * Names follow `{prefix}-{tag}-{count}` per AGENTS.md naming spec — prefix is
 * the merchant-name (intro) or product-name (product), tag is optional, count
 * is a collision-only `-N` suffix. Client posts `tag`; server resolves
 * everything else.
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

  const status = body.status === "draft" || body.status === "saved" ? body.status : null;
  if (!status) {
    return NextResponse.json({ error: "Invalid status." }, { status: 400 });
  }

  if (body.type !== "product" && body.type !== "merchant") {
    return NextResponse.json({ error: "Invalid type." }, { status: 400 });
  }

  const tag = typeof body.tag === "string" ? body.tag : "";

  const { data: existing } = await supabase
    .from("vlad_recordings")
    .select("id, user_id, status, name, merchant_name, preview_url, mouse_events_url, webcam_url")
    .eq("id", flowId)
    .maybeSingle();

  if (existing && existing.user_id !== session.email) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  // --- Resolve canonical prefix + canonical merchant_name (merchant only) ---
  const productNameRaw =
    body.type === "product" && typeof body.productName === "string" ? body.productName : null;
  const merchantIdRaw =
    body.type === "merchant" && typeof body.merchantId === "string" ? body.merchantId : null;

  let prefix = "";
  let resolvedMerchantName: string | null = null;

  if (body.type === "product") {
    if (!productNameRaw || !productNameRaw.trim()) {
      return NextResponse.json({ error: "Missing productName." }, { status: 400 });
    }
    prefix = slugifyPart(productNameRaw);
  } else {
    // Merchant: prefer previews.data.brandName, then previews.website_url, then
    // metadata.merchantUrl. Persist the resolved slug to vlad_recordings.merchant_name.
    let brandName: string | null = null;
    let websiteUrl: string | null = null;
    if (merchantIdRaw) {
      const { data: previewRow } = await supabase
        .from("previews")
        .select("website_url, data")
        .eq("id", merchantIdRaw)
        .maybeSingle();
      const pRow = previewRow as
        | { website_url?: string; data?: { brandName?: string } | null }
        | null;
      if (typeof pRow?.data?.brandName === "string" && pRow.data.brandName) {
        brandName = pRow.data.brandName;
      }
      if (typeof pRow?.website_url === "string") {
        websiteUrl = pRow.website_url;
      }
    }
    if (brandName) {
      prefix = slugifyPart(brandName);
    } else if (websiteUrl) {
      prefix = deriveMerchantNameFromUrl(websiteUrl);
    }
    if (!prefix) {
      const metaUrl =
        body.metadata && typeof body.metadata === "object"
          ? (body.metadata as Record<string, unknown>).merchantUrl
          : null;
      if (typeof metaUrl === "string") prefix = deriveMerchantNameFromUrl(metaUrl);
    }
    if (!prefix) {
      return NextResponse.json(
        { error: "Cannot derive merchant-name from previews row or metadata." },
        { status: 400 },
      );
    }
    resolvedMerchantName = prefix;
  }

  const base = joinNameParts([prefix, tag]);
  if (!base) {
    return NextResponse.json({ error: "Cannot derive base name." }, { status: 400 });
  }

  // Existing row keeps its name — recordings are not renameable. New rows get
  // a fresh collision-safe reservation.
  let resolvedName: string;
  if (existing?.name) {
    resolvedName = existing.name;
  } else {
    resolvedName = await reserveUniqueName({
      table: "vlad_recordings",
      column: "name",
      userId: session.email,
      base,
    });
  }

  // Post-restructure: session uploads, the recording's canonical mouse/webcam
  // data, the auto-baked siblings, the preview, and every produce intermediate
  // ALL live under one prefix — `vlad/users/{user}/recordings/{flowId}/`. The
  // flowId becomes the recordingId on save (same UUID), so the path is the
  // same in pre-save and post-save states. No copy step needed.
  const recordingPrefix = recordingDir(session.email, flowId);
  let mouseR2Key: string;
  let webcamR2Key: string | null;
  if (existing && existing.mouse_events_url) {
    mouseR2Key = existing.mouse_events_url;
    webcamR2Key = typeof existing.webcam_url === "string" && existing.webcam_url ? existing.webcam_url : null;
  } else {
    mouseR2Key = `${recordingPrefix}/mouse.json`;
    const sessionWebcamKey = `${recordingPrefix}/webcam.webm`;
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
      previewKey = `${recordingPrefix}/preview.mp4`;
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

  // For merchant recordings we always overwrite merchant_name with the freshly
  // resolved value — keeps it canonical even if a row was created pre-migration.
  const row = {
    id: flowId,
    user_id: session.email,
    type: body.type,
    name: resolvedName,
    product_name: productNameRaw,
    merchant_id: merchantIdRaw,
    merchant_name: body.type === "merchant" ? resolvedMerchantName : null,
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
      // Race: another insert grabbed our reservation between the read and the
      // write. Re-reserve once and try again.
      const retryName = await reserveUniqueName({
        table: "vlad_recordings",
        column: "name",
        userId: session.email,
        base,
      });
      const retry = await supabase
        .from("vlad_recordings")
        .upsert({ ...row, name: retryName }, { onConflict: "id" });
      if (retry.error) {
        return NextResponse.json({ error: retry.error.message }, { status: 500 });
      }
      resolvedName = retryName;
    } else {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  if (existing && existing.status === "saved" && status === "saved") {
    await supabase
      .from("vlad_renders")
      .update({ stale: true })
      .or(`product_recording_id.eq.${flowId},merchant_recording_id.eq.${flowId}`);
    // Wipe Redis cache entries that mention this recording. Without this,
    // a re-render with the same (url, mouse) would hit a cached produce
    // artifact computed against the OLD spec (old trim, old webcam settings).
    void invalidateRenderCacheForRecording(session.email, flowId).catch((err) => {
      console.warn(`[save-recording] cache invalidate failed for ${flowId}:`, err);
    });
  }

  // Emit `recording_created` only on the draft→saved transition (or fresh
  // saved insert). Re-saves of an already-saved recording don't re-count.
  const wasNewlySaved = (!existing || existing.status !== "saved") && status === "saved";
  if (wasNewlySaved) {
    void logEvent({
      type: "recording_created",
      userId: session.email,
      targetId: flowId,
      payload: { kind: body.type === "merchant" ? "intro" : "product" },
    });
  }

  let previewUrl: string | null = null;
  if (previewKey) {
    try {
      previewUrl = await getPresignedUrl(previewKey);
    } catch {
      previewUrl = null;
    }
  }

  return NextResponse.json({ ok: true, recordingId: flowId, name: resolvedName, status, previewUrl });
}
