import type { CSSProperties, ReactNode } from 'react'

// Standard page wrapper used everywhere except the Dashboard. 25px padding on
// all sides; pass `maxWidth` (e.g. "800px") to cap and horizontally center the
// content. Content shorter than the viewport is centered vertically; taller
// content scrolls naturally with 25px breathing room top and bottom.
export default function Page({
  children,
  maxWidth,
}: {
  children: ReactNode
  maxWidth?: CSSProperties['maxWidth']
}) {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background p-[25px] font-sans">
      <div className="w-full" style={maxWidth ? { maxWidth } : undefined}>
        {children}
      </div>
    </div>
  )
}
