import { NextResponse } from "next/server";
import { supabase } from "@/lib/db/supabase";
import { requireSession } from "@/lib/apiAuth";
import { deleteByPrefix, recordingDir } from "@/lib/storage/r2";
import { invalidateRenderCacheForRecording } from "@/lib/cache/render-cache";

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

  // Look up the row's owning user before the delete so we can build the
  // owned-prefix for cleanup (and so non-admin DELETE enforces ownership).
  let selectQuery = supabase
    .from("vlad_recordings")
    .select("user_id")
    .eq("id", body.id);
  if (session.role !== "admin") selectQuery = selectQuery.eq("user_id", session.email);
  const { data: existing } = await selectQuery.maybeSingle();

  let deleteQuery = supabase.from("vlad_recordings").delete().eq("id", body.id);
  if (session.role !== "admin") deleteQuery = deleteQuery.eq("user_id", session.email);
  const { error } = await deleteQuery;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Post-restructure: every artifact tied to this recording — session
  // siblings, preview.mp4, every cached intermediate from every produce
  // attempt — lives under one prefix. Hook 1 collapses to one prefix scan
  // + Redis cache invalidation. Best-effort: R2 failures don't fail the
  // user-visible delete; dev/r2-orphans.mjs is the safety net.
  if (existing) {
    try {
      await invalidateRenderCacheForRecording(existing.user_id, body.id);
    } catch (err) {
      console.warn(`[recordings DELETE] cache invalidate failed for ${body.id}:`, err);
    }
    try {
      await deleteByPrefix(`${recordingDir(existing.user_id, body.id)}/`);
    } catch (err) {
      console.warn(`[recordings DELETE] R2 cleanup failed for ${body.id}:`, err);
    }
  }

  return NextResponse.json({ ok: true });
}
