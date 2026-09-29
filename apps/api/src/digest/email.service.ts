import { Injectable } from '@nestjs/common';
import { getConfig } from '../config';

export interface EmailMessage { from: string; to: string[]; subject: string; html: string; text: string }
export class EmailFailure extends Error {
  constructor(public readonly retryable: boolean, message: string) { super(message); }
}
@Injectable()
export class EmailService {
  async send(message: EmailMessage, idempotencyKey: string): Promise<string> {
    const key = getConfig().RESEND_API_KEY;
    if (!key) throw new EmailFailure(false, 'Email provider is not configured');
    let response: Response;
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(message), signal: AbortSignal.timeout(15000),
      });
    } catch { throw new EmailFailure(true, 'Email provider connection failed'); }
    if (!response.ok) throw new EmailFailure(response.status === 429 || response.status >= 500, `Email provider HTTP ${response.status}`);
    const data = await response.json() as { id?: string };
    if (!data.id) throw new EmailFailure(true, 'Email provider returned no message ID');
    return data.id;
  }
}
