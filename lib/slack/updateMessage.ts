type SlackResponse = { ok: boolean; error?: string };

const SLACK_API = "https://slack.com/api";

// "Recoverable" errors — the parent message no longer exists or we lost
// permission to edit it. Caller should treat these as "fall back to a fresh
// chat.postMessage" rather than logging an error.
const GONE_ERRORS = new Set([
  "message_not_found",
  "channel_not_found",
  "cant_update_message",
]);

export type UpdateResult =
  | { status: "updated" }
  | { status: "gone"; slackError: string }
  | { status: "skipped"; reason: "missing_env" }
  | { status: "error"; slackError: string };

// Edit an existing chat.postMessage. `channel` is the same channel ID used
// at post time — for a DM that's the recipient's Slack user ID. `ts` is the
// message timestamp returned by the original chat.postMessage.
export async function updateUserMessage({
  channel,
  ts,
  text,
}: {
  channel: string;
  ts: string;
  text: string;
}): Promise<UpdateResult> {
  const { SLACK_BOT_TOKEN } = process.env;
  if (!SLACK_BOT_TOKEN) {
    return { status: "skipped", reason: "missing_env" };
  }

  const res = await fetch(`${SLACK_API}/chat.update`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel,
      ts,
      text,
      // chat.update with `text` only and no `blocks` clears any blocks
      // from the original message. Acceptable here — we don't use blocks.
    }),
  });
  const body = (await res.json()) as SlackResponse;
  if (body.ok) return { status: "updated" };
  const slackError = body.error ?? "unknown";
  return GONE_ERRORS.has(slackError)
    ? { status: "gone", slackError }
    : { status: "error", slackError };
}
