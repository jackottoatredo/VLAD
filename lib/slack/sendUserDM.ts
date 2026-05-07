import { supabase } from "@/lib/db/supabase";

type SlackResponse = { ok: boolean; error?: string };
type LookupResponse = SlackResponse & { user?: { id: string } };
type PostMessageResponse = SlackResponse & { ts?: string; channel?: string };

const SLACK_API = "https://slack.com/api";

// Errors that mean "the recipient just isn't reachable" — not real failures.
// users_not_found = email not in workspace; cannot_dm_bot = user is a bot;
// channel_not_found can occur if the user disabled DMs from non-contacts.
const BENIGN_ERRORS = new Set([
  "users_not_found",
  "cannot_dm_bot",
  "channel_not_found",
]);

export type DMResult =
  | { status: "skipped"; reason: "missing_env" | "no_slack_user" | "benign"; slackError?: string }
  | { status: "sent"; ts: string; channel: string }
  | { status: "error"; slackError: string };

type SendArgs = {
  email: string;
  text: string;
  blocks?: unknown[];
  threadTs?: string;
};

// Resolve the recipient's Slack user ID, preferring the cached value on
// vlad_user_preferences. Falls back to users.lookupByEmail and writes the
// cache for next time.
async function resolveSlackUserId(
  email: string,
  token: string,
): Promise<{ id: string } | { error: string }> {
  const { data } = await supabase
    .from("vlad_user_preferences")
    .select("slack_user_id")
    .eq("user_id", email)
    .maybeSingle();
  const cached = (data as { slack_user_id?: string | null } | null)?.slack_user_id;
  if (cached) return { id: cached };

  const res = await fetch(
    `${SLACK_API}/users.lookupByEmail?email=${encodeURIComponent(email)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const body = (await res.json()) as LookupResponse;
  if (!body.ok || !body.user) {
    return { error: body.error ?? "unknown" };
  }

  void supabase
    .from("vlad_user_preferences")
    .update({ slack_user_id: body.user.id })
    .eq("user_id", email);

  return { id: body.user.id };
}

export async function sendUserDM({ email, text, blocks, threadTs }: SendArgs): Promise<DMResult> {
  const { SLACK_BOT_TOKEN } = process.env;
  if (!SLACK_BOT_TOKEN) {
    return { status: "skipped", reason: "missing_env" };
  }

  const lookup = await resolveSlackUserId(email, SLACK_BOT_TOKEN);
  if ("error" in lookup) {
    return BENIGN_ERRORS.has(lookup.error)
      ? { status: "skipped", reason: "no_slack_user", slackError: lookup.error }
      : { status: "error", slackError: lookup.error };
  }

  const postRes = await fetch(`${SLACK_API}/chat.postMessage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel: lookup.id,
      text,
      ...(blocks ? { blocks } : {}),
      ...(threadTs ? { thread_ts: threadTs } : {}),
      unfurl_links: false,
      unfurl_media: false,
    }),
  });
  const post = (await postRes.json()) as PostMessageResponse;
  if (post.ok && post.ts && post.channel) {
    // chat.update requires the *DM channel ID* (starts with D...), NOT the
    // user ID we passed to chat.postMessage. Slack auto-opens the DM and
    // returns the resulting channel id in `post.channel` — that's what
    // future chat.update calls must use. (Per docs.slack.dev — passing a
    // user ID to chat.update returns channel_not_found.)
    return { status: "sent", ts: post.ts, channel: post.channel };
  }
  const slackError = post.error ?? "unknown";
  return BENIGN_ERRORS.has(slackError)
    ? { status: "skipped", reason: "benign", slackError }
    : { status: "error", slackError };
}
