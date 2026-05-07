import { APP_ENV, BETA_URL, PROD_URL } from "@/app/config";

// Internal app base URL — where /tools/* lives. Distinct from SHARE_BASE_URL
// (redo.com path-forwards /video-demos/* but not /tools/*). Used by Slack DMs
// to link reps back to the engagement dashboard.
function getInternalAppBaseUrl(): string {
  switch (APP_ENV) {
    case "prod":
      return PROD_URL.replace(/\/$/, "");
    case "beta":
      return BETA_URL.replace(/\/$/, "");
    default:
      return "http://localhost:3000";
  }
}

type FilterChip = { kind: string; value: string; label: string };

export function buildEngagementUrl(chips: FilterChip[]): string {
  const filters = { include: chips, exclude: [] };
  return `${getInternalAppBaseUrl()}/tools/engagement?filters=${encodeURIComponent(
    JSON.stringify(filters),
  )}`;
}
