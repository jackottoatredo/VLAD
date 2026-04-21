'use client'

import ReactMarkdown from 'react-markdown'

type Props = {
  children: string
  className?: string
}

export default function Markdown({ children, className = '' }: Props) {
  return (
    <div className={`space-y-2 text-sm text-muted ${className}`}>
      <ReactMarkdown
        components={{
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          a: ({ href, children }) => (
            <a
              href={href}
              className="text-foreground underline underline-offset-2 hover:text-muted"
              target={href?.startsWith('http') ? '_blank' : undefined}
              rel={href?.startsWith('http') ? 'noreferrer' : undefined}
            >
              {children}
            </a>
          ),
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-4">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-4">{children}</ol>,
          code: ({ children }) => (
            <code className="rounded bg-background px-1 py-0.5 font-mono text-xs text-foreground">
              {children}
            </code>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
