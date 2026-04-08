export type Keyframe = {
  t: number;                                        // ms from session start (normalized to t=0)
  x: number;
  y: number;
  event?: "click" | "keydown";   // absent on pure move keyframes
  key?: string;                  // populated when event === "keydown"
};

type RawEvent = {
  eventType: string;
  x: number;
  y: number;
  timestamp: number;
  key?: string;
};

export function recordingToKeyframes(events: ReadonlyArray<RawEvent>): Keyframe[] {
  if (events.length === 0) return [];

  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
  const t0 = sorted[0].timestamp;

  return sorted.map((e) => {
    const kf: Keyframe = { t: e.timestamp - t0, x: e.x, y: e.y };
    if (e.eventType === "click") {
      kf.event = "click";
    } else if (e.eventType === "keydown" && typeof e.key === "string") {
      kf.event = "keydown";
      kf.key = e.key;
    }
    return kf;
  });
}

export function interpolatePosition(
  keyframes: ReadonlyArray<Keyframe>,
  t: number
): { x: number; y: number } {
  if (keyframes.length === 0) return { x: 0, y: 0 };
  if (keyframes.length === 1 || t <= keyframes[0].t) {
    return { x: Math.round(keyframes[0].x), y: Math.round(keyframes[0].y) };
  }
  if (t >= keyframes[keyframes.length - 1].t) {
    const last = keyframes[keyframes.length - 1];
    return { x: Math.round(last.x), y: Math.round(last.y) };
  }

  // Binary search for the first keyframe with t > query t
  let lo = 0;
  let hi = keyframes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keyframes[mid].t <= t) lo = mid + 1;
    else hi = mid;
  }

  const prev = keyframes[lo - 1];
  const next = keyframes[lo];
  const alpha = (t - prev.t) / (next.t - prev.t);

  return {
    x: Math.round(prev.x + (next.x - prev.x) * alpha),
    y: Math.round(prev.y + (next.y - prev.y) * alpha),
  };
}

export function discreteEventsInWindow(
  keyframes: ReadonlyArray<Keyframe>,
  tStart: number,  // exclusive lower bound; pass -1 for frame 0
  tEnd: number     // inclusive upper bound
): Keyframe[] {
  return keyframes.filter((kf) => kf.event !== undefined && kf.t > tStart && kf.t <= tEnd);
}
