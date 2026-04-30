// Categorize the Referer header into a small set of buckets the dashboard
// can show as a donut. Direct = no Referer (typed URL, app deep-link, or
// privacy-stripped). Email = the link was clicked from a webmail provider.

export type ReferrerKind = "slack" | "linkedin" | "twitter" | "email" | "direct" | "other";

const HOST_KIND: { kind: ReferrerKind; hosts: string[] }[] = [
  { kind: "slack", hosts: ["slack.com", "app.slack.com"] },
  { kind: "linkedin", hosts: ["linkedin.com", "lnkd.in"] },
  { kind: "twitter", hosts: ["twitter.com", "x.com", "t.co"] },
  {
    kind: "email",
    hosts: [
      "mail.google.com",
      "outlook.live.com",
      "outlook.office.com",
      "outlook.office365.com",
      "mail.yahoo.com",
    ],
  },
];

function extractHost(referer: string): string | null {
  try {
    return new URL(referer).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function parseReferrer(referer: string | null): {
  host: string | null;
  kind: ReferrerKind;
} {
  if (!referer || referer.trim() === "") return { host: null, kind: "direct" };
  const host = extractHost(referer);
  if (!host) return { host: null, kind: "direct" };
  for (const { kind, hosts } of HOST_KIND) {
    if (hosts.some((h) => host === h || host.endsWith(`.${h}`))) {
      return { host, kind };
    }
  }
  return { host, kind: "other" };
}
