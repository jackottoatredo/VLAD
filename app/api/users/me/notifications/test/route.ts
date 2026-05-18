import { NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";
import { sendUserDM } from "@/lib/slack/sendUserDM";
import { buildEngagementUrl } from "@/lib/notifications/engagementUrl";
import { formatStatLines } from "@/lib/notifications/stats";
import { buildPerRenderBlocks } from "@/lib/notifications/renderNotification";
import {
  buildDigestBlocks,
  formatDigestHeading,
} from "@/lib/notifications/processDigest";
import { buildNewUserSignupText } from "@/lib/notifications/newUserSignup";
import { emailToName } from "@/lib/nameUtils";
import type { EngagementType } from "@/lib/stats/engagement";

export const runtime = "nodejs";

const TEST_KEYS = [
  "notify_visit",
  "notify_daily_digest",
  "notify_weekly_digest",
  "notify_new_user_signup",
] as const;
type TestKey = (typeof TEST_KEYS)[number];

// Keys only admins are allowed to test — same gate as the main toggle API.
const ADMIN_ONLY_TEST_KEYS = new Set<TestKey>(["notify_new_user_signup"]);

function isTestKey(s: unknown): s is TestKey {
  return typeof s === "string" && (TEST_KEYS as readonly string[]).includes(s);
}

// Sample counts that look plausible but obviously fake — picked so a rep
// can quickly see what each emoji + label means in the rendered message.
const SAMPLE_COUNTS = new Map<EngagementType, number>([
  ["human_visit", 12],
  ["video_play", 8],
  ["click_book_demo", 2],
  ["asset_download", 3],
  ["click_copy_link", 4],
  ["click_interactive_demo", 1],
]);

const SAMPLE_RENDER_NAME = "Sample render";

// Always-on test endpoint — fires a real Slack DM to the calling rep with
// dummy data so they can preview what each notification stream looks like
// before turning the toggle on. Independent of the toggle state.
export async function POST(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const { key } = (body ?? {}) as { key?: unknown };
  if (!isTestKey(key)) {
    return NextResponse.json({ error: "Invalid key." }, { status: 400 });
  }
  if (ADMIN_ONLY_TEST_KEYS.has(key) && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  // Filter URL points the rep at their own engagement dashboard so the
  // "View Stats" button works end-to-end in the sample.
  const viewUrl = buildEngagementUrl([
    { kind: "presenter", value: session.email, label: session.email },
  ]);

  let fallback: string;
  let blocks: unknown[] | undefined;
  if (key === "notify_visit") {
    fallback = `[TEST] ${formatStatLines(SAMPLE_COUNTS)}`;
    blocks = buildPerRenderBlocks({
      renderName: `[TEST] ${SAMPLE_RENDER_NAME}`,
      counts: SAMPLE_COUNTS,
      viewUrl,
    });
  } else if (
    key === "notify_daily_digest" ||
    key === "notify_weekly_digest"
  ) {
    fallback = `[TEST] ${formatStatLines(SAMPLE_COUNTS)}`;
    const window = key === "notify_daily_digest" ? "daily" : "weekly";
    const headingRange = `[TEST] ${formatDigestHeading(window)}`;
    blocks = buildDigestBlocks({ headingRange, counts: SAMPLE_COUNTS, viewUrl });
  } else {
    // notify_new_user_signup: send the admin a sample of the signup ping
    // using their own identity as the "new user" so they see the format.
    const { firstName, lastName } = emailToName(session.email);
    fallback = `[TEST] ${buildNewUserSignupText({
      email: session.email,
      firstName,
      lastName,
    })}`;
  }

  const result = await sendUserDM({
    email: session.email,
    text: fallback,
    ...(blocks ? { blocks } : {}),
  });
  if (result.status === "sent") {
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json(
    {
      ok: false,
      reason: result.status,
      slackError: "slackError" in result ? result.slackError : undefined,
    },
    { status: 502 },
  );
}
