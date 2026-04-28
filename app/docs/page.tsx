import type { ReactNode } from 'react'
import Link from 'next/link'
import Infographic from '@/app/components/Infographic'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="space-y-4 rounded-2xl border border-border bg-surface p-8 shadow-md [&_p]:text-sm [&_p]:leading-relaxed [&_p]:text-foreground">
      <h2 className="text-xl font-semibold text-foreground">{title}</h2>
      {children}
    </article>
  )
}

export default function docsPage() {
  return (
    <div className="flex min-h-screen w-full justify-center bg-background px-4 py-10 font-sans">
      <div className="w-full max-w-2xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">docs</h1>
          <Link href="/" className="text-sm text-muted hover:text-foreground">
            ← Home
          </Link>
        </div>

        <Section title="Overview">
         <p>
            VLAD helps you create personalized video demos at scale through background replacement,
            and custom introductions. Visitors at redo.com can view{' '}
            <a
              href='https://redo.com/search/brands/mammut.com?products=returns-claims'
              className="font-medium underline underline-offset-2 hover:text-muted"
            >
              product demos with personalized content
            </a>
            . A loom video walkthrough of these demos adds that personal REDO touch to your top of funnel lead outreach,
            but <strong>recording hundreds of these walkthroughs is time intensive.</strong>
          </p>
          <figure className="space-y-2">
            <video
              src="/content-replacement.mov"
              controls
              className="mx-auto w-3/4 rounded-lg"
            />
            <figcaption className="text-center text-sm italic text-muted">
              VLAD replaces background video with merchant-specific content
            </figcaption>
          </figure>
          <p>
            With VLAD you make a merchant agnostic recording of a product demo.
            <strong> Instead of recording a video, we record your mouse and keyboard.</strong> This way we can replace the content in the video with merchant specific images.
            For further personalization you can record an introduction that makes your lead feel special 🧡.
          </p>
          <figure className="space-y-2">
            <Infographic className="mx-auto w-3/4 max-w-md text-foreground" />
            <figcaption className="text-center text-sm italic text-muted">
              Short personal intros + merchant agnostic base recordings shorten recording time and multiply outreach volume.
            </figcaption>
          </figure>
        </Section>

        <Section title="Products">
          <p>
            Product demos are created by the respective engineering team and hosted at{' '}
            <a
              href='https://redo.com/search/record'
              className="font-medium underline underline-offset-2 hover:text-muted"
            >
              https://redo.com/search/record
            </a>
            . VLAD simply wraps this demo site with recording tools.
          </p>
          <figure className="space-y-2">
            <img
              src="/recording-tools.png"
              alt="Recording Studio"
              className="mx-auto w-3/4 rounded-lg"
            />
            <figcaption className="text-center text-sm italic text-muted">
              Recording Studio
            </figcaption>
          </figure>
          <p>
            When making a product recording ensure you keep your language generic.
            <strong> Do not mention the lead&apos;s name, company, or anything specific.</strong>
            The audio will remain unchanged, but the background content of the video will be merchant specific.
          </p>
        </Section>

        <Section title="Merchants">
          <p>
            Merchant specific content is scraped from their store URL.
            <strong> In order for VLAD to render video correctly, the merchant must be scraped in advance.</strong>
          </p>
          <p>
            Adding a new merchant scrape is easy. In the merchant intro flow click the merchant selection dropdown.
            Search for your merchant by url or keyword. If the merchant has not already been scraped add one by
            clicking &apos;+&apos; and follow the link to the scrape management tools. Just type in the URL to the merchant&apos;s store and review the retrieved content.
          </p>
          <figure className="space-y-2">
            <img
              src="/merchant-search.png"
              alt="Merchant Search"
              className="mx-auto w-3/4 rounded-lg"
            />
            <figcaption className="text-center text-sm italic text-muted">
              Search for your merchant, if you don&apos;t find it click &quot;+&quot;
            </figcaption>
          </figure>
          <p>
            If the content of the scrape is incomplete or unsatisfactory you can click the edit icon to go to the preview editing tool.
            In this interface you can browse the scraped data, change the featured images, or upload products and images manually.
            <strong> Make sure you always review the scraped content before sending out a video to make sure we properly represent each merchant.</strong>
          </p>
        </Section>
      </div>
    </div>
  )
}
