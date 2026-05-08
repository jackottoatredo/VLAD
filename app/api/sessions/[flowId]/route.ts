import { NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";
import { deleteManyFromR2, listKeysWithPrefix, VLAD_NAMESPACE } from "@/lib/storage/r2";
import { invalidateRenderCacheForRecordingWithKeys } from "@/lib/cache/render-cache";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Wipe everything tied to a flowId that was uploaded but never saved as a
 * recording — the user hit discard / closed the tab / navigated away after
 * triggering a preview. Five buckets of state to clean:
 *
 *   1. session siblings (mouse.json, webcam.webm + .amplitude.json + .frames.bin)
 *      under vlad/sessions/{user}/{flowId}/
 *   2. produce intermediates the worker wrote during a preview run, under
 *      vlad/{renders,composites,trims}/{user}/{flowId}/
 *   3. Redis render-cache hashes at cache:v4:{user}:{flowId}:*
 *   4. The R2 keys those cache hashes reference (typically the same files as
 *      #2, but we collect them defensively in case a cache entry references
 *      a key whose dirname diverged)
 *
 * Cache invalidation runs first so the cached references are extracted while
 * they still exist; the list-scan provides a safety net for jobs that failed
 * before reaching updateRenderCache.
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

  const userId = session.email;
  const keysToDelete: string[] = [
    `${VLAD_NAMESPACE}/sessions/${userId}/${flowId}/mouse.json`,
    `${VLAD_NAMESPACE}/sessions/${userId}/${flowId}/webcam.webm`,
    `${VLAD_NAMESPACE}/sessions/${userId}/${flowId}/webcam.amplitude.json`,
    `${VLAD_NAMESPACE}/sessions/${userId}/${flowId}/webcam.frames.bin`,
  ];

  // produce.ts uses flowId as the cache safeId, so cache entries for this
  // discard live at cache:v4:{user}:{flowId}:*. Pull the cached R2 intermediate
  // keys before deleting the hashes so we can clean them up in R2 too.
  try {
    const cachedR2Keys = await invalidateRenderCacheForRecordingWithKeys(userId, flowId);
    keysToDelete.push(...cachedR2Keys);
  } catch (err) {
    console.warn(`[sessions DELETE] cache invalidate failed for ${flowId}:`, err);
  }

  // List-scan for any intermediates the worker wrote but never made it into
  // the cache (mid-run failures, partial successes). Belt-and-braces over
  // the cache lookup above — duplicates are deduped before deletion.
  // Post-refactor every produce flow writes under {sub}/{userId}/{flowId}/.
  for (const sub of ["renders", "composites", "trims"]) {
    const prefix = `${VLAD_NAMESPACE}/${sub}/${userId}/${flowId}/`;
    try {
      keysToDelete.push(...(await listKeysWithPrefix(prefix)));
    } catch (err) {
      console.warn(`[sessions DELETE] list ${prefix} failed:`, err);
    }
  }

  await deleteManyFromR2([...new Set(keysToDelete)]);

  return NextResponse.json({ ok: true });
}
