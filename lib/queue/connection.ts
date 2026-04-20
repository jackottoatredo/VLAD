import { Queue, type ConnectionOptions } from "bullmq";

function buildConnection(): ConnectionOptions {
  // Prefer REDIS_URL (Railway standard) — includes auth + host + port in one string
  if (process.env.REDIS_URL) {
    const url = new URL(process.env.REDIS_URL);
    return {
      host: url.hostname,
      port: Number(url.port || 6379),
      ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
      ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    };
  }
  // Fallback — individual env vars (local dev without REDIS_URL)
  return {
    host: process.env.REDIS_HOST ?? "127.0.0.1",
    port: Number(process.env.REDIS_PORT ?? 6379),
    ...(process.env.REDIS_PASSWORD ? { password: process.env.REDIS_PASSWORD } : {}),
    ...(process.env.REDIS_USERNAME ? { username: process.env.REDIS_USERNAME } : {}),
  };
}

export const REDIS_CONNECTION = buildConnection();

export const QUEUE_NAME = "jobs";

// Singleton queue instance — globalThis cache survives Next.js hot reload in dev
const g = globalThis as unknown as { __jobsQueue?: Queue };
export const jobsQueue = (g.__jobsQueue ??= new Queue(QUEUE_NAME, {
  connection: REDIS_CONNECTION,
}));
