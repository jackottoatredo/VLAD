/** Progress shapes stored via job.updateProgress() in Redis. */

export type ProduceProgress =
  | { status: "rendering"; rendered: number; total: number }
  | { status: "compositing"; composited: number; total: number };

export type MergeJobProgress = {
  status: "running";
  currentStep: number;
  stepProgress: number[];
  stepLabels: string[];
};
