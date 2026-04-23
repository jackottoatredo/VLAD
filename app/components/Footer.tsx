import Link from 'next/link'

export default function Footer() {
  const linkClass = 'text-muted hover:text-foreground transition-colors'
  const separatorClass = 'text-border'

  return (
    <footer className="fixed bottom-2 right-4 z-40 flex items-center gap-2 text-[0.65625rem]">
      <a href="#" className={linkClass}>
        Request a feature
      </a>
      <span className={separatorClass}>|</span>
      <a href="#" className={linkClass}>
        Report a bug
      </a>
      <span className={separatorClass}>|</span>
      <Link href="/tutorial" className={linkClass}>
        Tutorial
      </Link>
      <span className={separatorClass}>|</span>
      <a
        href="https://redo-tech.slack.com/archives/C0AU9L8FHNJ"
        target="_blank"
        rel="noreferrer"
        className={linkClass}
      >
        Slack
      </a>
    </footer>
  )
}
