import type { CSSProperties, ReactNode } from 'react'

// Standard page wrapper used everywhere except the Dashboard. Horizontal
// padding is a fixed 25px. Vertical padding is half the side margin: with
// `maxWidth` set, the formula is `max(25px, calc((100% - maxWidth) / 4))`
// — i.e., half of `(parentWidth - maxWidth) / 2` (the side margin itself).
// Without `maxWidth` we fall back to 25px. `100%` refers to the parent
// content region (excluding the side menu) because the LayoutChrome content
// div is the padding's containing block, and CSS resolves percentage padding
// (including padding-top/bottom) against parent width. Content shorter than
// the viewport is centered vertically; taller content scrolls naturally.
export default function Page({
  children,
  maxWidth,
}: {
  children: ReactNode
  maxWidth?: CSSProperties['maxWidth']
}) {
  const verticalPad = maxWidth
    ? `max(25px, calc((100% - ${maxWidth}) / 4))`
    : '25px'
  return (
    <div
      className="flex min-h-screen w-full items-center justify-center bg-background font-sans"
      style={{
        paddingLeft: 25,
        paddingRight: 25,
        paddingTop: verticalPad,
        paddingBottom: verticalPad,
      }}
    >
      <div className="w-full" style={maxWidth ? { maxWidth } : undefined}>
        {children}
      </div>
    </div>
  )
}
