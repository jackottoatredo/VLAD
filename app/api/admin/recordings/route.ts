import { NextResponse } from "next/server";
import { supabase } from "@/lib/db/supabase";
import { requireSession } from "@/lib/apiAuth";

export const runtime = "nodejs";

export type AdminRecordingRow = {
  id: string;
  kind: "intro" | "product" | "render";
  presenter: { email: string; firstName: string; lastName: string };
  label: string;
  videoUrl: string | null;
  slug: string | null;
  trimStartSec: number | null;
  trimEndSec: number | null;
  createdAt: string;
};

type ParsedFilter = {
  kinds: Set<"intro" | "product" | "render"> | null;
  presenter: string | null;
  after: string | null;
  before: string | null;
  freeText: string | null;
};

const KIND_VALUES = new Set(["intro", "product", "render"] as const);

function parseFilter(raw: string | null): ParsedFilter {
  const kinds = new Set<"intro" | "product" | "render">();
  let presenter: string | null = null;
  let after: string | null = null;
  let before: string | null = null;
  const free: string[] = [];

  if (raw) {
    for (const tok of raw.split(/\s+/).filter(Boolean)) {
      const colon = tok.indexOf(":");
      if (colon === -1) {
        free.push(tok);
        continue;
      }
      const field = tok.slice(0, colon).toLowerCase();
      const value = tok.slice(colon + 1);
      if (!value) continue;

      if (field === "type" || field === "kind") {
        const v = value.toLowerCase();
        if (KIND_VALUES.has(v as "intro" | "product" | "render")) {
          kinds.add(v as "intro" | "product" | "render");
        }
      } else if (field === "presenter" || field === "user") {
        presenter = value.replace(/[,():%]/g, "");
      } else if (field === "after" || field === "since" || field === "from") {
        if (/^[\d\-T:.Z+]+$/.test(value)) after = value;
      } else if (field === "before" || field === "until" || field === "to") {
        if (/^[\d\-T:.Z+]+$/.test(value)) before = value;
      } else {
        free.push(tok);
      }
    }
  }

  // Strip characters that conflict with PostgREST's `.or()` filter grammar
  // (`,`, `(`, `)`, `:`, `%`) — admin tool, not a search engine, so a coarse
  // sanitize is fine.
  const freeJoined = free.join(" ").replace(/[,():%]/g, " ").trim();

  return {
    kinds: kinds.size > 0 ? kinds : null,
    presenter,
    after,
    before,
    freeText: freeJoined.length > 0 ? freeJoined : null,
  };
}

const RECORDINGS_FIELDS =
  "id, user_id, type, name, product_name, merchant_id, preview_url, metadata, created_at, vlad_users(first_name, last_name)";
const RENDERS_FIELDS =
  "id, user_id, brand, brand_name, video_url, slug, created_at, vlad_users(first_name, last_name)";

type RecordingDbRow = {
  id: string;
  user_id: string;
  type: "product" | "merchant";
  name: string;
  product_name: string | null;
  merchant_id: string | null;
  preview_url: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  vlad_users: { first_name: string; last_name: string } | null;
};

type RenderDbRow = {
  id: string;
  user_id: string;
  brand: string | null;
  brand_name: string | null;
  video_url: string | null;
  slug: string | null;
  created_at: string;
  vlad_users: { first_name: string; last_name: string } | null;
};

function presenterFor(
  email: string,
  user: { first_name: string; last_name: string } | null,
): AdminRecordingRow["presenter"] {
  return {
    email,
    firstName: user?.first_name ?? "",
    lastName: user?.last_name ?? "",
  };
}

function recordingToRow(r: RecordingDbRow): AdminRecordingRow {
  const meta = r.metadata ?? {};
  const trimStart = typeof meta.trimStartSec === "number" ? meta.trimStartSec : null;
  const trimEnd = typeof meta.trimEndSec === "number" ? meta.trimEndSec : null;
  return {
    id: r.id,
    kind: r.type === "merchant" ? "intro" : "product",
    presenter: presenterFor(r.user_id, r.vlad_users),
    label: r.name ?? r.product_name ?? r.merchant_id ?? r.id.slice(0, 8),
    videoUrl: r.preview_url,
    slug: null,
    trimStartSec: trimStart,
    trimEndSec: trimEnd,
    createdAt: r.created_at,
  };
}

function renderToRow(r: RenderDbRow): AdminRecordingRow {
  return {
    id: r.id,
    kind: "render",
    presenter: presenterFor(r.user_id, r.vlad_users),
    label: r.brand_name ?? r.brand ?? r.id.slice(0, 8),
    videoUrl: r.video_url,
    slug: r.slug,
    trimStartSec: null,
    trimEndSec: null,
    createdAt: r.created_at,
  };
}

export async function GET(request: Request) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const filter = parseFilter(searchParams.get("q"));

  const wantRecordings =
    !filter.kinds || filter.kinds.has("intro") || filter.kinds.has("product");
  const wantRenders = !filter.kinds || filter.kinds.has("render");

  const recordings: AdminRecordingRow[] = [];
  const renders: AdminRecordingRow[] = [];

  if (wantRecordings) {
    let q = supabase
      .from("vlad_recordings")
      .select(RECORDINGS_FIELDS)
      .order("created_at", { ascending: false });

    if (filter.kinds) {
      const dbTypes: ("product" | "merchant")[] = [];
      if (filter.kinds.has("intro")) dbTypes.push("merchant");
      if (filter.kinds.has("product")) dbTypes.push("product");
      q = q.in("type", dbTypes);
    }
    if (filter.presenter) q = q.ilike("user_id", `%${filter.presenter}%`);
    if (filter.after) q = q.gte("created_at", filter.after);
    if (filter.before) q = q.lte("created_at", filter.before);
    if (filter.freeText) {
      const t = `%${filter.freeText}%`;
      q = q.or(`name.ilike.${t},product_name.ilike.${t}`);
    }

    const { data, error } = await q.limit(200);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const r of (data ?? []) as unknown as RecordingDbRow[]) recordings.push(recordingToRow(r));
  }

  if (wantRenders) {
    let q = supabase
      .from("vlad_renders")
      .select(RENDERS_FIELDS)
      .eq("status", "done")
      .order("created_at", { ascending: false });

    if (filter.presenter) q = q.ilike("user_id", `%${filter.presenter}%`);
    if (filter.after) q = q.gte("created_at", filter.after);
    if (filter.before) q = q.lte("created_at", filter.before);
    if (filter.freeText) {
      const t = `%${filter.freeText}%`;
      q = q.or(`brand.ilike.${t},brand_name.ilike.${t}`);
    }

    const { data, error } = await q.limit(200);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const r of (data ?? []) as unknown as RenderDbRow[]) renders.push(renderToRow(r));
  }

  const rows = [...recordings, ...renders].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
  );

  return NextResponse.json({ rows });
}
