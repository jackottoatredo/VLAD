export type ScrapeStatus = 'pending' | 'complete' | 'incomplete'

export const SCRAPE_STATUS_LABEL: Record<ScrapeStatus, string> = {
  pending: 'Pending',
  complete: 'Complete',
  incomplete: 'Incomplete',
}

/** Row shape returned by /api/previews/search. */
export type MerchantSearchRow = {
  id: string
  brandName: string
  websiteUrl: string
  activityAt: string
  wasEdited: boolean
  status: ScrapeStatus
}
