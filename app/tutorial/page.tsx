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

export default function TutorialPage() {
  return (
    <div className="flex min-h-screen w-full justify-center bg-background px-4 py-10 font-sans">
      <div className="w-full max-w-2xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Tutorial</h1>
          <Link href="/" className="text-sm text-muted hover:text-foreground">
            ← Home
          </Link>
        </div>

        <Section title="Overview">
          <Infographic className="mx-auto w-full max-w-md text-foreground" />
          <p>
            VLAD helps you create personalized video demos at scale through background replacement, 
            and custom introductions. Visitors at redo.com can view  
            <a href='https://redo.com/search/brands/mammut.com?products=returns-claims'>
              product demos with personalized content. 
            </a>
          </p>
          <p>
            A loom video walkthrough of these demos adds that personal REDO touch to your top of funnel lead outreach,
            but recording hundreds of these walkthroughs is time intensive.
          </p>
          <p>
            With VLAD you make a merchant agnostic recording of a product demo. Instead of recording a video, 
            we record your mouse and keyboard. This way we can replace the content in the video with merchant specific images.
            For further personalization you can record an introduction that makes your lead feel special 🧡.
          </p>
        </Section>

        <Section title="Products">
          <p>
            Product demos are created by the respective engineering team and hosted at 
            <a href='https://redo.com/search/record'> https://redo.com/search/record. </a>
            VLAD simply wraps this site with demo with recording tools.
          </p>
        </Section>

        <Section title="Merchants">
          <p>
            Maecenas fermentum consequat mi. Donec fermentum. Pellentesque malesuada nulla a mi. Duis sapien sem, aliquet nec, commodo eget, consequat quis, neque. Aliquam faucibus, elit ut dictum aliquet, felis nisl adipiscing sapien, sed malesuada diam lacus eget erat. Cras mollis scelerisque nunc. Nullam arcu. Aliquam consequat. Curabitur augue lorem, dapibus quis, laoreet et, pretium ac, nisi. Aenean magna nisl, mollis quis, molestie eu, feugiat in, orci.
          </p>
        </Section>
      </div>
    </div>
  )
}
