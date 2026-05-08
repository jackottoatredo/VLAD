'use client'

import { useEffect, useMemo, useState } from 'react'
import Modal from '@/app/components/Modal'
import MultiSelect from '@/app/components/MultiSelect'
import Select from '@/app/components/Select'
import MerchantChipInput, { type MerchantChip } from '@/app/components/MerchantChipInput'
import type { WebcamMode, WebcamVertical, WebcamHorizontal } from '@/types/webcam'

export type JobRequestPayload = { endpoint: string; body: unknown }

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
/**
 * Overlay (webcam circle / audio icon) transition style at the merge boundary:
 *   - none:      hard cut, no transition
 *   - animated:  morph webcam ↔ audio icon. Only meaningful for a↔v
 *                (mode-changing transitions). Silently a no-op for v→v / a→a.
 *   - crossfade: simple opacity crossfade between intro and product webcams.
 *                Only meaningful for v→v (matching video modes). Becomes
 *                'none' at the worker for any other mode combination.
 */
export type OverlayTransition = 'none' | 'animated' | 'crossfade'
export type VideoTransition = 'none' | 'crossfade'
/**
 * Mouse glide style during transitions:
 *   - none:    cursor jumps at the boundary (no glide).
 *   - linear:  straight A→B path with cubic ease-in-out velocity.
 *   - arched:  quadratic Bezier arc bowing up, with cubic ease-in-out velocity.
 *   - natural: arched path with sine-perturbed speed stutter (most human-feeling).
 */
export type MouseTransition = 'none' | 'linear' | 'arched' | 'natural'

export type TransitionSettings = {
  /** Master gate. When false, the section collapses and ALL four transitions
   *  submit as `'none'` regardless of the stored type values. The stored
   *  type values are preserved across toggles so the user's selections
   *  survive an off→on cycle. Mirror of the section toggles on Intro and
   *  Product. */
  enabled: boolean
  audio: AudioTransition
  video: VideoTransition
  overlay: OverlayTransition
  mouse: MouseTransition
  /** Per-transition durations (ms). Each transition is symmetric around the
   *  merge boundary — D/2 contributed from each side. No `side` knob.
   *  Each duration is independent of the others; the duration is ignored
   *  when its corresponding type is `'none'`. */
  audioDurationMs: number
  videoDurationMs: number
  overlayDurationMs: number
  mouseDurationMs: number
}

/** Shared 100ms grid (used by overlay + mouse). [100, 1500ms]. */
export const TRANSITION_DURATIONS_MS = [
  100, 200, 300, 400, 500, 600, 700, 800, 900,
  1000, 1100, 1200, 1300, 1400, 1500,
] as const

/** Audio crossfade range — 50ms grid, [50, 500ms]. */
export const AUDIO_DURATIONS_MS = [
  50, 100, 150, 200, 250, 300, 350, 400, 450, 500,
] as const

/** Video crossfade range — 50ms grid, [50, 500ms]. */
export const VIDEO_DURATIONS_MS = [
  50, 100, 150, 200, 250, 300, 350, 400, 450, 500,
] as const

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
  video: 'none',
  overlay: 'none',
  mouse: 'none',
  audioDurationMs: 200,
  videoDurationMs: 400,
  overlayDurationMs: 400,
  mouseDurationMs: 400,
}

/** p1 default — short audio, longer visuals for cinematic feel. */
const P1_TRANSITION: TransitionSettings = {
  enabled: true,
  audio: 'crossfade',
  video: 'crossfade',
  overlay: 'animated',
  mouse: 'natural',
  audioDurationMs: 300,
  videoDurationMs: 200,
  overlayDurationMs: 400,
  mouseDurationMs: 500,
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
        transition: { ...P1_TRANSITION },
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
        transition: { ...BLANK_TRANSITION },
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

/**
 * Reverses the body shape produced by the merge-export / product-only-export
 * routes back into a MergeFormState so the edit-and-rerender flow can
 * pre-populate the modal in custom mode. Tolerant of legacy bodies — anything
 * missing falls back to BLANK_* equivalents.
 *
 * Lives here (rather than at the call site) so the merge-export page and the
 * admin recordings tool can share the same conversion.
 */
export function bodyToFormState(jobRequest: JobRequestPayload | null | undefined): MergeFormState | null {
  if (!jobRequest || !jobRequest.body || typeof jobRequest.body !== 'object') return null
  const body = jobRequest.body as Record<string, unknown>
  const isProductOnly = jobRequest.endpoint === '/api/product-only-export'

  const introS = (body.introSettings as Record<string, unknown> | undefined) ?? {}
  const productS = (body.productSettings as Record<string, unknown> | undefined) ?? {}
  const tr = (body.transition as Record<string, unknown> | undefined) ?? {}
  const merchantBrand = body.merchantBrand as { websiteUrl?: string; brandName?: string } | undefined

  const intro: IntroSettings = {
    enabled: isProductOnly ? false : body.introEnabled !== false,
    merchantRecordingIds:
      typeof body.merchantRecordingId === 'string' ? [body.merchantRecordingId] : [],
    modeSource: (introS.modeSource as WebcamSource) ?? 'self',
    customMode: (introS.customMode as WebcamMode) ?? 'video',
    positionSource: (introS.positionSource as WebcamSource) ?? 'self',
    customPosition: (introS.customPosition as WebcamPosition) ?? DEFAULT_POSITION,
  }

  // Reconstruct a renderable merchant chip from the body's merchantBrand
  // payload — only websiteUrl + brandName flow back to runProductOnlyTask, so
  // a synthesized id is fine for the form's validation.
  const brandMerchants: MerchantChip[] =
    isProductOnly && merchantBrand?.websiteUrl
      ? [{
          kind: 'merchant',
          id: `synthetic:${merchantBrand.websiteUrl}`,
          brandName: merchantBrand.brandName ?? merchantBrand.websiteUrl,
          websiteUrl: merchantBrand.websiteUrl,
          status: 'complete',
        }]
      : []

  const product: ProductSettings = {
    enabled: isProductOnly ? true : body.productEnabled !== false,
    productRecordingId: typeof body.productRecordingId === 'string' ? body.productRecordingId : '',
    brandMerchants,
    modeSource: (productS.modeSource as WebcamSource) ?? 'self',
    customMode: (productS.customMode as WebcamMode) ?? 'video',
    positionSource: (productS.positionSource as WebcamSource) ?? 'self',
    customPosition: (productS.customPosition as WebcamPosition) ?? DEFAULT_POSITION,
  }

  const audio = (tr.audio as AudioTransition) ?? 'none'
  const video = (tr.video as VideoTransition) ?? 'none'
  const overlay = (tr.overlay as OverlayTransition) ?? 'none'
  const mouse = (tr.mouse as MouseTransition) ?? 'none'
  const transition: TransitionSettings = {
    enabled: audio !== 'none' || video !== 'none' || overlay !== 'none' || mouse !== 'none',
    audio, video, overlay, mouse,
    audioDurationMs: typeof tr.audioDurationMs === 'number' ? tr.audioDurationMs : BLANK_TRANSITION.audioDurationMs,
    videoDurationMs: typeof tr.videoDurationMs === 'number' ? tr.videoDurationMs : BLANK_TRANSITION.videoDurationMs,
    overlayDurationMs: typeof tr.overlayDurationMs === 'number' ? tr.overlayDurationMs : BLANK_TRANSITION.overlayDurationMs,
    mouseDurationMs: typeof tr.mouseDurationMs === 'number' ? tr.mouseDurationMs : BLANK_TRANSITION.mouseDurationMs,
  }

  return { preset: 'custom', intro, transition, product }
}

function p1Snapshot(): CustomSnapshot {
  return {
    intro: {
      enabled: true,
      modeSource: 'custom',
      customMode: 'video',
      positionSource: 'other',
      customPosition: DEFAULT_POSITION,
    },
    // Custom default mirrors p1 — the user can dial back from there.
    transition: { ...P1_TRANSITION },
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
    // Forward-compat: older snapshots had a single `durationMs` instead of
    // the four per-transition fields. Splat the legacy value into each
    // direction; layer over BLANK_TRANSITION so any other missing fields
    // (notably `enabled` for snapshots saved during the brief no-toggle
    // window) still get sensible defaults.
    const legacy = parsed.transition as Partial<TransitionSettings> & { durationMs?: number }
    const migrated: TransitionSettings = { ...BLANK_TRANSITION, ...legacy }
    if (typeof legacy.durationMs === 'number') {
      const d = legacy.durationMs
      migrated.audioDurationMs = legacy.audioDurationMs ?? Math.min(d, 200)
      migrated.videoDurationMs = legacy.videoDurationMs ?? d
      migrated.overlayDurationMs = legacy.overlayDurationMs ?? d
      migrated.mouseDurationMs = legacy.mouseDurationMs ?? d
    }
    return {
      ...parsed,
      transition: migrated,
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
  self: 'As Recorded',
  other: '',  // overridden by caller
  video: 'Video',
  audio: 'Audio only',
  off: 'Off',
}

const POSITION_LABELS: Record<PositionOption, string> = {
  self: 'As Recorded',
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
  /** Pre-populate the form (used by the render edit flow). When supplied, the
   *  preset picker is skipped and the form opens straight into edit view. */
  initialState?: MergeFormState
  /** Optional override for the submit button copy (e.g. "Re-render" for edits). */
  submitLabel?: string
  /** Optional override for the modal header title. */
  modalTitle?: string
}

export default function GenerateMergeModal({ merchants, products, onClose, onSubmit, initialState, submitLabel, modalTitle }: Props) {
  const [state, setState] = useState<MergeFormState>(
    initialState ?? {
      preset: 'p1',
      intro: { ...BLANK_INTRO, modeSource: 'custom', customMode: 'video', positionSource: 'other' },
      transition: { ...P1_TRANSITION },
      product: { ...BLANK_PRODUCT, modeSource: 'custom', customMode: 'audio', positionSource: 'self' },
    },
  )
  const [customSnapshot, setCustomSnapshot] = useState<CustomSnapshot>(loadCustomSnapshot)
  const [hasPickedPreset, setHasPickedPreset] = useState(initialState != null)

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
  // Only DB-matched merchants whose scrape is complete are renderable. Pending
  // / incomplete scrapes and free-text URL chips can't fan out yet — they need
  // a complete scrape first (triggered via the chip tooltip).
  const renderableBrandMerchants = state.product.brandMerchants.filter(
    (c) => c.kind === 'merchant' && c.status === 'complete',
  )
  const productOnlyNeedsMerchants =
    isProductOnlyFlow && renderableBrandMerchants.length === 0
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
          ? 'Pick at least one merchant with a completed scrape.'
          : circularMessage
            ? circularMessage
            : staleMessage
              ? staleMessage
              : null


  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (blockingMessage) return
    // Persist the custom config only when the user actually runs tasks under it.
    if (state.preset === 'custom') {
      saveCustomSnapshot(extractSnapshot(state))
    }
    console.log('[merge-modal] submit transition:', JSON.stringify(state.transition))
    onSubmit(state)
  }

  const introCount = state.intro.enabled ? state.intro.merchantRecordingIds.length : 0
  const submitCount = bothEnabled
    ? introCount
    : isProductOnlyFlow
      ? renderableBrandMerchants.length
      : 0

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
      title={modalTitle ?? 'Create a new rendering task'}
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
            {productField}
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
                title="Transitions"
                enabled={state.transition.enabled}
                onEnabledChange={(enabled) => updateTransition({ enabled })}
              >
                {state.transition.enabled && (
                  <div className="space-y-2 pl-1">
                    <TransitionRow
                      label="Audio"
                      type={state.transition.audio}
                      typeOptions={[
                        { value: 'none', label: 'None' },
                        { value: 'crossfade', label: 'Crossfade' },
                      ]}
                      onTypeChange={(audio) => updateTransition({ audio: audio as AudioTransition })}
                      durationMs={state.transition.audioDurationMs}
                      durationOptions={AUDIO_DURATIONS_MS}
                      onDurationChange={(ms) => updateTransition({ audioDurationMs: ms })}
                    />
                    <TransitionRow
                      label="Video"
                      type={state.transition.video}
                      typeOptions={[
                        { value: 'none', label: 'None' },
                        { value: 'crossfade', label: 'Crossfade' },
                      ]}
                      onTypeChange={(video) => updateTransition({ video: video as VideoTransition })}
                      durationMs={state.transition.videoDurationMs}
                      durationOptions={VIDEO_DURATIONS_MS}
                      onDurationChange={(ms) => updateTransition({ videoDurationMs: ms })}
                    />
                    <TransitionRow
                      label="Overlay"
                      type={state.transition.overlay}
                      typeOptions={[
                        { value: 'none', label: 'None' },
                        { value: 'animated', label: 'Animated' },
                        { value: 'crossfade', label: 'Crossfade' },
                      ]}
                      onTypeChange={(overlay) => updateTransition({ overlay: overlay as OverlayTransition })}
                      durationMs={state.transition.overlayDurationMs}
                      durationOptions={TRANSITION_DURATIONS_MS}
                      onDurationChange={(ms) => updateTransition({ overlayDurationMs: ms })}
                    />
                    <TransitionRow
                      label="Mouse"
                      type={state.transition.mouse}
                      typeOptions={[
                        { value: 'none', label: 'None' },
                        { value: 'linear', label: 'Linear' },
                        { value: 'arched', label: 'Arched' },
                        { value: 'natural', label: 'Natural' },
                      ]}
                      onTypeChange={(mouse) => updateTransition({ mouse: mouse as MouseTransition })}
                      durationMs={state.transition.mouseDurationMs}
                      durationOptions={TRANSITION_DURATIONS_MS}
                      onDurationChange={(ms) => updateTransition({ mouseDurationMs: ms })}
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
          {submitLabel ?? `Start ${submitCount} rendering task${submitCount === 1 ? '' : 's'}`}
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

/**
 * One row per transition kind: [label][type dropdown][duration dropdown].
 * The duration dropdown disables when type is 'none' so the visual link
 * between "this transition is off" and "duration is irrelevant" is clear.
 */
function TransitionRow({
  label,
  type,
  typeOptions,
  onTypeChange,
  durationMs,
  durationOptions,
  onDurationChange,
}: {
  label: string
  type: string
  typeOptions: { value: string; label: string }[]
  onTypeChange: (v: string) => void
  durationMs: number
  durationOptions: ReadonlyArray<number>
  onDurationChange: (ms: number) => void
}) {
  const disabled = type === 'none'
  return (
    <div className="grid grid-cols-[80px_1fr_1fr] items-center gap-3">
      <span className="text-xs font-medium text-muted">{label}</span>
      <Select options={typeOptions} value={type} onChange={onTypeChange} />
      <Select
        disabled={disabled}
        options={durationOptions.map((ms) => ({ value: String(ms), label: `${ms} ms` }))}
        value={String(durationMs)}
        onChange={(v) => onDurationChange(parseInt(v, 10) || durationMs)}
      />
    </div>
  )
}
