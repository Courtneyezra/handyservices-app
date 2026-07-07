import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';

/**
 * Multi-entry Vite build for the Chrome extension.
 * Each entry is emitted as its own file so we can reference them from manifest.json.
 * After build, we copy manifest.json and popup.html into dist/ so the folder is
 * directly loadable via chrome://extensions "Load unpacked".
 */
export default defineConfig({
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        target: 'es2022',
        rollupOptions: {
            input: {
                content: resolve(__dirname, 'src/content.ts'),
                background: resolve(__dirname, 'src/background.ts'),
                popup: resolve(__dirname, 'src/popup.ts'),
            },
            output: {
                entryFileNames: '[name].js',
                chunkFileNames: 'chunks/[name]-[hash].js',
                assetFileNames: 'assets/[name][extname]',
                format: 'es',
            },
        },
        minify: false, // easier debugging while we're finding DOM selectors
        sourcemap: 'inline',
    },
    plugins: [
        {
            name: 'copy-static-assets',
            closeBundle() {
                const distDir = resolve(__dirname, 'dist');
                if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });
                copyFileSync(
                    resolve(__dirname, 'manifest.json'),
                    resolve(distDir, 'manifest.json'),
                );
                copyFileSync(
                    resolve(__dirname, 'src/popup.html'),
                    resolve(distDir, 'popup.html'),
                );
                // Copy icon PNGs
                const iconsSrc = resolve(__dirname, 'public/icons');
                const iconsDest = resolve(distDir, 'icons');
                if (!existsSync(iconsDest)) mkdirSync(iconsDest, { recursive: true });
                for (const size of [16, 32, 48, 128]) {
                    const name = `icon-${size}.png`;
                    if (existsSync(resolve(iconsSrc, name))) {
                        copyFileSync(resolve(iconsSrc, name), resolve(iconsDest, name));
                    }
                }
            },
        },
    ],
});
