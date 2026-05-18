import { NextResponse } from "next/server";
import { requireBearerToken } from "@/lib/apiAuth";
import { supabase } from "@/lib/db/supabase";
import { jobsQueue } from "@/lib/queue/connection";
import type { JobProgress, JobStep } from "@/lib/queue/progress";

export const runtime = "nodejs";

export type JobProgressKind =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "missing";

export type ExternalJobProgressResponse = {
  kind: JobProgressKind;
  /** Average step progress, 0..100. 0 when queued; 100 when completed. */
  overallPercent: number;
  /** Index of the currently-active step, or null if not running. */
  currentStep: number | null;
  /** Per-step progress. Empty when queued/missing. */
  steps: JobStep[];
};

function averagePercent(steps: JobStep[]): number {
  if (steps.length === 0) return 0;
  const total = steps.reduce((sum, s) => sum + (s.progress ?? 0), 0);
  return Math.round(total / steps.length);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!requireBearerToken(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Render id → job id. We deliberately key the external API on render id
  // because that's the stable artifact ai-sales tracks; the BullMQ job id is
  // an internal detail that can be GC'd by Redis TTL.
  const { data: row, error: rowErr } = await supabase
    .from("vlad_renders")
    .select("job_id")
    .eq("id", id)
    .maybeSingle();

  if (rowErr) {
    return NextResponse.json({ error: rowErr.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "Render not found." }, { status: 404 });
  }
  if (!row.job_id) {
    // Cache-hit rows are inserted with status='done' and no job_id. The
    // caller will read terminal state from /api/external/renders/[id].
    return NextResponse.json({
      kind: "missing",
      overallPercent: 0,
      currentStep: null,
      steps: [],
    } satisfies ExternalJobProgressResponse);
  }

  const job = await jobsQueue.getJob(row.job_id);
  if (!job) {
    // BullMQ has no record — evicted from Redis or never reached the queue.
    return NextResponse.json({
      kind: "missing",
      overallPercent: 0,
      currentStep: null,
      steps: [],
    } satisfies ExternalJobProgressResponse);
  }

  const state = await job.getState();

  if (state === "completed") {
    return NextResponse.json({
      kind: "completed",
      overallPercent: 100,
      currentStep: null,
      steps: [],
    } satisfies ExternalJobProgressResponse);
  }

  if (state === "failed") {
    return NextResponse.json({
      kind: "failed",
      overallPercent: 0,
      currentStep: null,
      steps: [],
    } satisfies ExternalJobProgressResponse);
  }

  // Active / waiting / delayed — workers store JobProgress on the job directly.
  const raw = job.progress;
  if (raw && typeof raw === "object" && "status" in (raw as Record<string, unknown>)) {
    const p = raw as JobProgress;
    if (p.status === "running") {
      return NextResponse.json({
        kind: "running",
        overallPercent: averagePercent(p.steps),
        currentStep: p.currentStep,
        steps: p.steps,
      } satisfies ExternalJobProgressResponse);
    }
    if (p.status === "done") {
      return NextResponse.json({
        kind: "completed",
        overallPercent: 100,
        currentStep: null,
        steps: [],
      } satisfies ExternalJobProgressResponse);
    }
    if (p.status === "error") {
      return NextResponse.json({
        kind: "failed",
        overallPercent: 0,
        currentStep: null,
        steps: [],
      } satisfies ExternalJobProgressResponse);
    }
  }

  return NextResponse.json({
    kind: "queued",
    overallPercent: 0,
    currentStep: null,
    steps: [],
  } satisfies ExternalJobProgressResponse);
}
