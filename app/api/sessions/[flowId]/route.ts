import { NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";
import { deleteByPrefix, recordingDir } from "@/lib/storage/r2";
import { invalidateRenderCacheForRecording } from "@/lib/cache/render-cache";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Wipe everything tied to a flowId that was uploaded but never saved as a
 * recording — the user hit discard / closed the tab / navigated away after
 * triggering a preview.
 *
 * Post-restructure: session uploads, the auto-baked siblings, the auto-saved
 * preview, and any produce intermediates from in-flight previews ALL live
 * under one prefix (`vlad/users/{user}/recordings/{flowId}/`). Cleanup
 * collapses to one prefix scan + Redis cache invalidation. The flowId
 * doubles as the recordingId on save, so the path is the same in both
 * pre-save and post-save states.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ flowId: string }> },
) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { flowId } = await params;
  if (!UUID_RE.test(flowId)) {
    return NextResponse.json({ error: "Invalid flowId." }, { status: 400 });
  }

  try {
    await invalidateRenderCacheForRecording(session.email, flowId);
  } catch (err) {
    console.warn(`[sessions DELETE] cache invalidate failed for ${flowId}:`, err);
  }
  try {
    await deleteByPrefix(`${recordingDir(session.email, flowId)}/`);
  } catch (err) {
    console.warn(`[sessions DELETE] R2 cleanup failed for ${flowId}:`, err);
  }

  return NextResponse.json({ ok: true });
}
