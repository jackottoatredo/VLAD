import { createHmac } from "node:crypto";

// HMAC-SHA256(ip, ENGAGEMENT_IP_SALT), truncated to 16 hex chars (64 bits).
//
// Salt rotation BREAKS unique-visitor counting across the boundary. Treat
// ENGAGEMENT_IP_SALT as a permanent key for the lifetime of the table.
// If you ever need to invalidate, rotate the table, not the salt.
//
// Dev fallback exists so local engagement events still log without env
// setup. Production code paths must set ENGAGEMENT_IP_SALT explicitly.

const DEV_FALLBACK_SALT = "dev-only-engagement-salt-not-for-prod";

let warned = false;

function getSalt(): string {
  const salt = process.env.ENGAGEMENT_IP_SALT;
  if (salt && salt.length > 0) return salt;
  if (process.env.NODE_ENV === "production") {
    if (!warned) {
      console.error(
        "[ipHash] ENGAGEMENT_IP_SALT is not set in production. " +
          "Engagement events will hash with a known fallback — set it now and treat existing rows as poisoned.",
      );
      warned = true;
    }
  }
  return DEV_FALLBACK_SALT;
}

export function hashIp(ip: string): string {
  return createHmac("sha256", getSalt()).update(ip).digest("hex").slice(0, 16);
}
