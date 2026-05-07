// Server-only HubSpot helpers. Reads HUBSPOT_SERVICE_KEY from env and uses
// it as a Bearer token — same wire format as legacy Private App tokens, so
// nothing here changes if we ever swap credential types. Throws HubSpotError
// on non-2xx so callers can surface scope/auth issues distinctly.

const BASE = "https://api.hubapi.com";

export type HubSpotMeetingLink = {
  id: string;
  name: string;
  slug: string;
  link: string;
  type: string;
  organizerUserId: string;
  defaultLink: boolean;
};

export class HubSpotError extends Error {
  status: number;
  // True for 401/403 — the Service Key is missing or lacks the required
  // scope. Settings UI surfaces a different message in this case.
  isAuth: boolean;
  constructor(status: number, message: string) {
    super(message);
    this.name = "HubSpotError";
    this.status = status;
    this.isAuth = status === 401 || status === 403;
  }
}

function token(): string {
  const t = process.env.HUBSPOT_SERVICE_KEY;
  if (!t) throw new HubSpotError(500, "HUBSPOT_SERVICE_KEY is not set");
  return t;
}

async function hubspotFetch(path: string): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
}

// Resolve a HubSpot user's id from their email. Returns null on 404
// (no HubSpot user with that email — e.g. the rep doesn't have a seat).
export async function lookupUserIdByEmail(email: string): Promise<string | null> {
  const res = await hubspotFetch(
    `/settings/v3/users/${encodeURIComponent(email)}?idProperty=EMAIL`,
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new HubSpotError(res.status, `lookupUserIdByEmail failed: ${await res.text()}`);
  }
  const data = (await res.json()) as { id?: unknown };
  return typeof data.id === "string" ? data.id : null;
}

// List all meeting links owned by a HubSpot user. Returns [] when the
// user has no scheduling pages set up.
export async function listMeetingLinks(
  organizerUserId: string,
): Promise<HubSpotMeetingLink[]> {
  const res = await hubspotFetch(
    `/scheduler/v3/meetings/meeting-links?organizerUserId=${encodeURIComponent(organizerUserId)}`,
  );
  if (!res.ok) {
    throw new HubSpotError(res.status, `listMeetingLinks failed: ${await res.text()}`);
  }
  const data = (await res.json()) as { results?: unknown };
  if (!Array.isArray(data.results)) return [];
  const links = data.results
    .map((raw): HubSpotMeetingLink | null => {
      const r = raw as Record<string, unknown>;
      const id = typeof r.id === "string" ? r.id : null;
      const name = typeof r.name === "string" ? r.name : null;
      const slug = typeof r.slug === "string" ? r.slug : null;
      const link = typeof r.link === "string" ? r.link : null;
      const type = typeof r.type === "string" ? r.type : "";
      const defaultLink = r.defaultLink === true;
      const orgId =
        typeof r.organizerUserId === "string"
          ? r.organizerUserId
          : typeof r.organizerUserId === "number"
            ? String(r.organizerUserId)
            : "";
      if (!id || !name || !slug || !link) return null;
      return { id, name, slug, link, type, organizerUserId: orgId, defaultLink };
    })
    .filter((x): x is HubSpotMeetingLink => x !== null);
  // Default link first, then alphabetical by name. The settings dropdown
  // surfaces results in this order without further sorting.
  links.sort((a, b) => {
    if (a.defaultLink !== b.defaultLink) return a.defaultLink ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return links;
}
