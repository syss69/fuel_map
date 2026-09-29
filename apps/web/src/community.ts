import type { Availability } from './api';

export function normalizeAvailability(value: Availability) {
  if (value === 'AVAILABLE') return 'AVAILABLE';
  if (value === 'UNKNOWN') return null;
  return 'UNAVAILABLE';
}

// Parse decimal digits directly, without multiplying floating-point euro values.
export function parsePrice(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,3})?$/.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.split('.');
  const milli = Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));
  return Number.isSafeInteger(milli) && milli > 0 && milli <= 2147483647 ? milli : null;
}

export function reportedAgo(timestamp: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(timestamp)) / 60000));
  return minutes ? `il y a ${minutes} min` : 'à l’instant';
}
