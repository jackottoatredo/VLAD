import type { EngagementType } from "@/lib/stats/engagement";

// The six engagement event types we surface in Slack DMs (per-render
// stat lines + daily/weekly digests). Order is the display order.
export const STAT_DEFS: ReadonlyArray<{
  emoji: string;
  label: string;
  eventType: EngagementType;
}> = [
  { emoji: ":eyes:",                label: "visits",          eventType: "human_visit" },
  { emoji: ":movie_camera:",        label: "video plays",     eventType: "video_play" },
  { emoji: ":arrow_down:",          label: "downloads",       eventType: "asset_download" },
  { emoji: ":link:",                label: "link copies",     eventType: "click_copy_link" },
  { emoji: ":spiral_calendar_pad:", label: "booking clicks",  eventType: "click_book_demo" },
  { emoji: ":computer:",            label: "live demo opens", eventType: "click_interactive_demo" },
];

export const TRACKED_EVENT_TYPES: ReadonlyArray<EngagementType> =
  STAT_DEFS.map((s) => s.eventType);

// Render the six stat lines from an event-type-keyed count map.
// The caller owns the "Engagement Stats for …" heading and the trailing link.
export function formatStatLines(counts: Map<EngagementType, number>): string {
  return STAT_DEFS
    .map((s) => `${s.emoji} ${s.label}: ${counts.get(s.eventType) ?? 0}`)
    .join("\n");
}
