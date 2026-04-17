import { NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";
import { jobsQueue } from "@/lib/queue/connection";
import { getPresignedUrl } from "@/lib/storage/r2";
import type { ProduceResult } from "@/lib/render/produce";

export const runtime = "nodejs";

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
    const raw = job.returnvalue;
    const result = (typeof raw === "string" ? JSON.parse(raw) : raw) as ProduceResult;
    const videoUrl = await getPresignedUrl(result.finalR2Key);
    return NextResponse.json({
      status: "done",
      videoUrl,
      videoR2Key: result.finalR2Key,
    });
  }

  if (state === "failed") {
    return NextResponse.json({
      status: "error",
      message: job.failedReason ?? "Render failed.",
    });
  }

  const progress = job.progress;
  if (progress && typeof progress === "object" && "status" in (progress as Record<string, unknown>)) {
    return NextResponse.json(progress);
  }

  return NextResponse.json({ status: "rendering", rendered: 0, total: 0 });
}
