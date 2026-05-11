import type { CSSProperties, ReactNode } from 'react'

// Long-content page; content stacks vertically and the page scrolls naturally.
// Horizontal padding = 5vh; pass `maxWidth` to cap and center the content
// (e.g. "800px" for narrow reading layouts like Docs).
export default function ScrollablePage({
  children,
  maxWidth,
}: {
  children: ReactNode
  maxWidth?: CSSProperties['maxWidth']
}) {
  return (
    <div className="min-h-screen w-full bg-background px-[5vh] py-[5vh] font-sans">
      <div className="mx-auto w-full" style={maxWidth ? { maxWidth } : undefined}>
        {children}
      </div>
    </div>
  )
}
