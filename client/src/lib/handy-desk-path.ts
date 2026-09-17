/**
 * The new-desk routes, and which of them render full screen outside the admin shell. Kept apart so
 * the app entry can match them without loading those pages' header code. The diary joins the list
 * when it lands: that is the whole layout from here on (captain, 17 Sep 2026).
 */
export const HANDY_DESK_PATH = "/admin/handy-desk";
export const COMMS_BOARD_PATH = "/admin/comms-v2";

export const FULL_SCREEN_ADMIN_PATHS: readonly string[] = [HANDY_DESK_PATH, COMMS_BOARD_PATH];

/** Whether this path is one of them, with or without its trailing slash. */
export function isFullScreenAdmin(path: string): boolean {
    return FULL_SCREEN_ADMIN_PATHS.includes(path.replace(/\/$/, ""));
}
