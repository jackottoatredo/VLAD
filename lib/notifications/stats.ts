import type { EngagementType } from "@/lib/stats/engagement";

export type StatDef = {
  emoji: string;
  label: string;
  eventType: EngagementType;
};

// 3x2 display grid — rows of three. Slack's section `fields` API is locked
// to a 2-column layout, so the per-render and digest DMs lay these out by
// hand: one section block per row, each rendering its three cells inline.
export const STAT_GRID: ReadonlyArray<ReadonlyArray<StatDef>> = [
  [
    { emoji: ":eyes:",                label: "visits",          eventType: "human_visit" },
    { emoji: ":movie_camera:",        label: "video plays",     eventType: "video_play" },
    { emoji: ":spiral_calendar_pad:", label: "booking clicks",  eventType: "click_book_demo" },
  ],
  [
    { emoji: ":arrow_down:",          label: "downloads",       eventType: "asset_download" },
    { emoji: ":link:",                label: "link copies",     eventType: "click_copy_link" },
    { emoji: ":computer:",            label: "live demo opens", eventType: "click_interactive_demo" },
  ],
];

// Flat list — used when iterating order doesn't matter (counts queries,
// fallback text formatting).
export const STAT_DEFS: ReadonlyArray<StatDef> = STAT_GRID.flat();

export const TRACKED_EVENT_TYPES: ReadonlyArray<EngagementType> =
  STAT_DEFS.map((s) => s.eventType);

// Plain-text fallback for Slack notification previews and screen readers.
// One stat per line — chat.postMessage `text` arg is just a fallback when
// blocks render, so dense layout doesn't matter here.
export function formatStatLines(counts: Map<EngagementType, number>): string {
  return STAT_DEFS
    .map((s) => `${s.emoji} ${s.label}: ${counts.get(s.eventType) ?? 0}`)
    .join("\n");
}

// Build the two `section` blocks (one per row of three) that render the
// stats grid in Slack. Each cell shows the emoji, bold count, and label —
// counts pop visually since they're the load-bearing data.
export function buildStatGridBlocks(counts: Map<EngagementType, number>): unknown[] {
  return STAT_GRID.map((row) => ({
    type: "section",
    text: {
      type: "mrkdwn",
      text: row
        .map((cell) => `${cell.emoji} *${counts.get(cell.eventType) ?? 0}* ${cell.label}`)
        .join("    ·    "),
    },
  }));
}
