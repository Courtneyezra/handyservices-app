import type { PolicyPack } from '../types';
import { INTENTS } from '../vocab';

/** §3.4 `internal.ben` — anything, no guards. The internal thread is Ben's own console; n/a tier. */
export const INTERNAL_BEN: PolicyPack = {
    id: 'internal.ben',
    version: 1,
    audience: 'internal',
    allowedIntents: [...INTENTS],
    guardSet: [],
    tierByIntent: {},
    defaultTier: 'SEND',
    hours: { reactiveAlways: true, proactiveFromHour: 0, proactiveToHour: 24 },
    exceptionsToBen: [],
    voiceFile: 'brand-voice/whatsapp-comms.md',
    templates: {},
};
