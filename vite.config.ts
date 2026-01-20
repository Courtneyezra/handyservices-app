import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
  ],
  server: {
    host: true,
    hmr: {
      clientPort: 5001,
    },
    proxy: {
      '/api': {
        target: 'http://localhost:5001',
        changeOrigin: true,
      },
      '/leads': {
        target: 'http://localhost:5001',
        changeOrigin: true,
      }
    }
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client", "src"),
      "@shared": path.resolve(__dirname, "shared"),
      "@assets": path.resolve(__dirname, "src", "assets"),
    },
  },
  root: path.resolve(__dirname, "client"),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React - cached separately
          'vendor-react': ['react', 'react-dom'],

          // UI components library - stable, good for caching
          'vendor-radix': [
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-popover',
            '@radix-ui/react-select',
            '@radix-ui/react-tabs',
            '@radix-ui/react-toast',
            '@radix-ui/react-tooltip',
          ],

          // Animation and motion
          'vendor-motion': ['framer-motion'],

          // Payment processing - only needed on quote pages
          'vendor-stripe': ['@stripe/react-stripe-js', '@stripe/stripe-js'],

          // Maps - only needed on contractor/handyman pages
          'vendor-maps': ['leaflet', 'react-leaflet'],

          // Icons
          'vendor-icons': ['lucide-react', 'react-icons'],

          // Data fetching
          'vendor-query': ['@tanstack/react-query'],
        },
      },
    },
  },
});
