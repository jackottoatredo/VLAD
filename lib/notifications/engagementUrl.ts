import { APP_BASE_URL } from "@/app/config";

type FilterChip = { kind: string; value: string; label: string };

export function buildEngagementUrl(chips: FilterChip[]): string {
  const filters = { include: chips, exclude: [] };
  return `${APP_BASE_URL}/tools/engagement?filters=${encodeURIComponent(
    JSON.stringify(filters),
  )}`;
}
