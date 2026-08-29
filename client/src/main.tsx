import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initPostHog } from "./lib/posthog";

initPostHog();

// Contractor portal gets its own PWA manifest (name/short_name/start_url) so
// installs from /contractor/* launch into the contractor dashboard.
// Known limitation: the browser reads the manifest at install-prompt time, and
// SPA navigation after initial load won't re-swap it — contractors install
// from within the portal, so swapping only on initial load is acceptable.
if (location.pathname.startsWith("/contractor")) {
  const manifestLink = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (manifestLink) manifestLink.href = "/manifest-contractor.json";
}

createRoot(document.getElementById("root")!).render(<App />);

// Register service worker for PWA / Add to Home Screen
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
