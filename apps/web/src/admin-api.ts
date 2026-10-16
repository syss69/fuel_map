const base = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1';
export class AdminApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function namesRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method, credentials: 'include', cache: 'no-store',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new AdminApiError(typeof data?.message === 'string' ? data.message : 'La demande a échoué. Réessayez.', response.status);
  return data as T;
}
export interface AdminStation {
  id: string; official_id: string; display_name: string | null; address: string | null; city: string | null; last_seen_at: string;
}
export interface NameSuggestion {
  id: string; station_id: string; proposed_name: string; original_name: string | null; comment: string | null;
  display_name: string | null; address: string | null; city: string | null; official_id: string;
  status: string; created_at: string; reviewed_at: string | null; reviewed_by: string | null; decision_reason: string | null; approved_name: string | null;
}
export interface NameHistory { id: string; old_name: string | null; new_name: string; admin_username: string; suggestion_id: string | null; created_at: string }
export interface Page<T> { items: T[]; hasMore: boolean }
