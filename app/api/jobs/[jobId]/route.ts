import { NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";
import { jobsQueue } from "@/lib/queue/connection";
import { getPresignedUrl } from "@/lib/storage/r2";
import type { JobProgress } from "@/lib/queue/progress";
import type { ProduceResult } from "@/lib/render/produce";

export const runtime = "nodejs";

/**
 * Unified polling endpoint for every render job. Returns the same JobProgress
 * shape regardless of which preset (P1 merge, P2 product-only, future custom)
 * created the job. The UI consumes this verbatim so adding new job kinds
 * doesn't require any new endpoints or polling translations.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobId } = await params;
  const job = await jobsQueue.getJob(jobId);

  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  const state = await job.getState();

  if (state === "completed") {
    const raw = job.returnvalue as unknown;
    const result = (typeof raw === "string" ? JSON.parse(raw) : raw) as
      | (ProduceResult & { renderId?: string })
      | { videoUrl: string; renderId: string };

    // Merge jobs return videoUrl as an R2 key; produce jobs return finalR2Key.
    const r2Key = "finalR2Key" in result ? result.finalR2Key : result.videoUrl;
    const videoUrl = r2Key ? await getPresignedUrl(r2Key) : undefined;

    return NextResponse.json({
      status: "done",
      renderId: result.renderId,
      videoUrl,
      videoR2Key: r2Key,
    } satisfies JobProgress);
  }

  if (state === "failed") {
    return NextResponse.json({
      status: "error",
      message: job.failedReason ?? "Render failed.",
    } satisfies JobProgress);
  }

  // Active or waiting — workers store JobProgress directly via job.updateProgress
  const progress = job.progress;
  if (progress && typeof progress === "object" && "status" in (progress as Record<string, unknown>)) {
    return NextResponse.json(progress as JobProgress);
  }

  // Job queued but worker hasn't reported yet
  return NextResponse.json({ status: "queued" } satisfies JobProgress);
}
