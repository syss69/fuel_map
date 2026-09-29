let sessionId: string | undefined;

export function getReporterId(): string {
  if (sessionId) return sessionId;
  try {
    const stored = localStorage.getItem('fuelmap_reporter_id');
    if (stored && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stored)) {
      return sessionId = stored;
    }
  } catch { /* Storage may be unavailable; keep one identity for this page session. */ }
  sessionId = crypto.randomUUID();
  try { localStorage.setItem('fuelmap_reporter_id', sessionId); } catch { /* Session fallback. */ }
  return sessionId;
}
