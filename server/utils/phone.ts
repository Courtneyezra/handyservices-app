/**
 * Phone number utilities for UK phone formatting and validation.
 *
 * Extracted from server/phone-utils.ts to provide a clean, reusable interface.
 * All the heavy lifting is still done by phone-utils.ts; this module re-exports
 * the subset that other server code should use.
 */

import {
    normalizePhoneNumber as _normalizePhoneNumber,
    isValidUKPhone as _isValidUKPhone,
    isNonMobileUkNumber as _isNonMobileUkNumber,
    commsPhoneKey as _commsPhoneKey,
    e164FromCommsKey as _e164FromCommsKey,
    formatPhoneForDisplay as _formatPhoneForDisplay,
} from '../phone-utils';

// Re-export all functions
export const normalizePhoneNumber = _normalizePhoneNumber;
export const isValidUKPhone = _isValidUKPhone;
export const isNonMobileUkNumber = _isNonMobileUkNumber;
export const commsPhoneKey = _commsPhoneKey;
export const e164FromCommsKey = _e164FromCommsKey;
export const formatPhoneForDisplay = _formatPhoneForDisplay;

// Aliases for convenience - the phone-utils exports are verbose
export const normalizePhone = _normalizePhoneNumber;
export const formatPhone = _formatPhoneForDisplay;

/**
 * True if the number is a UK mobile (+447...).
 * This is the inverse of isNonMobileUkNumber but semantically clearer in many contexts.
 */
export function isUKMobile(phone: string | null | undefined): boolean {
    if (!phone) return false;
    const normalized = _normalizePhoneNumber(phone);
    if (!normalized?.startsWith('+44')) return false;
    return normalized.startsWith('+447');
}
