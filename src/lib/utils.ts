import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Combines multiple class names using clsx and tailwind-merge
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formats a number as GBP currency
 */
export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Calculates the width percentage for progress bars
 */
export function calculateProgressWidth(
  value: number, 
  min: number, 
  max: number, 
  reverse = false
): string {
  const percentage = ((value - min) / (max - min)) * 100;
  const normalized = Math.min(100, Math.max(0, percentage));
  return reverse ? `${100 - normalized}%` : `${normalized}%`;
}

/**
 * Gets the first name from a full name
 */
export function getFirstName(fullName: string): string {
  if (!fullName) return '';
  return fullName.split(' ')[0];
}

/**
 * Custom sleep function for async operations
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Formats a phone number for display
 */
export function formatPhoneNumber(phone: string): string {
  if (!phone) return '';
  
  // Remove any non-digit characters
  const digits = phone.replace(/\D/g, '');
  
  // UK mobile format: 07xxx xxx xxx
  if (digits.startsWith('07') && digits.length === 11) {
    return `${digits.slice(0, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
  }
  
  // UK landline format: 0xxx xxx xxxx
  if (digits.startsWith('0') && digits.length === 11) {
    return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }
  
  // International format or fallback
  return phone;
}
