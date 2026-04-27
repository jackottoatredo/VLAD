'use client'

import Modal from './Modal'

const SCRAPE_TOOL_URL = 'https://search-redo-internal-replit.replit.app/search'

type Props = {
  onClose: () => void
}

export default function ScrapePromptModal({ onClose }: Props) {
  return (
    <Modal title="Brand not scraped yet?" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-foreground">
          <li>Open the scrape tool.</li>
          <li>Paste the brand&apos;s root URL (e.g. <span className="rounded bg-background px-1 text-muted">brand.com</span>).</li>
          <li>Wait for the scrape to complete.</li>
          <li>Come back here and search for the brand again.</li>
        </ol>
        <a
          href={SCRAPE_TOOL_URL}
          target="_blank"
          rel="noreferrer"
          className="w-full rounded-md bg-foreground px-4 py-1.5 text-center text-sm font-medium text-background hover:opacity-80"
        >
          Open scrape tool
        </a>
      </div>
    </Modal>
  )
}
