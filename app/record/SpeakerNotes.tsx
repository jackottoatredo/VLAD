'use client'
import { useEffect, useRef } from 'react'

const PLACEHOLDER = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo. Consequat duis aute irure dolor in reprehenderit voluptate velit esse cillum pariatur. Excepteur sint occaecat."

export default function SpeakerNotes() {
  const containerRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    const fit = () => {
      const container = containerRef.current
      const text = textRef.current
      if (!container || !text) return
      let lo = 1, hi = 300
      while (hi - lo > 1) {
        const mid = Math.round((lo + hi) / 2)
        text.style.fontSize = `${mid}px`
        if (text.scrollHeight <= container.clientHeight) {
          lo = mid
        } else {
          hi = mid
        }
      }
      text.style.fontSize = `${lo}px`
    }

    const ro = new ResizeObserver(fit)
    if (containerRef.current) ro.observe(containerRef.current)
    fit()
    return () => ro.disconnect()
  }, [])

  return (
    <div ref={containerRef} className="flex h-[12vw] w-full items-center overflow-hidden rounded-xl bg-zinc-900 px-[2vw] dark:bg-zinc-800">
      <p ref={textRef} className="font-medium text-white">{PLACEHOLDER}</p>
    </div>
  )
}
