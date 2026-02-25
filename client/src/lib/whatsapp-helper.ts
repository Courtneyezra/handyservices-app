/**
 * WhatsApp Helper - Handles opening WhatsApp with error detection and fallbacks
 *
 * Problems this solves:
 * 1. window.open() can fail silently if popup blocked
 * 2. No feedback if WhatsApp isn't installed
 * 3. User thinks action succeeded even if it didn't
 *
 * Solution:
 * - Detect if popup was blocked (window.open returns null)
 * - Provide clipboard fallback with phone number for manual messaging
 * - Return structured result for caller to handle appropriately
 */

export interface WhatsAppOpenResult {
  success: boolean;
  error?: 'popup_blocked' | 'clipboard_failed';
  fallbackUsed?: boolean;
  phone: string;
  message: string;
}

/**
 * Formats a phone number for WhatsApp
 * Removes spaces, handles UK numbers (converts 0 prefix to 44)
 */
export function formatPhoneForWhatsApp(phone: string): string {
  let whatsappPhone = phone.replace(/\s+/g, '');

  // Remove + prefix
  if (whatsappPhone.startsWith('+')) {
    whatsappPhone = whatsappPhone.slice(1);
  }

  // Handle UK numbers starting with 0
  if (whatsappPhone.startsWith('0')) {
    whatsappPhone = '44' + whatsappPhone.slice(1);
  }

  // If no country code, assume UK
  if (!whatsappPhone.startsWith('44') && whatsappPhone.length <= 11) {
    whatsappPhone = '44' + whatsappPhone;
  }

  return whatsappPhone;
}

/**
 * Build WhatsApp URL
 */
export function buildWhatsAppUrl(phone: string, message: string): string {
  const formattedPhone = formatPhoneForWhatsApp(phone);
  const encodedMessage = encodeURIComponent(message);
  return `https://wa.me/${formattedPhone}?text=${encodedMessage}`;
}

/**
 * Format phone for display (makes it easier for user to dial/message manually)
 */
export function formatPhoneForDisplay(phone: string): string {
  const formatted = formatPhoneForWhatsApp(phone);
  // Add + prefix for display
  return '+' + formatted;
}

/**
 * Copy message and phone number to clipboard
 * Returns true if successful
 */
export async function copyWhatsAppFallback(phone: string, message: string): Promise<boolean> {
  const formattedPhone = formatPhoneForDisplay(phone);
  const fallbackText = `Phone: ${formattedPhone}\n\nMessage:\n${message}`;

  try {
    await navigator.clipboard.writeText(fallbackText);
    return true;
  } catch (err) {
    console.error('[WhatsApp Helper] Failed to copy to clipboard:', err);
    return false;
  }
}

/**
 * Attempt to open WhatsApp with the given phone and message
 *
 * If popup is blocked, attempts clipboard fallback automatically
 * Returns result object so caller can show appropriate feedback
 */
export async function openWhatsApp(
  phone: string,
  message: string
): Promise<WhatsAppOpenResult> {
  const url = buildWhatsAppUrl(phone, message);

  console.log('[WhatsApp Helper] Opening WhatsApp', { phone, url: url.substring(0, 50) + '...' });

  // Attempt to open WhatsApp
  const newWindow = window.open(url, '_blank');

  // Check if popup was blocked
  if (!newWindow || newWindow.closed || typeof newWindow.closed === 'undefined') {
    console.warn('[WhatsApp Helper] Popup blocked, attempting clipboard fallback');

    // Try clipboard fallback
    const clipboardSuccess = await copyWhatsAppFallback(phone, message);

    if (clipboardSuccess) {
      return {
        success: false,
        error: 'popup_blocked',
        fallbackUsed: true,
        phone: formatPhoneForDisplay(phone),
        message,
      };
    }

    return {
      success: false,
      error: 'popup_blocked',
      fallbackUsed: false,
      phone: formatPhoneForDisplay(phone),
      message,
    };
  }

  return {
    success: true,
    phone: formatPhoneForDisplay(phone),
    message,
  };
}

/**
 * Generate toast message for WhatsApp failures
 */
export function getWhatsAppErrorMessage(result: WhatsAppOpenResult): {
  title: string;
  description: string;
} {
  if (result.fallbackUsed) {
    return {
      title: 'WhatsApp blocked - Message copied!',
      description: `Message copied to clipboard. Send manually to ${result.phone}`,
    };
  }

  return {
    title: 'WhatsApp failed to open',
    description: `Please message ${result.phone} manually. Tap to copy message.`,
  };
}
