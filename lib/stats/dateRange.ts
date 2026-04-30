export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

export function buildDateRange(days: number): string[] {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * MS_PER_DAY);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
