/**
 * AddressInput - Google Places Autocomplete Address Input
 *
 * Features:
 * - Google Places Autocomplete API integration
 * - Shows suggestions as user types
 * - Extracts: formatted address, postcode, lat/lng
 * - Shows green checkmark when address is validated
 * - Falls back to plain text input if API not available
 * - Styled for dark theme (CallHUD compatible)
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { MapPinned, Check, Loader2 } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
// TYPE DECLARATIONS FOR GOOGLE MAPS (must come before usage)
// ═══════════════════════════════════════════════════════════════════════════

interface GooglePlacesAutocompleteOptions {
  componentRestrictions?: { country: string | string[] };
  fields?: string[];
  types?: string[];
}

interface GooglePlacesAddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

interface GooglePlacesResult {
  formatted_address?: string;
  address_components?: GooglePlacesAddressComponent[];
  geometry?: {
    location?: {
      lat(): number;
      lng(): number;
    };
  };
}

interface GooglePlacesAutocomplete {
  addListener(event: 'place_changed', handler: () => void): void;
  getPlace(): GooglePlacesResult;
}

interface GooglePlacesAPI {
  Autocomplete: new (
    input: HTMLInputElement,
    options?: GooglePlacesAutocompleteOptions
  ) => GooglePlacesAutocomplete;
}

interface GoogleMapsAPI {
  places?: GooglePlacesAPI;
}

declare global {
  interface Window {
    google?: {
      maps?: GoogleMapsAPI;
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTED TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface AddressDetails {
  formattedAddress: string;
  postcode?: string;
  lat?: number;
  lng?: number;
}

export interface AddressInputProps {
  value: string;
  onChange: (value: string, details?: AddressDetails) => void;
  placeholder?: string;
  className?: string;
  /** Whether the address has been validated via Google Places */
  isValidated?: boolean;
  /** Callback when validation status changes */
  onValidationChange?: (isValidated: boolean) => void;
}

// ═══════════════════════════════════════════════════════════════════════════
// GOOGLE PLACES SCRIPT LOADER
// ═══════════════════════════════════════════════════════════════════════════

const GOOGLE_PLACES_SCRIPT_ID = 'google-places-script';
const GOOGLE_PLACES_API_KEY = import.meta.env.VITE_GOOGLE_PLACES_API_KEY;

// Track script loading state globally
let scriptLoadingPromise: Promise<boolean> | null = null;

function loadGooglePlacesScript(): Promise<boolean> {
  // Return existing promise if already loading
  if (scriptLoadingPromise) {
    return scriptLoadingPromise;
  }

  // Check if already loaded
  if (window.google?.maps?.places) {
    return Promise.resolve(true);
  }

  // Check if script element already exists
  if (document.getElementById(GOOGLE_PLACES_SCRIPT_ID)) {
    // Script exists but not loaded yet, wait for it
    scriptLoadingPromise = new Promise((resolve) => {
      const checkLoaded = setInterval(() => {
        if (window.google?.maps?.places) {
          clearInterval(checkLoaded);
          resolve(true);
        }
      }, 100);
      // Timeout after 10 seconds
      setTimeout(() => {
        clearInterval(checkLoaded);
        resolve(false);
      }, 10000);
    });
    return scriptLoadingPromise;
  }

  // No API key available
  if (!GOOGLE_PLACES_API_KEY) {
    console.log('[AddressInput] No Google Places API key configured');
    return Promise.resolve(false);
  }

  // Create and load the script
  scriptLoadingPromise = new Promise((resolve) => {
    const script = document.createElement('script');
    script.id = GOOGLE_PLACES_SCRIPT_ID;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_PLACES_API_KEY}&libraries=places`;
    script.async = true;
    script.defer = true;

    script.onload = () => {
      console.log('[AddressInput] Google Places script loaded');
      resolve(true);
    };

    script.onerror = () => {
      console.error('[AddressInput] Failed to load Google Places script');
      resolve(false);
    };

    document.head.appendChild(script);
  });

  return scriptLoadingPromise;
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export function AddressInput({
  value,
  onChange,
  placeholder = 'Start typing address...',
  className,
  isValidated: externalValidated,
  onValidationChange,
}: AddressInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<GooglePlacesAutocomplete | null>(null);
  const [isApiLoaded, setIsApiLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [internalValidated, setInternalValidated] = useState(false);

  // Use external validated state if provided, otherwise internal
  const isValidated = externalValidated !== undefined ? externalValidated : internalValidated;

  // Load Google Places script on mount
  useEffect(() => {
    loadGooglePlacesScript().then((loaded) => {
      setIsApiLoaded(loaded);
      setIsLoading(false);
    });
  }, []);

  // Initialize autocomplete when API is loaded
  useEffect(() => {
    if (!isApiLoaded || !inputRef.current || autocompleteRef.current) {
      return;
    }

    const placesApi = window.google?.maps?.places;
    if (!placesApi) {
      console.error('[AddressInput] Google Places API not available');
      return;
    }

    try {
      const autocomplete = new placesApi.Autocomplete(inputRef.current, {
        componentRestrictions: { country: 'gb' }, // UK only
        fields: ['formatted_address', 'address_components', 'geometry'],
        types: ['address'],
      });

      autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace();

        if (!place.formatted_address) {
          return;
        }

        // Extract postcode from address components
        let postcode: string | undefined;
        if (place.address_components) {
          const postcodeComponent = place.address_components.find(
            (c: GooglePlacesAddressComponent) => c.types.includes('postal_code')
          );
          postcode = postcodeComponent?.long_name;
        }

        // Extract lat/lng
        const lat = place.geometry?.location?.lat();
        const lng = place.geometry?.location?.lng();

        // Build address details
        const details: AddressDetails = {
          formattedAddress: place.formatted_address,
          postcode,
          lat,
          lng,
        };

        // Update value and mark as validated
        onChange(place.formatted_address, details);
        setInternalValidated(true);
        onValidationChange?.(true);

        console.log('[AddressInput] Address selected:', details);
      });

      autocompleteRef.current = autocomplete;

      // Style the autocomplete dropdown for dark theme
      // The dropdown is created by Google and needs CSS to be styled
      const style = document.createElement('style');
      style.textContent = `
        .pac-container {
          background-color: #1a1a1a !important;
          border: 1px solid rgba(255, 255, 255, 0.1) !important;
          border-radius: 8px !important;
          margin-top: 4px !important;
          font-family: inherit !important;
          z-index: 10000 !important;
        }
        .pac-item {
          background-color: #1a1a1a !important;
          color: rgba(255, 255, 255, 0.9) !important;
          padding: 8px 12px !important;
          border-top: 1px solid rgba(255, 255, 255, 0.05) !important;
          cursor: pointer !important;
        }
        .pac-item:first-child {
          border-top: none !important;
        }
        .pac-item:hover, .pac-item-selected {
          background-color: rgba(255, 255, 255, 0.1) !important;
        }
        .pac-item-query {
          color: white !important;
          font-size: 14px !important;
        }
        .pac-matched {
          font-weight: 600 !important;
        }
        .pac-icon {
          filter: invert(1) opacity(0.5) !important;
        }
        .pac-logo::after {
          display: none !important;
        }
      `;
      document.head.appendChild(style);

      return () => {
        style.remove();
      };
    } catch (error) {
      console.error('[AddressInput] Failed to initialize autocomplete:', error);
    }
  }, [isApiLoaded, onChange, onValidationChange]);

  // Handle manual text input
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;
      // When user types manually, mark as not validated
      setInternalValidated(false);
      onValidationChange?.(false);
      onChange(newValue);
    },
    [onChange, onValidationChange]
  );

  // Determine border color based on validation state
  const getBorderClass = () => {
    if (isValidated) {
      return 'border-green-500/50';
    }
    if (value.trim().length > 0) {
      return 'border-amber-500/30';
    }
    return 'border-white/10';
  };

  return (
    <div className={cn('relative', className)}>
      <label className="flex items-center gap-2 text-white/40 text-xs mb-1.5">
        <MapPinned className="w-3.5 h-3.5" />
        Property Address
        {isLoading && (
          <Loader2 className="w-3 h-3 animate-spin text-white/30" />
        )}
        {!isLoading && !isApiLoaded && (
          <span className="text-white/20 text-[10px]">(manual entry)</span>
        )}
      </label>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleInputChange}
          placeholder={placeholder}
          className={cn(
            'w-full bg-white/5 border rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-white/30',
            'focus:outline-none focus:ring-2 focus:ring-white/20',
            'pr-9', // Space for validation icon
            getBorderClass()
          )}
          autoComplete="off"
        />
        {/* Validation indicator */}
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          {isValidated && (
            <div className="flex items-center justify-center w-5 h-5 rounded-full bg-green-500/20">
              <Check className="w-3 h-3 text-green-400" />
            </div>
          )}
        </div>
      </div>
      {/* Help text */}
      {isApiLoaded && !isValidated && value.trim().length > 0 && (
        <p className="text-amber-500/60 text-[10px] mt-1">
          Select from suggestions to validate
        </p>
      )}
      {isValidated && (
        <p className="text-green-500/60 text-[10px] mt-1">
          Address verified
        </p>
      )}
    </div>
  );
}

export default AddressInput;
