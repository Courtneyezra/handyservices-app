import Anthropic from '@anthropic-ai/sdk';
import { callerTag, recordLlmUsage } from './llm-usage';

// Initialize Anthropic (lazy initialization to allow testing without API key)
let _anthropic: Anthropic | null = null;

/**
 * Wrap messages.create so EVERY call through this client lands in the usage
 * ledger (server/llm-usage.ts) with model, tokens, ~cost and caller — the
 * "where are the tokens going" question answered by data, not archaeology.
 * Streaming calls pass through uncounted (none in this codebase today).
 */
function withUsageLedger(client: Anthropic): Anthropic {
  const realCreate = client.messages.create.bind(client.messages);
  (client.messages as any).create = (body: any, options?: any) => {
    // Caller tag must be captured NOW, synchronously — once the response promise
    // resolves, the caller's frames are no longer on any stack.
    const src = callerTag();
    const result = realCreate(body, options);
    if (!body?.stream && typeof (result as any)?.then === 'function') {
      (result as Promise<any>).then((response) => {
        if (response?.usage) recordLlmUsage(String(body?.model ?? 'unknown'), response.usage, src);
      }).catch(() => undefined);
    }
    return result;
  };
  return client;
}

export function getAnthropic(): Anthropic {
  if (!_anthropic) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        'ANTHROPIC_API_KEY is not set. AI features require an API key.',
      );
    }
    _anthropic = withUsageLedger(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }));
  }
  return _anthropic;
}

// Legacy-style proxy export for convenience
export const anthropic = new Proxy({} as Anthropic, {
  get(target, prop) {
    return (getAnthropic() as any)[prop];
  },
});
