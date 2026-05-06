'use client'

import Modal from '@/app/components/Modal'
import { MultiKindChipInput } from './MultiKindChipInput'
import {
  EMPTY_FILTERS,
  type AdminFilters,
  type FilterChipKind,
  type FilterOptions,
} from './filters'

type Props = {
  filters: AdminFilters
  onChange: (next: AdminFilters) => void
  options: FilterOptions
  enabledKinds: FilterChipKind[]
  onClose: () => void
}

// Two stacked chip fields. Include semantics: only data matching at
// least one Include chip across any kind shows up. Exclude: hide any
// data matching an Exclude chip. Empty Include = "show everything"
// (nothing is filtered IN), so the two fields are independent.
export function AdminFiltersModal({
  filters,
  onChange,
  options,
  enabledKinds,
  onClose,
}: Props) {
  function setInclude(next: AdminFilters['include']) {
    onChange({ ...filters, include: next })
  }
  function setExclude(next: AdminFilters['exclude']) {
    onChange({ ...filters, exclude: next })
  }
  function clearAll() {
    onChange(EMPTY_FILTERS)
  }
  const isEmpty = filters.include.length === 0 && filters.exclude.length === 0

  return (
    <Modal
      title="Dashboard filters"
      onClose={onClose}
      size="lg"
      headerRight={
        !isEmpty ? (
          <button
            onClick={clearAll}
            className="text-xs uppercase tracking-wider text-muted transition-colors hover:text-foreground"
          >
            Clear all
          </button>
        ) : undefined
      }
    >
      <div className="space-y-5">
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted">
            Include
          </label>
          <MultiKindChipInput
            value={filters.include}
            onChange={setInclude}
            options={options}
            enabledKinds={enabledKinds}
            placeholder="Show only data matching these…"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted">
            Exclude
          </label>
          <MultiKindChipInput
            value={filters.exclude}
            onChange={setExclude}
            options={options}
            enabledKinds={enabledKinds}
            placeholder="Hide data matching these…"
          />
        </div>

        <p className="text-xs text-muted">
          Chips are prefixed by kind. <span className="font-medium">Include</span>{' '}
          shows only matching data — empty means no inclusion filter (everything
          shows). <span className="font-medium">Exclude</span> always hides
          matching data. Filters persist in this browser.
        </p>
      </div>
    </Modal>
  )
}
