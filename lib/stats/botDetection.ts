// Categorize unfurl bots so the dashboard can show "where the link spread"
// (Slack vs LinkedIn vs Discord etc.). For uninteresting generic crawlers
// (Googlebot, headless Chrome, curl) we just bucket them as 'generic' so
// they can be filtered out — there's no value in classifying them further.

export type BotKind =
  | "slackbot"
  | "linkedinbot"
  | "twitterbot"
  | "discordbot"
  | "facebookexternalhit"
  | "whatsapp"
  | "telegram"
  | "generic";

const UNFURL_BOTS: { kind: BotKind; re: RegExp }[] = [
  { kind: "slackbot", re: /Slackbot|Slack-ImgProxy/i },
  { kind: "linkedinbot", re: /LinkedInBot/i },
  { kind: "twitterbot", re: /Twitterbot/i },
  { kind: "discordbot", re: /Discordbot/i },
  { kind: "facebookexternalhit", re: /facebookexternalhit|Facebot/i },
  { kind: "whatsapp", re: /WhatsApp/i },
  { kind: "telegram", re: /TelegramBot/i },
];

const GENERIC_BOT_RE = /bot|crawler|spider|headless|httpclient|curl\/|wget\/|python-requests/i;

export function detectBot(userAgent: string | null): {
  isBot: boolean;
  kind: BotKind | null;
} {
  if (!userAgent) return { isBot: false, kind: null };
  for (const { kind, re } of UNFURL_BOTS) {
    if (re.test(userAgent)) return { isBot: true, kind };
  }
  if (GENERIC_BOT_RE.test(userAgent)) return { isBot: true, kind: "generic" };
  return { isBot: false, kind: null };
}
