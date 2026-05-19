import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireBearerToken } from "@/lib/apiAuth";
import { supabase } from "@/lib/db/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Single derived status returned by this endpoint. Computed from two sources:
 *   - CHOMP's live `/jobs?q=<domain>` lookup (in-flight signal)
 *   - The `previews` row in Supabase (post-sync result)
 *
 * `pending` covers both "CHOMP is actively scraping" and "CHOMP finished but
 * Supabase sync hasn't landed yet" — callers don't need to distinguish.
 * `failed` means CHOMP's latest job ended in failure AND the DB doesn't have
 * a usable preview row to fall back on.
 */
export type ScrapeStatus =
  | "complete"
  | "incomplete"
  | "pending"
  | "failed"
  | "not_scraped";

export type ChompJobStatus =
  | "queued"
  | "running"
  | "failed"
  | "completed"
  | "incomplete"
  | "cancelled";

export interface ChompJobSnapshot {
  id: string;
  status: ChompJobStatus;
  stage: string | null;
  progressPercent: number | null;
  startedAt: string | null;
  createdAt: string;
}

export interface MerchantScrapeResponse {
  status: ScrapeStatus;
  merchant: {
    id: string;
    brandName: string;
    websiteUrl: string;
    activityAt: string;
    featuredProductCount: number;
  } | null;
  // Kept for diagnostics — callers should drive UI from `status`.
  job: ChompJobSnapshot | null;
}

function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "")
    .split("/")[0];
}

const CHOMP_SCRAPE_CONFIG = {
  scraperBackend: "api",
  apiProvider: "firecrawl",
  apiScrapeMode: "full",
  firecrawlScreenshot: true,
  firecrawlScreenshotMode: "parallel",
  colorExtractionMode: "firecrawl",
  useLLM: true,
  useOCR: true,
  useHeroScoring: true,
  heroScoringMethod: "sharp-vision",
  rerunStep2IfNoProducts: true,
  useStoreleads: true,
  blockResources: true,
  skipMode: "none",
  useAmazon: false,
  useCache: true,
  endStep: 3,
  debug: false,
  maxProducts: 250,
  maxProductPages: 1,
  pageLoadTimeout: 60,
  extractorTimeout: 60,
  jobTimeout: 120000,
} as const;

const CHOMP_REQUEST_TIMEOUT_MS = 8000;
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Vlad-Build": "scrape-v2",
};

function chompBaseUrl(): string | null {
  const raw = process.env.CHOMP_API_URL?.replace(/\/+$/, "");
  return raw || null;
}

// CHOMP /jobs (list) requires admin scope; the public key can't see it. Fall
// back to the public key only if no admin key is configured (it won't work,
// but we don't want to crash — `fetchActiveChompJob` returns null on 401).
function chompAdminKey(): string | null {
  return process.env.CHOMP_API_KEY ?? process.env.CHOMP_API_KEY_PUBLIC ?? null;
}

function chompScrapeKey(): string | null {
  return process.env.CHOMP_API_KEY_PUBLIC ?? process.env.CHOMP_API_KEY ?? null;
}

interface ChompRawJob {
  id: string;
  url: string;
  status: ChompJobStatus;
  progress?: {
    stage?: string;
    extractorsCompleted?: unknown[];
    extractorsTotal?: unknown[];
  } | null;
  created_at?: string;
  createdAt?: string;
  started_at?: string | null;
  startedAt?: string | null;
}

function toJobSnapshot(raw: ChompRawJob): ChompJobSnapshot {
  const progress = raw.progress ?? null;
  const completed = Array.isArray(progress?.extractorsCompleted)
    ? progress.extractorsCompleted.length
    : 0;
  const total = Array.isArray(progress?.extractorsTotal)
    ? progress.extractorsTotal.length
    : 0;
  const progressPercent = total > 0 ? Math.round((completed / total) * 100) : null;
  return {
    id: raw.id,
    status: raw.status,
    stage: progress?.stage ?? null,
    progressPercent,
    startedAt: raw.startedAt ?? raw.started_at ?? null,
    createdAt: raw.createdAt ?? raw.created_at ?? "",
  };
}

async function fetchActiveChompJob(domain: string): Promise<ChompJobSnapshot | null> {
  const base = chompBaseUrl();
  const key = chompAdminKey();
  if (!base || !key) return null;

  try {
    const res = await fetch(`${base}/jobs?q=${encodeURIComponent(domain)}&limit=10`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(CHOMP_REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { jobs?: ChompRawJob[] } | null;
    const jobs = body?.jobs ?? [];
    const matching = jobs.filter((j) => normalizeDomain(j.url) === domain);
    if (matching.length === 0) return null;
    return toJobSnapshot(matching[0]);
  } catch {
    return null;
  }
}

async function readDbStatus(domain: string): Promise<
  | {
      status: "complete" | "incomplete" | "pending" | "not_scraped";
      merchant: MerchantScrapeResponse["merchant"];
    }
  | { error: string }
> {
  const { data, error } = await supabase
    .from("previews")
    .select(
      "id, website_url, data, enhancement_complete, last_edited_at, created_at",
    )
    .ilike("website_url", `%${domain}%`)
    .order("created_at", { ascending: false });

  if (error) return { error: error.message };

  type Row = {
    id: string;
    website_url: string;
    data: Record<string, unknown> | null;
    enhancement_complete: boolean | null;
    last_edited_at: string | null;
    created_at: string;
  };
  const rows = (data ?? []) as Row[];
  const exact = rows.find((r) => normalizeDomain(r.website_url) === domain);
  if (!exact) return { status: "not_scraped", merchant: null };

  const featuredCount = Array.isArray(exact.data?.featuredProducts)
    ? (exact.data.featuredProducts as unknown[]).length
    : 0;
  const status: "complete" | "incomplete" | "pending" = !exact.enhancement_complete
    ? "pending"
    : featuredCount >= 3
      ? "complete"
      : "incomplete";
  const brandName =
    typeof exact.data?.brandName === "string"
      ? (exact.data.brandName as string)
      : domain;

  return {
    status,
    merchant: {
      id: exact.id,
      brandName,
      websiteUrl: normalizeDomain(exact.website_url),
      activityAt: exact.last_edited_at ?? exact.created_at,
      featuredProductCount: featuredCount,
    },
  };
}

/**
 * Server-side status derivation. Order matters:
 *   1. Terminal DB state wins (an old `completed` CHOMP job in history can't
 *      force pending forever on an already-known brand).
 *   2. CHOMP job exists:
 *        a. `failed` → "failed" (latest attempt errored)
 *        b. `queued`/`running`/`completed`/`incomplete` → "pending"
 *           (covers in-flight + the sync-lag window between CHOMP marking a
 *           job complete and the previews row landing in Supabase)
 *        c. `cancelled` → fall through to DB
 *   3. Otherwise trust the DB.
 */
function deriveStatus(
  dbStatus: "complete" | "incomplete" | "pending" | "not_scraped",
  job: ChompJobSnapshot | null,
): ScrapeStatus {
  if (dbStatus === "complete" || dbStatus === "incomplete") return dbStatus;
  if (job) {
    if (job.status === "failed") return "failed";
    if (job.status !== "cancelled") return "pending";
  }
  return dbStatus;
}

async function buildResponse(
  domain: string,
): Promise<MerchantScrapeResponse | { error: string }> {
  const [db, job] = await Promise.all([readDbStatus(domain), fetchActiveChompJob(domain)]);
  if ("error" in db) return db;
  return { status: deriveStatus(db.status, job), merchant: db.merchant, job };
}

export async function GET(request: Request) {
  if (!requireBearerToken(request)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }
  const { searchParams } = new URL(request.url);
  const rawDomain = searchParams.get("domain")?.trim() ?? "";
  if (!rawDomain) {
    return NextResponse.json(
      { error: "Missing domain." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const domain = normalizeDomain(rawDomain);
  const result = await buildResponse(domain);
  if ("error" in result) {
    return NextResponse.json(
      { error: result.error },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
  return NextResponse.json(result, { headers: NO_STORE_HEADERS });
}

export async function POST(request: Request) {
  if (!requireBearerToken(request)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }
  let body: { domain?: unknown };
  try {
    body = (await request.json()) as { domain?: unknown };
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const rawDomain = typeof body.domain === "string" ? body.domain.trim() : "";
  if (!rawDomain) {
    return NextResponse.json(
      { error: "Missing domain." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const domain = normalizeDomain(rawDomain);
  if (!domain || !domain.includes(".")) {
    return NextResponse.json(
      { error: "Invalid domain." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const chompUrl = chompBaseUrl();
  const chompKey = chompScrapeKey();
  if (!chompUrl || !chompKey) {
    return NextResponse.json(
      { error: "Scraper not configured." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  const payload = { url: `https://${domain}`, ...CHOMP_SCRAPE_CONFIG };
  const payloadJson = JSON.stringify(payload);
  const idempotencyKey = createHash("sha256").update(payloadJson).digest("hex");

  let chompResponse: Response;
  try {
    chompResponse = await fetch(`${chompUrl}/scrape`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${chompKey}`,
        "Idempotency-Key": idempotencyKey,
      },
      body: payloadJson,
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to reach scraper: ${message}` },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }

  if (!chompResponse.ok) {
    const chompJson = await chompResponse.json().catch(() => null);
    return NextResponse.json(
      { error: "Scraper error", chomp: chompJson },
      { status: chompResponse.status, headers: NO_STORE_HEADERS },
    );
  }
  await chompResponse.json().catch(() => null);

  const result = await buildResponse(domain);
  if ("error" in result) {
    return NextResponse.json(
      { error: result.error },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
  return NextResponse.json(result, { status: 202, headers: NO_STORE_HEADERS });
}
