This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

The homepage now includes a recording form:

- Enter a URL.
- Optional: adjust width, height, and FPS.
- Click **Record** to trigger `POST /api/record`.
- An MP4 is saved in `public/recordings` and previewed in the UI.

## Recording API

Endpoint: `POST /api/record`

Request body:

```json
{
	"url": "https://example.com",
	"width": 1280,
	"height": 720,
	"fps": 30,
	"durationMs": 1000,
	"waitUntil": "networkidle"
}
```

Notes:

- `durationMs` is currently fixed to 1000ms on the server.
- Total video duration is based on cumulative action runtime.
- The route runs on the Node.js runtime (`runtime = "nodejs"`).
- Recording uses a multi-action script (line, circle, form submit, returns-and-claims click).

## Action Chaining Contract

The recorder executes actions sequentially, and each action receives the prior action's end cursor.

1. Action receives `startCursor` (if one exists from a previous action).
2. Action performs movement/click/type while capturing frames.
3. Action returns its final cursor position; recorder passes it to the next action.

This cursor handoff prevents teleport-like jumps between chained actions.

## Local Setup Notes

Install dependencies before running if needed:

```bash
npm install
```

If Puppeteer fails to launch Chromium in your environment, install missing system dependencies for headless Chrome.

## Deployment Caveat

This flow is local-first. For Vercel, Puppeteer + ffmpeg workloads can run into execution and binary constraints. If this becomes unreliable in production, move recording to a dedicated worker/service and keep this endpoint as an orchestration layer.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
