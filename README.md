# VLAD

**Video and Language Automations for Demos.**

A Next.js app for recording, editing, and exporting scripted browser demos. Playwright drives the page, a BullMQ worker renders frames with ffmpeg, and finished videos are stored in R2.

## Flows

- **Product Flow** — record, trim, preview, and save a product demo.
- **Merchant Flow** — record and save a merchant customization intro.
- **Merge & Export** — merge recordings and export final videos.

## Develop

```bash
npm install
npm run dev          # Next.js app
npm run worker:dev   # BullMQ render worker
```

Open http://localhost:3000.

## Stack

Next.js 16 · React 19 · Playwright · BullMQ + Redis · ffmpeg · Supabase · NextAuth · S3/R2.
