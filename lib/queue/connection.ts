import { Queue } from "bullmq";

export const REDIS_CONNECTION = {
  host: process.env.REDIS_HOST ?? "127.0.0.1",
  port: Number(process.env.REDIS_PORT ?? 6379),
};

export const QUEUE_NAME = "jobs";

// Singleton queue instance — globalThis cache survives Next.js hot reload in dev
const g = globalThis as unknown as { __jobsQueue?: Queue };
export const jobsQueue = (g.__jobsQueue ??= new Queue(QUEUE_NAME, {
  connection: REDIS_CONNECTION,
}));
