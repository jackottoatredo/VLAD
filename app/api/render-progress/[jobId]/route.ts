import { NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";
import { jobsQueue } from "@/lib/queue/connection";
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
    return NextResponse.json({
      status: "done",
      videoUrl: result.finalUrl,
      renderUrl: result.renderUrl,
      renderPath: result.renderPath,
      renderDurationMs: result.renderDurationMs,
      compositeUrl: result.compositeUrl,
      compositePath: result.compositePath,
      trimmedUrl: result.trimmedUrl,
    });
  }

  if (state === "failed") {
    return NextResponse.json({
      status: "error",
      message: job.failedReason ?? "Render failed.",
    });
  }

  // Active or waiting — return progress
  const progress = job.progress;
  if (progress && typeof progress === "object" && "status" in (progress as Record<string, unknown>)) {
    return NextResponse.json(progress);
  }

  // Job is queued but hasn't started yet
  return NextResponse.json({ status: "rendering", rendered: 0, total: 0 });
}
