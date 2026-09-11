/**
 * Vitest setup for the `comms-v2` project (server/comms-v2/**): the shared production-database
 * refusal first (server/__tests__/setup.ts), then the machine-local env at
 * $HOME/.config/handyservices/comms-v2.env, which fills only what is still unset and never
 * DATABASE_URL. A live desk test can rely on the keys being there on this machine; the rest of
 * the server suite never sees the file.
 */
import '../__tests__/setup';
import { loadCommsV2Env } from './env';

loadCommsV2Env();
