import type { CSSProperties, ReactNode } from 'react'

// Non-scrolling page sized to fill the viewport with thin margins on all
// sides. Padding = 5vh. Pass `maxWidth` to cap and center the content (e.g.
// "800px" for short, single-card pages like Quick Links); with maxWidth the
// inner area shrinks to its content height and is centered vertically. Without
// maxWidth the inner area fills the viewport (use for h-full child layouts
// like the Dashboard).
export default function PageLarge({
  children,
  maxWidth,
}: {
  children: ReactNode
  maxWidth?: CSSProperties['maxWidth']
}) {
  return (
    <div className="flex h-screen w-full items-center justify-center overflow-hidden bg-background p-[5vh] font-sans">
      <div
        className={maxWidth ? 'mx-auto max-h-full w-full' : 'h-full w-full'}
        style={maxWidth ? { maxWidth } : undefined}
      >
        {children}
      </div>
    </div>
  )
}
