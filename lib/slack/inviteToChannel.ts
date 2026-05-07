import { supabase } from "@/lib/db/supabase";

type SlackResponse = { ok: boolean; error?: string };
type LookupResponse = SlackResponse & { user?: { id: string } };

const SLACK_API = "https://slack.com/api";

// Errors that mean "no action needed" — already in channel, or not yet in
// workspace. Anything else (missing scope, channel not found, network) is
// surfaced via console.error.
const BENIGN_ERRORS = new Set(["already_in_channel", "users_not_found"]);

export async function inviteUserToVladChannel(email: string): Promise<void> {
  const { SLACK_BOT_TOKEN, SLACK_CHANNEL_VLAD_ID } = process.env;
  if (!SLACK_BOT_TOKEN || !SLACK_CHANNEL_VLAD_ID) return;

  try {
    const lookupRes = await fetch(
      `${SLACK_API}/users.lookupByEmail?email=${encodeURIComponent(email)}`,
      { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` } },
    );
    const lookup = (await lookupRes.json()) as LookupResponse;
    if (!lookup.ok || !lookup.user) {
      if (lookup.error && !BENIGN_ERRORS.has(lookup.error)) {
        console.error(`[slack-invite] lookup failed for ${email}: ${lookup.error}`);
      }
      return;
    }

    // Cache the Slack user ID on the prefs row so downstream DM helpers
    // can skip users.lookupByEmail. Fire-and-forget; failure here doesn't
    // affect the invite flow.
    void supabase
      .from("vlad_user_preferences")
      .update({ slack_user_id: lookup.user.id })
      .eq("user_id", email);

    const inviteRes = await fetch(`${SLACK_API}/conversations.invite`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel: SLACK_CHANNEL_VLAD_ID,
        users: lookup.user.id,
      }),
    });
    const invite = (await inviteRes.json()) as SlackResponse;
    if (invite.ok) {
      console.log(`[slack-invite] added ${email} to ${SLACK_CHANNEL_VLAD_ID}`);
    } else if (invite.error && !BENIGN_ERRORS.has(invite.error)) {
      console.error(`[slack-invite] invite failed for ${email}: ${invite.error}`);
    }
  } catch (err) {
    console.error(`[slack-invite] unexpected error for ${email}:`, err);
  }
}
