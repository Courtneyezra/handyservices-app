import type { StoredConfig } from './types';

const DEFAULTS: StoredConfig = {
    backendUrl: 'https://handyservices.app',
    ingestToken: '',
};

export async function loadConfig(): Promise<StoredConfig> {
    const stored = await chrome.storage.local.get(['backendUrl', 'ingestToken']);
    return {
        backendUrl: (stored.backendUrl as string) || DEFAULTS.backendUrl,
        ingestToken: (stored.ingestToken as string) || DEFAULTS.ingestToken,
    };
}

export async function saveConfig(cfg: StoredConfig): Promise<void> {
    await chrome.storage.local.set({
        backendUrl: cfg.backendUrl.replace(/\/$/, ''),
        ingestToken: cfg.ingestToken.trim(),
    });
}
