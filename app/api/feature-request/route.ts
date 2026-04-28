import { NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

export const runtime = "nodejs";

const MAX_LENGTH = 4000;

export async function POST(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { SLACK_BOT_TOKEN, SLACK_CHANNEL_VLAD_ID, SLACK_THREAD_REQUESTS_TS } = process.env;
  if (!SLACK_BOT_TOKEN || !SLACK_CHANNEL_VLAD_ID || !SLACK_THREAD_REQUESTS_TS) {
    return NextResponse.json({ error: "Slack is not configured." }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { text, pageUrl } = body as Record<string, unknown>;
  if (typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ error: "Missing feature description." }, { status: 400 });
  }
  const trimmed = text.trim().slice(0, MAX_LENGTH);

  const messageLines = [
    `*Feature request from* ${session.email}`,
    pageUrl && typeof pageUrl === "string" ? `*Page:* ${pageUrl}` : null,
    "",
    trimmed,
  ].filter(Boolean);

  const slackResponse = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel: SLACK_CHANNEL_VLAD_ID,
      thread_ts: SLACK_THREAD_REQUESTS_TS,
      text: messageLines.join("\n"),
      unfurl_links: false,
      unfurl_media: false,
    }),
  });

  const slackJson = (await slackResponse.json()) as { ok: boolean; error?: string };
  if (!slackJson.ok) {
    return NextResponse.json(
      { error: `Slack rejected the message: ${slackJson.error ?? "unknown_error"}` },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
