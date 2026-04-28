'use client'

import { useEffect, useMemo, useState } from 'react'
import Modal from '@/app/components/Modal'
import MultiSelect from '@/app/components/MultiSelect'
import Select from '@/app/components/Select'
import MerchantChipInput, { type MerchantChip } from '@/app/components/MerchantChipInput'
import type { WebcamMode, WebcamVertical, WebcamHorizontal } from '@/types/webcam'

type RecordingOption = { id: string; label: string }

export type WebcamSource = 'self' | 'other' | 'custom'

export type WebcamPosition = { vertical: WebcamVertical; horizontal: WebcamHorizontal }

export type IntroSettings = {
  enabled: boolean
  merchantRecordingIds: string[]
  modeSource: WebcamSource
  customMode: WebcamMode
  positionSource: WebcamSource
  customPosition: WebcamPosition
}

export type ProductSettings = {
  enabled: boolean
  productRecordingId: string
  /**
   * Merchants whose cleaned URL gets passed as `?brand=` when the product
   * recording is rendered without a custom intro. Currently driven by the
   * "Product Only" prebuilt — one render task per chip. Includes free-text
   * URL/invalid chips alongside DB-matched merchants.
   */
  brandMerchants: MerchantChip[]
  modeSource: WebcamSource
  customMode: WebcamMode
  positionSource: WebcamSource
  customPosition: WebcamPosition
}

export type AudioTransition = 'none' | 'crossfade'
export type OverlayTransition = 'none' | 'animated'
export type VideoTransition = 'none' | 'crossfade'

export type TransitionSettings = {
  /** When false, the three sub-fields are forced to `'none'` and the dropdowns are hidden. */
  enabled: boolean
  audio: AudioTransition
  overlay: OverlayTransition
  video: VideoTransition
}

export type PresetKey = 'p1' | 'p2' | 'custom'

export type MergeFormState = {
  preset: PresetKey
  intro: IntroSettings
  transition: TransitionSettings
  product: ProductSettings
}

const DEFAULT_POSITION: WebcamPosition = { vertical: 'bottom', horizontal: 'left' }

const BLANK_INTRO: IntroSettings = {
  enabled: true,
  merchantRecordingIds: [],
  modeSource: 'self',
  customMode: 'video',
  positionSource: 'self',
  customPosition: DEFAULT_POSITION,
}

const BLANK_PRODUCT: ProductSettings = {
  enabled: true,
  productRecordingId: '',
  brandMerchants: [],
  modeSource: 'self',
  customMode: 'video',
  positionSource: 'self',
  customPosition: DEFAULT_POSITION,
}

const BLANK_TRANSITION: TransitionSettings = {
  enabled: false,
  audio: 'none',
  overlay: 'none',
  video: 'none',
}

function applyPreset(key: 'p1' | 'p2', prev: MergeFormState): MergeFormState {
  switch (key) {
    case 'p1':
      return {
        preset: 'p1',
        intro: {
          ...prev.intro,
          enabled: true,
          modeSource: 'custom',
          customMode: 'video',
          positionSource: 'other',
        },
        transition: prev.transition,
        product: {
          ...prev.product,
          enabled: true,
          modeSource: 'custom',
          customMode: 'audio',
          positionSource: 'self',
        },
      }
    case 'p2':
      return {
        preset: 'p2',
        intro: { ...prev.intro, enabled: false },
        transition: prev.transition,
        product: { ...prev.product, enabled: true, modeSource: 'self', positionSource: 'self' },
      }
  }
}

/**
 * The "Custom" preset is decoupled from the active state so switching to/from
 * a prebuilt doesn't mutate the user's last custom config. We snapshot the
 * config-only fields (everything except recording selections) and persist them
 * to localStorage on submit. Loaded back on next mount.
 */
type IntroConfig = Pick<IntroSettings, 'enabled' | 'modeSource' | 'customMode' | 'positionSource' | 'customPosition'>
type ProductConfig = Pick<ProductSettings, 'enabled' | 'modeSource' | 'customMode' | 'positionSource' | 'customPosition'>
type CustomSnapshot = {
  intro: IntroConfig
  transition: TransitionSettings
  product: ProductConfig
}

const CUSTOM_STORAGE_KEY = 'vlad_merge_custom_snapshot'

function p1Snapshot(): CustomSnapshot {
  return {
    intro: {
      enabled: true,
      modeSource: 'custom',
      customMode: 'video',
      positionSource: 'other',
      customPosition: DEFAULT_POSITION,
    },
    transition: BLANK_TRANSITION,
    product: {
      enabled: true,
      modeSource: 'custom',
      customMode: 'audio',
      positionSource: 'self',
      customPosition: DEFAULT_POSITION,
    },
  }
}

function loadCustomSnapshot(): CustomSnapshot {
  if (typeof window === 'undefined') return p1Snapshot()
  try {
    const raw = window.localStorage.getItem(CUSTOM_STORAGE_KEY)
    if (!raw) return p1Snapshot()
    const parsed = JSON.parse(raw) as Partial<CustomSnapshot>
    if (!parsed.intro || !parsed.transition || !parsed.product) return p1Snapshot()
    // Migrate older snapshots that pre-date `transition.enabled`.
    return {
      ...parsed,
      transition: { ...BLANK_TRANSITION, ...parsed.transition },
    } as CustomSnapshot
  } catch {
    return p1Snapshot()
  }
}

function saveCustomSnapshot(snap: CustomSnapshot) {
  try {
    window.localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(snap))
  } catch {
    /* ignore — quota / private mode */
  }
}

function extractSnapshot(state: MergeFormState): CustomSnapshot {
  return {
    intro: {
      enabled: state.intro.enabled,
      modeSource: state.intro.modeSource,
      customMode: state.intro.customMode,
      positionSource: state.intro.positionSource,
      customPosition: state.intro.customPosition,
    },
    transition: state.transition,
    product: {
      enabled: state.product.enabled,
      modeSource: state.product.modeSource,
      customMode: state.product.customMode,
      positionSource: state.product.positionSource,
      customPosition: state.product.customPosition,
    },
  }
}

function applySnapshot(prev: MergeFormState, snap: CustomSnapshot): MergeFormState {
  return {
    preset: 'custom',
    intro: { ...prev.intro, ...snap.intro },
    transition: snap.transition,
    product: { ...prev.product, ...snap.product },
  }
}

/**
 * The custom view collapses {modeSource, customMode} into a single dropdown.
 * 'self' and 'other' track the source; 'video'/'audio'/'off' set source=custom
 * with the matching webcam mode.
 */
type ModeOption = 'self' | 'other' | 'video' | 'audio' | 'off'

function modeToOption(source: WebcamSource, mode: WebcamMode): ModeOption {
  if (source === 'self') return 'self'
  if (source === 'other') return 'other'
  return mode
}

function modeFromOption(opt: ModeOption, prevMode: WebcamMode): { modeSource: WebcamSource; customMode: WebcamMode } {
  if (opt === 'self' || opt === 'other') return { modeSource: opt, customMode: prevMode }
  return { modeSource: 'custom', customMode: opt }
}

/** Same idea for position, with the four custom corners flattened. */
type PositionOption = 'self' | 'other' | 'tl' | 'tr' | 'bl' | 'br'

function positionToOption(source: WebcamSource, pos: WebcamPosition): PositionOption {
  if (source === 'self') return 'self'
  if (source === 'other') return 'other'
  if (pos.vertical === 'top') return pos.horizontal === 'left' ? 'tl' : 'tr'
  return pos.horizontal === 'left' ? 'bl' : 'br'
}

function positionFromOption(opt: PositionOption, prevPos: WebcamPosition): { positionSource: WebcamSource; customPosition: WebcamPosition } {
  if (opt === 'self' || opt === 'other') return { positionSource: opt, customPosition: prevPos }
  switch (opt) {
    case 'tl': return { positionSource: 'custom', customPosition: { vertical: 'top', horizontal: 'left' } }
    case 'tr': return { positionSource: 'custom', customPosition: { vertical: 'top', horizontal: 'right' } }
    case 'bl': return { positionSource: 'custom', customPosition: { vertical: 'bottom', horizontal: 'left' } }
    case 'br': return { positionSource: 'custom', customPosition: { vertical: 'bottom', horizontal: 'right' } }
  }
}

const MODE_LABELS: Record<ModeOption, string> = {
  self: 'Match recording',
  other: '',  // overridden by caller
  video: 'Video',
  audio: 'Audio only',
  off: 'Off',
}

const POSITION_LABELS: Record<PositionOption, string> = {
  self: 'Match recording',
  other: '',  // overridden by caller
  tl: 'Top-left',
  tr: 'Top-right',
  bl: 'Bottom-left',
  br: 'Bottom-right',
}

function modeOptions(otherLabel: string, otherEnabled: boolean) {
  return [
    { value: 'self', label: MODE_LABELS.self },
    { value: 'other', label: otherLabel, disabled: !otherEnabled },
    { value: 'video', label: MODE_LABELS.video },
    { value: 'audio', label: MODE_LABELS.audio },
    { value: 'off', label: MODE_LABELS.off },
  ]
}

function positionOptions(otherLabel: string, otherEnabled: boolean) {
  return [
    { value: 'self', label: POSITION_LABELS.self },
    { value: 'other', label: otherLabel, disabled: !otherEnabled },
    { value: 'tl', label: POSITION_LABELS.tl },
    { value: 'tr', label: POSITION_LABELS.tr },
    { value: 'bl', label: POSITION_LABELS.bl },
    { value: 'br', label: POSITION_LABELS.br },
  ]
}


const SECTION_HEADER =
  'text-xs font-semibold uppercase tracking-wider text-muted'
const FIELD_LABEL = 'mb-1 block text-xs font-medium text-muted'

type Props = {
  merchants: RecordingOption[]
  products: RecordingOption[]
  onClose: () => void
  onSubmit: (state: MergeFormState) => void
}

export default function GenerateMergeModal({ merchants, products, onClose, onSubmit }: Props) {
  const [state, setState] = useState<MergeFormState>({
    preset: 'p1',
    intro: { ...BLANK_INTRO, modeSource: 'custom', customMode: 'video', positionSource: 'other' },
    transition: BLANK_TRANSITION,
    product: { ...BLANK_PRODUCT, modeSource: 'custom', customMode: 'audio', positionSource: 'self' },
  })
  const [customSnapshot, setCustomSnapshot] = useState<CustomSnapshot>(loadCustomSnapshot)
  const [hasPickedPreset, setHasPickedPreset] = useState(false)

  // While editing in custom mode, mirror the active config into the snapshot
  // so subsequent preset switches don't lose in-progress edits.
  useEffect(() => {
    if (state.preset !== 'custom') return
    setCustomSnapshot(extractSnapshot(state))
  }, [state])

  // Recording-selection edits do NOT flip the preset — recording choice is
  // always user-driven, even when a prebuilt is locked.
  function setIntroRecordings(ids: string[]) {
    setState((prev) => ({ ...prev, intro: { ...prev.intro, merchantRecordingIds: ids } }))
  }
  function setProductRecording(id: string) {
    setState((prev) => ({ ...prev, product: { ...prev.product, productRecordingId: id } }))
  }
  // Webcam / transition edits only happen under Custom, so flipping the
  // preset to 'custom' would be redundant. Patch in place.
  function updateIntro(patch: Partial<IntroSettings>) {
    setState((prev) => ({ ...prev, intro: { ...prev.intro, ...patch } }))
  }
  function updateProduct(patch: Partial<ProductSettings>) {
    setState((prev) => ({ ...prev, product: { ...prev.product, ...patch } }))
  }
  function updateTransition(patch: Partial<TransitionSettings>) {
    setState((prev) => ({ ...prev, transition: { ...prev.transition, ...patch } }))
  }
  function selectPreset(key: PresetKey) {
    setState((prev) => {
      if (key === 'custom') return applySnapshot(prev, customSnapshot)
      return applyPreset(key, prev)
    })
  }

  const introSelected = useMemo(() => new Set(state.intro.merchantRecordingIds), [state.intro.merchantRecordingIds])

  const bothEnabled = state.intro.enabled && state.product.enabled
  const introValid = !state.intro.enabled || state.intro.merchantRecordingIds.length > 0
  const productValid = !state.product.enabled || !!state.product.productRecordingId
  const sectionsValid = state.intro.enabled || state.product.enabled
  // The "product only" flow (p2 OR custom-with-intro-off) needs at least one
  // merchant chip — those drive the per-merchant fan-out.
  const isProductOnlyFlow =
    state.preset === 'p2' ||
    (state.preset === 'custom' && !state.intro.enabled && state.product.enabled)
  const productOnlyNeedsMerchants =
    isProductOnlyFlow && state.product.brandMerchants.length === 0
  // Circular reference: both sections "match" the other → render can't resolve.
  const circularMode =
    bothEnabled && state.intro.modeSource === 'other' && state.product.modeSource === 'other'
  const circularPosition =
    bothEnabled && state.intro.positionSource === 'other' && state.product.positionSource === 'other'
  const circularMessage =
    circularMode && circularPosition
      ? "Intro and product can't both match each other for mode and position."
      : circularMode
        ? "Intro and product can't both match each other for webcam mode."
        : circularPosition
          ? "Intro and product can't both match each other for webcam position."
          : null
  // Stale reference: a section is set to "match" a now-disabled section.
  const introStaleMode =
    state.intro.enabled && !state.product.enabled && state.intro.modeSource === 'other'
  const introStalePosition =
    state.intro.enabled && !state.product.enabled && state.intro.positionSource === 'other'
  const productStaleMode =
    state.product.enabled && !state.intro.enabled && state.product.modeSource === 'other'
  const productStalePosition =
    state.product.enabled && !state.intro.enabled && state.product.positionSource === 'other'
  let staleMessage: string | null = null
  if (introStaleMode && introStalePosition)
    staleMessage = 'Intro webcam mode and position are set to match product, but product is disabled.'
  else if (introStaleMode)
    staleMessage = 'Intro webcam mode is set to match product, but product is disabled.'
  else if (introStalePosition)
    staleMessage = 'Intro webcam position is set to match product, but product is disabled.'
  else if (productStaleMode && productStalePosition)
    staleMessage = 'Product webcam mode and position are set to match intro, but intro is disabled.'
  else if (productStaleMode)
    staleMessage = 'Product webcam mode is set to match intro, but intro is disabled.'
  else if (productStalePosition)
    staleMessage = 'Product webcam position is set to match intro, but intro is disabled.'
  const blockingMessage = !sectionsValid
    ? 'Enable at least one section.'
    : !introValid
      ? 'Pick at least one merchant intro.'
      : !productValid
        ? 'Pick a product recording.'
        : productOnlyNeedsMerchants
          ? 'Pick at least one merchant brand.'
          : circularMessage
            ? circularMessage
            : staleMessage
              ? staleMessage
              : !bothEnabled
                ? 'Single-section rendering is not yet supported by the pipeline.'
                : null

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (blockingMessage) return
    // Persist the custom config only when the user actually runs tasks under it.
    if (state.preset === 'custom') {
      saveCustomSnapshot(extractSnapshot(state))
    }
    onSubmit(state)
  }

  const introCount = state.intro.enabled ? state.intro.merchantRecordingIds.length : 0
  const submitCount = bothEnabled ? introCount : 0

  const isCustom = state.preset === 'custom'

  const merchantsField = (
    <div>
      <label className={FIELD_LABEL}>Merchant intros</label>
      <MultiSelect
        options={merchants.map((m) => ({ value: m.id, label: m.label }))}
        selected={introSelected}
        onChange={(set) => setIntroRecordings(Array.from(set))}
        placeholder="Select merchant intros"
      />
    </div>
  )

  const productField = (
    <div>
      <label className={FIELD_LABEL}>Product recording</label>
      <Select
        options={products.map((p) => ({ value: p.id, label: p.label }))}
        value={state.product.productRecordingId}
        onChange={setProductRecording}
        placeholder="Select a product recording"
      />
    </div>
  )

  if (!hasPickedPreset) {
    return (
      <Modal title="Select a rendering task template" onClose={onClose} size="md">
        <PresetPicker
          onPick={(key) => {
            selectPreset(key)
            setHasPickedPreset(true)
          }}
        />
      </Modal>
    )
  }

  return (
    <Modal
      title="Create a new rendering task"
      onClose={onClose}
      size="md"
      headerRight={
        <Select
          size="sm"
          className="w-44"
          options={PRESET_OPTIONS.map((p) => ({ value: p.key, label: p.title }))}
          value={state.preset}
          onChange={(v) => selectPreset(v as PresetKey)}
        />
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {!isCustom && state.preset === 'p1' && (
          <div className="space-y-3">
            {merchantsField}
            {productField}
          </div>
        )}

        {!isCustom && state.preset === 'p2' && (
          <div className="space-y-3">
            {productField}
            <div>
              <label className={FIELD_LABEL}>Merchants</label>
              <MerchantChipInput
                value={state.product.brandMerchants}
                onChange={(brandMerchants) =>
                  setState((prev) => ({
                    ...prev,
                    product: { ...prev.product, brandMerchants },
                  }))
                }
                placeholder="Type to search or paste comma-separated values…"
              />
            </div>
          </div>
        )}

        {isCustom && (
          <>
            <Section
              title="Intro"
              enabled={state.intro.enabled}
              onEnabledChange={(enabled) => updateIntro({ enabled })}
            >
              {state.intro.enabled ? (
                <div className="space-y-3 pl-1">
                  {merchantsField}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={FIELD_LABEL}>Webcam Mode</label>
                      <Select
                        options={modeOptions('Match product', state.product.enabled)}
                        value={modeToOption(state.intro.modeSource, state.intro.customMode)}
                        onChange={(v) =>
                          updateIntro(modeFromOption(v as ModeOption, state.intro.customMode))
                        }
                      />
                    </div>
                    <div>
                      <label className={FIELD_LABEL}>Webcam Position</label>
                      <Select
                        disabled={modeToOption(state.intro.modeSource, state.intro.customMode) === 'off'}
                        options={positionOptions('Match product', state.product.enabled)}
                        value={positionToOption(state.intro.positionSource, state.intro.customPosition)}
                        onChange={(v) =>
                          updateIntro(positionFromOption(v as PositionOption, state.intro.customPosition))
                        }
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="pl-1">
                  <label className={FIELD_LABEL}>Merchants</label>
                  <MerchantChipInput
                    value={state.product.brandMerchants}
                    onChange={(brandMerchants) =>
                      setState((prev) => ({
                        ...prev,
                        product: { ...prev.product, brandMerchants },
                      }))
                    }
                    placeholder="Type to search or paste comma-separated values…"
                  />
                </div>
              )}
            </Section>

            {state.intro.enabled && state.product.enabled && (
              <Section
                title="Transition"
                enabled={state.transition.enabled}
                onEnabledChange={(enabled) => {
                  if (enabled) updateTransition({ enabled: true })
                  else updateTransition({ enabled: false, audio: 'none', video: 'none', overlay: 'none' })
                }}
                hint="Stubbed — wiring lands later"
              >
                {state.transition.enabled && (
                  <div className="grid grid-cols-3 gap-3 pl-1">
                    <SelectField
                      label="Audio"
                      value={state.transition.audio}
                      onChange={(audio) => updateTransition({ audio: audio as AudioTransition })}
                      options={[
                        { value: 'none', label: 'None' },
                        { value: 'crossfade', label: 'Crossfade (soon)', disabled: true },
                      ]}
                    />
                    <SelectField
                      label="Video"
                      value={state.transition.video}
                      onChange={(video) => updateTransition({ video: video as VideoTransition })}
                      options={[
                        { value: 'none', label: 'None' },
                        { value: 'crossfade', label: 'Crossfade (soon)', disabled: true },
                      ]}
                    />
                    <SelectField
                      label="Overlay"
                      value={state.transition.overlay}
                      onChange={(overlay) => updateTransition({ overlay: overlay as OverlayTransition })}
                      options={[
                        { value: 'none', label: 'None' },
                        { value: 'animated', label: 'Animated (soon)', disabled: true },
                      ]}
                    />
                  </div>
                )}
              </Section>
            )}

            <Section
              title="Product Recording"
              enabled={state.product.enabled}
              onEnabledChange={(enabled) => updateProduct({ enabled })}
            >
              {state.product.enabled && (
                <div className="space-y-3 pl-1">
                  {productField}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={FIELD_LABEL}>Webcam Mode</label>
                      <Select
                        options={modeOptions('Match intro', state.intro.enabled)}
                        value={modeToOption(state.product.modeSource, state.product.customMode)}
                        onChange={(v) =>
                          updateProduct(modeFromOption(v as ModeOption, state.product.customMode))
                        }
                      />
                    </div>
                    <div>
                      <label className={FIELD_LABEL}>Webcam Position</label>
                      <Select
                        disabled={modeToOption(state.product.modeSource, state.product.customMode) === 'off'}
                        options={positionOptions('Match intro', state.intro.enabled)}
                        value={positionToOption(state.product.positionSource, state.product.customPosition)}
                        onChange={(v) =>
                          updateProduct(positionFromOption(v as PositionOption, state.product.customPosition))
                        }
                      />
                    </div>
                  </div>
                </div>
              )}
            </Section>
          </>
        )}

        {blockingMessage && (
          <p className="text-xs italic text-amber-600 dark:text-amber-400">{blockingMessage}</p>
        )}

        <button
          type="submit"
          disabled={!!blockingMessage}
          className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Start {submitCount} rendering task{submitCount === 1 ? '' : 's'}
        </button>
      </form>
    </Modal>
  )
}

const PRESET_OPTIONS: { key: PresetKey; title: string; subtitle: string }[] = [
  { key: 'p1', title: 'Intro + Product', subtitle: 'Join intro with product recording, webcam transitions from on to audio only.' },
  { key: 'p2', title: 'Product Only', subtitle: 'No custom intro, only product recording, webcam on the whole time.' },
  { key: 'custom', title: 'Custom', subtitle: 'Full control over composition and settings' },
]

function PresetPicker({ onPick }: { onPick: (k: PresetKey) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {PRESET_OPTIONS.map((p) => (
        <button
          key={p.key}
          type="button"
          onClick={() => onPick(p.key)}
          className="flex flex-col items-start gap-1 rounded-lg border border-border bg-background p-3 text-left transition-colors hover:border-accent"
        >
          <p className="text-sm font-semibold text-foreground">{p.title}</p>
          <p className="text-xs leading-tight text-muted">{p.subtitle}</p>
        </button>
      ))}
    </div>
  )
}

function Section({
  title,
  hint,
  enabled,
  onEnabledChange,
  children,
}: {
  title: string
  hint?: string
  enabled?: boolean
  onEnabledChange?: (v: boolean) => void
  children: React.ReactNode
}) {
  const hasToggle = onEnabledChange != null
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between border-b border-border pb-1.5">
        <label className={`flex items-center gap-2 ${hasToggle ? 'cursor-pointer select-none' : ''}`}>
          {hasToggle && (
            <input
              type="checkbox"
              checked={!!enabled}
              onChange={(e) => onEnabledChange(e.target.checked)}
              className="h-3.5 w-3.5 accent-foreground"
            />
          )}
          <h3 className={SECTION_HEADER}>{title}</h3>
        </label>
        {hint && <span className="text-[10px] italic text-muted opacity-70">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string; disabled?: boolean }[]
}) {
  return (
    <div>
      <label className={FIELD_LABEL}>{label}</label>
      <Select options={options} value={value} onChange={onChange} />
    </div>
  )
}
