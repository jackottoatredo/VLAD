import type { EngagementType } from "@/lib/stats/engagement";

// Human-friendly past-tense verbs for engagement events. Used in the
// visit-summary thread reply.
export function describeEvent(type: EngagementType, payload: Record<string, unknown>): string {
  switch (type) {
    case "human_visit":
      return "opened the share";
    case "video_play":
      return "started the video";
    case "video_pause":
      return "paused the video";
    case "video_quartile": {
      const q = (payload as { q?: unknown }).q;
      if (q === 25 || q === 50 || q === 75) return `watched ${q}% of the video`;
      return "reached a video milestone";
    }
    case "video_end":
      return "finished the video";
    case "click_copy_link":
      return "copied the share link";
    case "click_book_demo":
      return "clicked Book a meeting";
    case "click_interactive_demo":
      return "opened the live demo";
    case "asset_download":
      return "downloaded an asset";
    case "bot_visit":
      return "(bot visit)";
  }
}

// "0:30", "1:12" — visit-relative MM:SS for the summary lines.
export function formatVisitOffset(eventAt: Date, visitStartedAt: Date): string {
  const seconds = Math.max(0, Math.round((eventAt.getTime() - visitStartedAt.getTime()) / 1000));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
