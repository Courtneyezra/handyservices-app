/**
 * The new-desk routes, which of them render full screen outside the admin shell, and the one
 * breakpoint their layouts share. Kept apart so the app entry can match a route, and either page can
 * read the breakpoint, without loading the other page's module. The diary joins the list when it
 * lands: that is the whole layout from here on (captain, 17 Sep 2026).
 */
import { useEffect, useState } from "react";

export const HANDY_DESK_PATH = "/admin/handy-desk";
export const COMMS_BOARD_PATH = "/admin/comms-v2";

export const FULL_SCREEN_ADMIN_PATHS: readonly string[] = [HANDY_DESK_PATH, COMMS_BOARD_PATH];

/** Whether this path is one of them, with or without its trailing slash. */
export function isFullScreenAdmin(path: string): boolean {
    return FULL_SCREEN_ADMIN_PATHS.includes(path.replace(/\/$/, ""));
}

/**
 * At this width and up an open case file shows as a panel over the page, only while one is open.
 * Below it, a full-screen sheet (`ThreadSheet`), chat-first, with a way back. jsdom has no
 * matchMedia: defaults to narrow, which is the sheet behaviour most tests exercise.
 */
const WIDE_BOARD_QUERY = "(min-width: 1024px)";

export function useIsWideBoard(): boolean {
    const [wide, setWide] = useState<boolean>(() => typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(WIDE_BOARD_QUERY).matches : false);
    useEffect(() => {
        if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
        const mq = window.matchMedia(WIDE_BOARD_QUERY);
        const on = () => setWide(mq.matches);
        on();
        if (typeof mq.addEventListener === "function") { mq.addEventListener("change", on); return () => mq.removeEventListener("change", on); }
        mq.addListener?.(on);
        return () => mq.removeListener?.(on);
    }, []);
    return wide;
}
