export type SegOption<T extends string | number> = { value: T; label: string }

export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: SegOption<T>[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-border">
      {options.map((opt, i) => {
        const active = opt.value === value
        return (
          <button
            key={String(opt.value)}
            onClick={() => onChange(opt.value)}
            className={[
              'px-2.5 py-1 text-xs transition-colors',
              i > 0 ? 'border-l border-border' : '',
              active
                ? 'bg-foreground text-background'
                : 'text-muted hover:bg-background hover:text-foreground',
            ].join(' ')}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
