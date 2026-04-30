import { NextResponse } from "next/server";
import { supabase } from "@/lib/db/supabase";
import { requireSession } from "@/lib/apiAuth";
import { findProductLabel } from "@/lib/products";
import { MS_PER_DAY, dayKey, buildDateRange } from "@/lib/stats/dateRange";
import type { AdminUser } from "@/app/api/admin/users/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export type DauPoint = {
  date: string;
  returning: number;
  newUsers: number;
  // Emails of users active on this day, split by category. Lookup names in
  // the top-level `users` map of the response.
  returningEmails: string[];
  newEmails: string[];
};
export type ContentPoint = { date: string; intros: number; products: number; renders: number };
export type SuccessPoint = { date: string; completed: number; failed: number };
export type EfficiencyPoint = { date: string; ratio: number | null };
export type LeaderboardSeriesRow = {
  presenter: { email: string; firstName: string; lastName: string };
  // Per-day counts. Days the user had no activity are absent. Aligned to the
  // same date strings as the other series so the client can sum over any
  // window slice.
  days: { date: string; renders: number; intros: number; products: number }[];
};

export type ProductSeriesRow = {
  product: { key: string; name: string };
  days: { date: string; count: number }[];
};

export type ProductTotalRow = {
  product: { key: string; name: string };
  count: number;
};

export type UsageResponse = {
  // All series cover the last `seriesDays` days. Cards on the client pick
  // their own window (1..seriesDays) and slice locally.
  seriesDays: number;
  // Window-independent rolling counts (24h / 7d / 30d / forever).
  counts: { dau: number; wau: number; mau: number; allTime: number };
  // Content totals across all time (used by the "All time" toggle on the
  // content card so it is independent of the per-card window).
  contentTotalsAllTime: { intros: number; products: number; renders: number };
  dauSeries: DauPoint[];
  contentSeries: ContentPoint[];
  successRate: SuccessPoint[];
  efficiencyRatio: EfficiencyPoint[];
  leaderboardSeries: LeaderboardSeriesRow[];
  // Renders grouped by source product recording. Sourced from vlad_renders
  // (not the event log) so renders whose source recording was deleted show
  // up as "Unknown".
  productSeries: ProductSeriesRow[];
  // Truly all-time product totals (not capped at the 90d series window) so
  // the product pie's "All time" toggle is accurate.
  productTotalsAllTime: ProductTotalRow[];
  // Lookup map for any user email referenced anywhere in the response.
  users: AdminUser[];
};

type EventRow = {
  type: string;
  user_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
};

const SERIES_DAYS = 90;

export async function GET(request: Request) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const excludeUsers = new Set(
    (searchParams.get("excludeUsers") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const isExcluded = (userId: string | null) => userId != null && excludeUsers.has(userId);

  const since = new Date(Date.now() - SERIES_DAYS * MS_PER_DAY).toISOString();

  const { data: eventsData, error: eventsErr } = await supabase
    .from("vlad_event_log")
    .select("type, user_id, payload, created_at")
    .gte("created_at", since)
    .in("type", [
      "user_active",
      "recording_created",
      "render_completed",
      "render_failed",
    ])
    .order("created_at", { ascending: true });
  if (eventsErr) return NextResponse.json({ error: eventsErr.message }, { status: 500 });
  const allEvents = (eventsData ?? []) as EventRow[];
  // Filter once up front — every downstream aggregation just iterates `events`.
  const events =
    excludeUsers.size > 0
      ? allEvents.filter((e) => !isExcluded(e.user_id))
      : allEvents;

  // All-time user count.
  let usersQuery = supabase.from("vlad_users").select("id", { count: "exact", head: true });
  if (excludeUsers.size > 0) {
    usersQuery = usersQuery.not("id", "in", `(${[...excludeUsers].join(",")})`);
  }
  const { count: allTimeUsers } = await usersQuery;

  // All-time content totals — independent of the rolling window so the
  // client's "All time" toggle on the content card means truly all time.
  let recQuery = supabase.from("vlad_event_log").select("payload, user_id").eq("type", "recording_created");
  let renderCountQuery = supabase
    .from("vlad_event_log")
    .select("user_id", { count: "exact" })
    .eq("type", "render_completed");
  if (excludeUsers.size > 0) {
    const list = `(${[...excludeUsers].join(",")})`;
    recQuery = recQuery.not("user_id", "in", list);
    renderCountQuery = renderCountQuery.not("user_id", "in", list);
  }
  const [allRecordings, allRenders] = await Promise.all([recQuery, renderCountQuery]);
  let allTimeIntros = 0;
  let allTimeProducts = 0;
  for (const r of (allRecordings.data ?? []) as { payload: Record<string, unknown> | null }[]) {
    const kind = r.payload?.kind;
    if (kind === "intro") allTimeIntros++;
    else if (kind === "product") allTimeProducts++;
  }
  const contentTotalsAllTime = {
    intros: allTimeIntros,
    products: allTimeProducts,
    renders: allRenders.count ?? 0,
  };

  const range = buildDateRange(SERIES_DAYS);

  // ---- DAU series, split into new vs returning ----
  // "Active that day" = any user-bearing event that day (user_active,
  // recording_created, render_*). Using all events instead of just
  // user_active makes the chart robust against missing heartbeats / partial
  // backfills.
  //
  // "New" is all-time first-ever activity: a user is new on day D iff
  //   - they had any event on D, AND
  //   - they had no event on any earlier day, ever.
  // We compute that with a single "did this user have any event before
  // `since`?" query — anyone in that set is always returning. For the rest,
  // their earliest in-window event day is "new", every later day is
  // "returning".
  let priorAnyQuery = supabase
    .from("vlad_event_log")
    .select("user_id")
    .lt("created_at", since)
    .not("user_id", "is", null)
    .limit(50000);
  if (excludeUsers.size > 0) {
    priorAnyQuery = priorAnyQuery.not(
      "user_id",
      "in",
      `(${[...excludeUsers].join(",")})`,
    );
  }
  const { data: priorAnyData } = await priorAnyQuery;
  const existedBefore = new Set(
    ((priorAnyData ?? []) as { user_id: string | null }[])
      .map((r) => r.user_id)
      .filter((v): v is string => typeof v === "string"),
  );

  const usersByDay = new Map<string, Set<string>>();
  const firstInWindow = new Map<string, string>();
  for (const e of events) {
    if (!e.user_id) continue;
    const day = dayKey(e.created_at);
    let set = usersByDay.get(day);
    if (!set) {
      set = new Set();
      usersByDay.set(day, set);
    }
    set.add(e.user_id);
    const prevFirst = firstInWindow.get(e.user_id);
    if (!prevFirst || day < prevFirst) firstInWindow.set(e.user_id, day);
  }

  const dauSeries: DauPoint[] = range.map((date) => {
    const users = usersByDay.get(date);
    if (!users) return { date, returning: 0, newUsers: 0, returningEmails: [], newEmails: [] };
    const returningEmails: string[] = [];
    const newEmails: string[] = [];
    for (const uid of users) {
      const isFirstHere = firstInWindow.get(uid) === date;
      if (isFirstHere && !existedBefore.has(uid)) newEmails.push(uid);
      else returningEmails.push(uid);
    }
    return {
      date,
      returning: returningEmails.length,
      newUsers: newEmails.length,
      returningEmails,
      newEmails,
    };
  });

  // ---- Rolling counts (window-independent) ----
  // Same "any user-bearing event" definition as the DAU bar chart.
  const now = Date.now();
  const dauUsers = new Set<string>();
  const wauUsers = new Set<string>();
  const mauUsers = new Set<string>();
  for (const e of events) {
    if (!e.user_id) continue;
    const ageDays = (now - new Date(e.created_at).getTime()) / MS_PER_DAY;
    if (ageDays <= 1) dauUsers.add(e.user_id);
    if (ageDays <= 7) wauUsers.add(e.user_id);
    if (ageDays <= 30) mauUsers.add(e.user_id);
  }

  // ---- Content series ----
  const contentByDay = new Map<string, { intros: number; products: number; renders: number }>();
  for (const e of events) {
    const day = dayKey(e.created_at);
    let bucket = contentByDay.get(day);
    if (!bucket) {
      bucket = { intros: 0, products: 0, renders: 0 };
      contentByDay.set(day, bucket);
    }
    if (e.type === "recording_created") {
      const kind = (e.payload?.kind as string | undefined) ?? "";
      if (kind === "intro") bucket.intros++;
      else if (kind === "product") bucket.products++;
    } else if (e.type === "render_completed") {
      bucket.renders++;
    }
  }
  const contentSeries: ContentPoint[] = range.map((date) => ({
    date,
    intros: contentByDay.get(date)?.intros ?? 0,
    products: contentByDay.get(date)?.products ?? 0,
    renders: contentByDay.get(date)?.renders ?? 0,
  }));

  // ---- Success rate ----
  const successByDay = new Map<string, { completed: number; failed: number }>();
  for (const e of events) {
    if (e.type !== "render_completed" && e.type !== "render_failed") continue;
    const day = dayKey(e.created_at);
    let bucket = successByDay.get(day);
    if (!bucket) {
      bucket = { completed: 0, failed: 0 };
      successByDay.set(day, bucket);
    }
    if (e.type === "render_completed") bucket.completed++;
    else bucket.failed++;
  }
  const successRate: SuccessPoint[] = range.map((date) => ({
    date,
    completed: successByDay.get(date)?.completed ?? 0,
    failed: successByDay.get(date)?.failed ?? 0,
  }));

  // ---- Efficiency ratio ----
  const ratioByDay = new Map<string, { sum: number; count: number }>();
  for (const e of events) {
    if (e.type !== "render_completed") continue;
    const ms = e.payload?.renderDurationMs;
    const sec = e.payload?.videoLengthSec;
    if (typeof ms !== "number" || typeof sec !== "number" || sec <= 0) continue;
    const day = dayKey(e.created_at);
    const ratio = ms / 1000 / sec;
    let bucket = ratioByDay.get(day);
    if (!bucket) {
      bucket = { sum: 0, count: 0 };
      ratioByDay.set(day, bucket);
    }
    bucket.sum += ratio;
    bucket.count++;
  }
  const efficiencyRatio: EfficiencyPoint[] = range.map((date) => {
    const bucket = ratioByDay.get(date);
    return { date, ratio: bucket && bucket.count > 0 ? bucket.sum / bucket.count : null };
  });

  // ---- Leaderboard series — per-user per-day counts ----
  type Daily = { renders: number; intros: number; products: number };
  const userDay = new Map<string, Map<string, Daily>>();
  function bucket(userId: string, day: string): Daily {
    let perDay = userDay.get(userId);
    if (!perDay) {
      perDay = new Map();
      userDay.set(userId, perDay);
    }
    let b = perDay.get(day);
    if (!b) {
      b = { renders: 0, intros: 0, products: 0 };
      perDay.set(day, b);
    }
    return b;
  }
  for (const e of events) {
    if (!e.user_id) continue;
    const day = dayKey(e.created_at);
    if (e.type === "render_completed") bucket(e.user_id, day).renders++;
    else if (e.type === "recording_created") {
      const kind = (e.payload?.kind as string | undefined) ?? "";
      if (kind === "intro") bucket(e.user_id, day).intros++;
      else if (kind === "product") bucket(e.user_id, day).products++;
    }
  }

  // Single user-info lookup. Pulls everyone (minus excluded) so the client
  // can resolve names for the DAU per-day lists, the leaderboard, etc.
  let allUsersQuery = supabase
    .from("vlad_users")
    .select("id, first_name, last_name");
  if (excludeUsers.size > 0) {
    allUsersQuery = allUsersQuery.not(
      "id",
      "in",
      `(${[...excludeUsers].join(",")})`,
    );
  }
  const { data: allUsersData } = await allUsersQuery;
  const userInfoByEmail = new Map<string, { first_name: string; last_name: string }>();
  for (const u of (allUsersData ?? []) as { id: string; first_name: string; last_name: string }[]) {
    userInfoByEmail.set(u.id, { first_name: u.first_name, last_name: u.last_name });
  }
  const usersList: AdminUser[] = (allUsersData ?? []).map((u) => ({
    email: u.id as string,
    firstName: ((u as { first_name?: string }).first_name) ?? "",
    lastName: ((u as { last_name?: string }).last_name) ?? "",
  }));

  const userIds = [...userDay.keys()];
  const leaderboardSeries: LeaderboardSeriesRow[] = userIds.map((email) => {
    const u = userInfoByEmail.get(email);
    const days: LeaderboardSeriesRow["days"] = [];
    const perDay = userDay.get(email)!;
    for (const [date, tally] of perDay) {
      days.push({ date, ...tally });
    }
    return {
      presenter: {
        email,
        firstName: u?.first_name ?? "",
        lastName: u?.last_name ?? "",
      },
      days,
    };
  });

  // ---- Product breakdown — group renders by *product* (e.g.
  // "returns-claims"), not by source recording. Each user typically has
  // multiple recordings of the same product, so we bucket on
  // vlad_recordings.product_name (the safe key) and resolve a display label
  // via the PRODUCTS catalog. Renders whose source recording was deleted
  // (FK set null) or whose product_name doesn't match a known product
  // bucket into "Unknown". ----
  type RenderRow = {
    user_id: string | null;
    created_at: string;
    vlad_recordings: { product_name: string | null } | null;
  };
  let rendersQuery = supabase
    .from("vlad_renders")
    .select("user_id, created_at, vlad_recordings:product_recording_id(product_name)")
    .eq("status", "done")
    .gte("created_at", since);
  if (excludeUsers.size > 0) {
    rendersQuery = rendersQuery.not("user_id", "in", `(${[...excludeUsers].join(",")})`);
  }
  const { data: rendersData } = await rendersQuery;

  const productMap = new Map<string, { name: string; days: Map<string, number> }>();
  for (const r of (rendersData ?? []) as unknown as RenderRow[]) {
    const safe = r.vlad_recordings?.product_name ?? null;
    const key = safe ?? "_unknown";
    const name = safe ? findProductLabel(safe) ?? safe : "Unknown";
    let bucket = productMap.get(key);
    if (!bucket) {
      bucket = { name, days: new Map() };
      productMap.set(key, bucket);
    }
    const day = dayKey(r.created_at);
    bucket.days.set(day, (bucket.days.get(day) ?? 0) + 1);
  }
  const productSeries: ProductSeriesRow[] = [...productMap.entries()].map(
    ([key, { name, days }]) => ({
      product: { key, name },
      days: [...days.entries()].map(([date, count]) => ({ date, count })),
    }),
  );

  // Truly all-time per-product totals (no date filter on vlad_renders) so
  // the product pie's "All time" toggle isn't capped at the 90d window.
  let allRendersQuery = supabase
    .from("vlad_renders")
    .select("vlad_recordings:product_recording_id(product_name)")
    .eq("status", "done");
  if (excludeUsers.size > 0) {
    allRendersQuery = allRendersQuery.not(
      "user_id",
      "in",
      `(${[...excludeUsers].join(",")})`,
    );
  }
  const { data: allRendersData } = await allRendersQuery;
  type AllRenderRow = { vlad_recordings: { product_name: string | null } | null };
  const productTotalsMap = new Map<string, { name: string; count: number }>();
  for (const r of (allRendersData ?? []) as unknown as AllRenderRow[]) {
    const safe = r.vlad_recordings?.product_name ?? null;
    const key = safe ?? "_unknown";
    const name = safe ? findProductLabel(safe) ?? safe : "Unknown";
    const bucket = productTotalsMap.get(key);
    if (bucket) bucket.count++;
    else productTotalsMap.set(key, { name, count: 1 });
  }
  const productTotalsAllTime: ProductTotalRow[] = [...productTotalsMap.entries()].map(
    ([key, { name, count }]) => ({ product: { key, name }, count }),
  );

  const response: UsageResponse = {
    seriesDays: SERIES_DAYS,
    counts: {
      dau: dauUsers.size,
      wau: wauUsers.size,
      mau: mauUsers.size,
      allTime: allTimeUsers ?? 0,
    },
    contentTotalsAllTime,
    dauSeries,
    contentSeries,
    successRate,
    efficiencyRatio,
    leaderboardSeries,
    productSeries,
    productTotalsAllTime,
    users: usersList,
  };

  return NextResponse.json(response);
}
