import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { TARGET_URL, DEFAULT_FPS } from "@/app/config";
import { eventsToKeyframes } from "@/lib/render/keyframes";
import { createReplayAction } from "@/lib/render/actions";
import { produceSessionVideo } from "@/lib/render/produce";
import { createJob, updateJobProgress, startCompositing, updateCompositingProgress, completeJob, failJob } from "@/lib/render/job-store";

export const runtime = "nodejs";

const PUBLIC_DIR = path.join(process.cwd(), "public");

type RenderSessionBody = {
  session?: unknown;
  presenter?: unknown;
};

export async function POST(request: Request) {
  let body: RenderSessionBody;

  try {
    body = (await request.json()) as RenderSessionBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body." }, { status: 400 });
  }

  if (typeof body.session !== "string" || !body.session.trim()) {
    return NextResponse.json({ error: "Missing session name." }, { status: 400 });
  }
  if (typeof body.presenter !== "string" || !body.presenter.trim()) {
    return NextResponse.json({ error: "Missing presenter." }, { status: 400 });
  }

  const safeName = body.session.replace(/[^a-z0-9_\-]/gi, "_");
  const safePresenter = body.presenter.replace(/[^a-z0-9_\-]/gi, "_");
  const filePath = path.join(PUBLIC_DIR, "users", safePresenter, safeName, "recordings", `${safeName}_mouse.json`);

  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  let data: { events?: unknown; virtualWidth?: unknown; virtualHeight?: unknown };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    return NextResponse.json({ error: "Session file is corrupt." }, { status: 500 });
  }

  if (!Array.isArray(data.events) || typeof data.virtualWidth !== "number" || typeof data.virtualHeight !== "number") {
    return NextResponse.json({ error: "Session file is missing required fields." }, { status: 400 });
  }

  const keyframes = eventsToKeyframes(data.events as Parameters<typeof eventsToKeyframes>[0]);
  const durationMs = keyframes.length > 0 ? keyframes[keyframes.length - 1].t : 1000;
  const replayAction = createReplayAction(keyframes, durationMs);

  const jobId = randomUUID().slice(0, 8);
  createJob(jobId);

  // Fire and forget — progress is tracked via job-store
  produceSessionVideo({
    url: TARGET_URL,
    presenter: safePresenter,
    sessionName: safeName,
    width: data.virtualWidth,
    height: data.virtualHeight,
    fps: DEFAULT_FPS,
    durationMs,
    actions: [replayAction],
    onRenderProgress: (rendered, total) => updateJobProgress(jobId, rendered, total),
    onRenderComplete: () => startCompositing(jobId),
    onComposeProgress: (step, total) => updateCompositingProgress(jobId, step, total),
  })
    .then((result) => completeJob(jobId, result.videoUrl))
    .catch((error: unknown) => {
      console.error("Produce session failed", error);
      failJob(jobId, error instanceof Error ? error.message : "Render failed.");
    });

  return NextResponse.json({ jobId });
}
