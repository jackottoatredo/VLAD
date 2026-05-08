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
    { emoji: ":eyes:",                label: "page visits",        eventType: "human_visit" },
    { emoji: ":movie_camera:",        label: "video plays",        eventType: "video_play" },
    { emoji: ":spiral_calendar_pad:", label: "meetings scheduled", eventType: "click_book_demo" },
  ],
  [
    { emoji: ":arrow_down:",          label: "downloads",       eventType: "asset_download" },
    { emoji: ":link:",                label: "links copied",    eventType: "click_copy_link" },
    { emoji: ":computer:",            label: "previews opened", eventType: "click_interactive_demo" },
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

// Build a single markdown block containing the title (as an H3 heading,
// rendered full-width) followed by the 6x2 pipe table. Markdown tables
// don't support column spanning, so the heading is the workaround for a
// "header that spans both columns".
export function buildStatGridBlocks(
  counts: Map<EngagementType, number>,
  title: string,
): unknown[] {
  const lines: string[] = [
    `### ${title}`,
    ``,
    `| Metric | Count |`,
    `| --- | --- |`,
    ...STAT_DEFS.map((s) => `| ${s.emoji} ${s.label} | **${counts.get(s.eventType) ?? 0}** |`),
  ];
  return [
    {
      type: "markdown",
      text: lines.join("\n"),
    },
  ];
}
