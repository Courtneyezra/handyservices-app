import Anthropic from '@anthropic-ai/sdk';

// Initialize Anthropic (lazy initialization to allow testing without API key)
let _anthropic: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (!_anthropic) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        'ANTHROPIC_API_KEY is not set. AI features require an API key.',
      );
    }
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropic;
}

// Legacy-style proxy export for convenience
export const anthropic = new Proxy({} as Anthropic, {
  get(target, prop) {
    return (getAnthropic() as any)[prop];
  },
});
