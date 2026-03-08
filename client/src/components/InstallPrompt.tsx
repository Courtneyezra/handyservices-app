import { useState, useEffect, useCallback } from "react";
import { X, Smartphone, Share, PlusSquare, ArrowDown } from "lucide-react";

/**
 * PWA Install Prompt — shows a popup encouraging the user to add
 * the app to their phone homescreen. Handles both:
 *   - Android/Chrome: uses the native beforeinstallprompt event
 *   - iOS Safari: shows manual share-sheet instructions
 *
 * Only shows once per device (dismissed state saved to localStorage).
 */
export default function InstallPrompt() {
  const [show, setShow] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // Already running as installed PWA — don't show
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true;
    setIsStandalone(standalone);
    if (standalone) return;

    // Already dismissed
    if (localStorage.getItem("pwa-install-dismissed")) return;

    // Detect iOS
    const ua = navigator.userAgent;
    const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    setIsIOS(ios);

    if (ios) {
      // On iOS show after a short delay
      const timer = setTimeout(() => setShow(true), 2000);
      return () => clearTimeout(timer);
    }

    // Android / Chrome — listen for the native install prompt
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;
    if (result.outcome === "accepted") {
      dismiss();
    }
    setDeferredPrompt(null);
  }, [deferredPrompt]);

  const dismiss = () => {
    setShow(false);
    localStorage.setItem("pwa-install-dismissed", "1");
  };

  if (!show || isStandalone) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-card border border-border rounded-t-2xl sm:rounded-2xl w-full max-w-sm mx-auto p-6 space-y-5 shadow-2xl animate-in slide-in-from-bottom-4 duration-300">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-amber-500/20 flex items-center justify-center">
              <Smartphone className="w-6 h-6 text-amber-400" />
            </div>
            <div>
              <h3 className="font-bold text-foreground text-lg leading-tight">
                Add to Home Screen
              </h3>
              <p className="text-muted-foreground text-sm">
                One-tap access to Live Call
              </p>
            </div>
          </div>
          <button
            onClick={dismiss}
            className="text-muted-foreground hover:text-foreground p-1 -mr-1 -mt-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        {isIOS ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Add the Switchboard to your iPhone home screen for instant access:
            </p>
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-sm">
                <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center shrink-0">
                  <Share className="w-4 h-4 text-blue-400" />
                </div>
                <span className="text-foreground">
                  Tap the <strong>Share</strong> button at the bottom of Safari
                </span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center shrink-0">
                  <ArrowDown className="w-4 h-4 text-blue-400" />
                </div>
                <span className="text-foreground">
                  Scroll down and tap <strong>"Add to Home Screen"</strong>
                </span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <div className="w-8 h-8 rounded-lg bg-green-500/20 flex items-center justify-center shrink-0">
                  <PlusSquare className="w-4 h-4 text-green-400" />
                </div>
                <span className="text-foreground">
                  Tap <strong>Add</strong> — done!
                </span>
              </div>
            </div>
            <button
              onClick={dismiss}
              className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-semibold text-sm transition-colors"
            >
              Got it
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Get a home screen shortcut that opens straight to the Live Switchboard — no browser needed.
            </p>
            <button
              onClick={handleInstall}
              className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-semibold text-sm transition-colors flex items-center justify-center gap-2"
            >
              <PlusSquare className="w-4 h-4" />
              Install App
            </button>
            <button
              onClick={dismiss}
              className="w-full py-2 text-muted-foreground hover:text-foreground text-sm transition-colors"
            >
              Maybe later
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
