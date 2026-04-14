import { type ProduceResult } from "@/lib/render/produce";

type JobState =
  | { status: "rendering"; rendered: number; total: number }
  | { status: "compositing"; composited: number; total: number }
  | {
      status: "done";
      videoUrl: string;
      renderUrl: string;
      renderPath: string;
      renderDurationMs: number;
      compositeUrl: string;
      compositePath: string;
      trimmedUrl: string | null;
    }
  | { status: "error"; message: string };

const jobs = new Map<string, JobState>();

export function createJob(id: string): void {
  jobs.set(id, { status: "rendering", rendered: 0, total: 0 });
}

export function createJobAtStep(id: string, step: 1 | 2 | 3): void {
  if (step >= 2) {
    jobs.set(id, { status: "compositing", composited: 0, total: 0 });
  } else {
    jobs.set(id, { status: "rendering", rendered: 0, total: 0 });
  }
}

export function updateJobProgress(id: string, rendered: number, total: number): void {
  jobs.set(id, { status: "rendering", rendered, total });
}

export function startCompositing(id: string): void {
  jobs.set(id, { status: "compositing", composited: 0, total: 0 });
}

export function updateCompositingProgress(id: string, composited: number, total: number): void {
  jobs.set(id, { status: "compositing", composited, total });
}

export function completeJob(id: string, result: ProduceResult): void {
  jobs.set(id, {
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

export function failJob(id: string, message: string): void {
  jobs.set(id, { status: "error", message });
}

export function getJob(id: string): JobState | undefined {
  return jobs.get(id);
}
