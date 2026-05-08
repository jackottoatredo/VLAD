import { NextResponse } from "next/server";
import { supabase } from "@/lib/db/supabase";
import { requireSession } from "@/lib/apiAuth";
import { deleteManyFromR2, listKeysWithPrefix, VLAD_NAMESPACE } from "@/lib/storage/r2";
import { amplitudeKeyForWebcam } from "@/lib/audio/amplitude";
import { bundleKeyForWebcam } from "@/lib/audio/webcam-frames";
import { invalidateRenderCacheForRecordingWithKeys } from "@/lib/cache/render-cache";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");

  if (type && type !== "product" && type !== "merchant") {
    return NextResponse.json({ error: "Invalid type." }, { status: 400 });
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

  // Read the row's R2 keys before the row goes away. The `existing` lookup
  // also enforces ownership for non-admins so the post-delete cleanup
  // doesn't leak across users.
  let selectQuery = supabase
    .from("vlad_recordings")
    .select("user_id, mouse_events_url, webcam_url, preview_url")
    .eq("id", body.id);
  if (session.role !== "admin") selectQuery = selectQuery.eq("user_id", session.email);
  const { data: existing } = await selectQuery.maybeSingle();

  let deleteQuery = supabase.from("vlad_recordings").delete().eq("id", body.id);
  if (session.role !== "admin") deleteQuery = deleteQuery.eq("user_id", session.email);
  const { error } = await deleteQuery;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // R2 + cache cleanup runs after the DB delete. Best-effort: failures here
  // don't fail the user-facing request — the orphan sweeper (dev/r2-orphans.mjs)
  // is the safety net.
  if (existing) {
    const keys: string[] = [];
    if (existing.mouse_events_url) keys.push(existing.mouse_events_url);
    if (existing.webcam_url) {
      keys.push(existing.webcam_url);
      if (existing.webcam_url.endsWith(".webm")) {
        keys.push(amplitudeKeyForWebcam(existing.webcam_url));
        keys.push(bundleKeyForWebcam(existing.webcam_url));
      }
    }
    if (existing.preview_url) keys.push(existing.preview_url);

    try {
      const cachedR2Keys = await invalidateRenderCacheForRecordingWithKeys(
        existing.user_id,
        body.id,
      );
      keys.push(...cachedR2Keys);
    } catch (err) {
      console.warn(`[recordings DELETE] cache invalidate failed for ${body.id}:`, err);
    }

    // Belt-and-braces: list-scan the produce intermediate dirs in case any
    // files weren't reachable via cache (mid-run worker failures, etc).
    //
    // Post-refactor sessionName layout: every produce flow (plain produce
    // and product-only-export) writes intermediates under
    // vlad/{sub}/{userId}/{recordingId}/..., so a single prefix scan per
    // sub-bucket catches everything. Merge intermediates live under
    // vlad/renders/{userId}/merge_{jobId}/ — by design, those belong to a
    // vlad_renders row and are cleaned on render delete instead.
    for (const sub of ["renders", "composites", "trims"]) {
      const prefix = `${VLAD_NAMESPACE}/${sub}/${existing.user_id}/${body.id}/`;
      try {
        keys.push(...(await listKeysWithPrefix(prefix)));
      } catch (err) {
        console.warn(`[recordings DELETE] list ${prefix} failed:`, err);
      }
    }

    const dedup = [...new Set(keys)];
    if (dedup.length > 0) {
      try {
        await deleteManyFromR2(dedup);
      } catch (err) {
        console.warn(`[recordings DELETE] R2 cleanup failed for ${body.id}:`, err);
      }
    }
  }

  return NextResponse.json({ ok: true });
}
