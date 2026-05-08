import { NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";
import { supabase } from "@/lib/db/supabase";
import { jobsQueue } from "@/lib/queue/connection";

export const runtime = "nodejs";

export type RenderLogResponse = {
  renderId: string;
  jobId: string | null;
  status: string | null;
  // Per-job log lines collected via job.log() in the worker. Empty array
  // when the BullMQ job is no longer in Redis (eviction or never logged).
  logs: string[];
  failedReason: string | null;
  // Stack trace lines preserved by BullMQ across attempts. One entry per
  // attempt; index 0 is the most recent.
  stacktrace: string[];
  attemptsMade: number | null;
  // Reason the BullMQ job couldn't be loaded — distinguishes "job evicted
  // from Redis" from "render row had no job_id". null when the job was found.
  jobMissingReason: string | null;
};

/**
 * Admin-only fetch of the BullMQ per-job log + failure metadata for a render.
 *
 * Pulled by the recordings admin page when a row's status === "error". Logs
 * are populated by job.log() calls scattered through processProduceJob /
 * processMergeJob plus the worker.on("failed") handler that flushes the
 * stack trace as a final entry.
 *
 * Note: job retention is governed by the queue's removeOnFail setting in
 * lib/queue/connection.ts (currently age=7d). Past that, the BullMQ job is
 * gone from Redis and we return logs:[] with jobMissingReason populated —
 * the render row's status="error" stays in Supabase indefinitely.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  const { data: render, error } = await supabase
    .from("vlad_renders")
    .select("id, job_id, status")
    .eq("id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!render) return NextResponse.json({ error: "Render not found." }, { status: 404 });

  const empty = (jobMissingReason: string | null): RenderLogResponse => ({
    renderId: render.id,
    jobId: render.job_id,
    status: render.status,
    logs: [],
    failedReason: null,
    stacktrace: [],
    attemptsMade: null,
    jobMissingReason,
  });

  if (!render.job_id) {
    return NextResponse.json(empty("Render row has no job_id."));
  }

  const job = await jobsQueue.getJob(render.job_id);
  if (!job) {
    return NextResponse.json(
      empty("BullMQ job no longer in Redis (evicted past retention)."),
    );
  }

  // Pull all logs in one shot. End=-1 means "to the last entry"; per-job log
  // arrays for VLAD render jobs are short (tens of lines), so no pagination.
  const { logs } = await jobsQueue.getJobLogs(render.job_id, 0, -1, true);

  return NextResponse.json({
    renderId: render.id,
    jobId: render.job_id,
    status: render.status,
    logs,
    failedReason: job.failedReason ?? null,
    stacktrace: job.stacktrace ?? [],
    attemptsMade: job.attemptsMade ?? null,
    jobMissingReason: null,
  } satisfies RenderLogResponse);
}
