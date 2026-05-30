/**
 * Phase 30 — QuoteAddressInput
 *
 * Theme-aware Google Places address field for the customer quote's booking
 * step. Reuses the loader from live-call/AddressInput but styles the input +
 * the Google dropdown for the quote's slate/green palette (light AND dark),
 * so capturing the address here removes the later "what's the address?" chase.
 *
 * On a Places selection it returns the formatted address + postcode + lat/lng;
 * manual typing still works (validated flag just gates the green tick).
 */
import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, MapPin } from 'lucide-react';
import { loadGooglePlacesScript, type AddressDetails } from '@/components/live-call/AddressInput';

interface QuoteAddressInputProps {
  value: string;
  onChange: (value: string, details?: AddressDetails) => void;
  onValidatedChange?: (validated: boolean) => void;
  isDarkTheme?: boolean;
  placeholder?: string;
}

const PAC_STYLE_ID = 'quote-pac-style';

function ensurePacStyle(isDarkTheme: boolean) {
  let el = document.getElementById(PAC_STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = PAC_STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = isDarkTheme
    ? `.pac-container{background:#1e293b;border:1px solid rgba(255,255,255,.12);border-radius:10px;margin-top:4px;font-family:inherit;z-index:99999;box-shadow:0 12px 32px rgba(0,0,0,.45)}
       .pac-item{color:rgba(255,255,255,.85);padding:8px 12px;border-top:1px solid rgba(255,255,255,.06);cursor:pointer}
       .pac-item:first-child{border-top:none}
       .pac-item:hover,.pac-item-selected{background:rgba(125,176,14,.18)}
       .pac-item-query{color:#fff;font-size:14px}.pac-matched{font-weight:600}
       .pac-icon{filter:invert(1) opacity(.5)}.pac-logo::after{display:none}`
    : `.pac-container{border:1px solid #e2e8f0;border-radius:10px;margin-top:4px;font-family:inherit;z-index:99999;box-shadow:0 12px 32px rgba(2,6,23,.12)}
       .pac-item{color:#334155;padding:8px 12px;border-top:1px solid #f1f5f9;cursor:pointer}
       .pac-item:first-child{border-top:none}
       .pac-item:hover,.pac-item-selected{background:rgba(125,176,14,.12)}
       .pac-item-query{color:#0f172a;font-size:14px}.pac-matched{font-weight:600}
       .pac-logo::after{display:none}`;
}

export function QuoteAddressInput({
  value,
  onChange,
  onValidatedChange,
  isDarkTheme = false,
  placeholder = 'Start typing your address…',
}: QuoteAddressInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const acRef = useRef<any>(null);
  const onChangeRef = useRef(onChange);
  const onValidRef = useRef(onValidatedChange);
  onChangeRef.current = onChange;
  onValidRef.current = onValidatedChange;

  const [apiLoaded, setApiLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [validated, setValidated] = useState(false);

  useEffect(() => {
    loadGooglePlacesScript().then((ok) => {
      setApiLoaded(ok);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!apiLoaded || !inputRef.current || acRef.current) return;
    const places = window.google?.maps?.places;
    if (!places) return;
    ensurePacStyle(isDarkTheme);
    try {
      const ac = new places.Autocomplete(inputRef.current, {
        componentRestrictions: { country: 'gb' },
        fields: ['formatted_address', 'address_components', 'geometry'],
        types: ['address'],
      });
      ac.addListener('place_changed', () => {
        const place = ac.getPlace();
        if (!place.formatted_address) return;
        const postcode = place.address_components?.find((c) => c.types.includes('postal_code'))?.long_name;
        const details: AddressDetails = {
          formattedAddress: place.formatted_address,
          postcode,
          lat: place.geometry?.location?.lat(),
          lng: place.geometry?.location?.lng(),
        };
        onChangeRef.current(place.formatted_address, details);
        setValidated(true);
        onValidRef.current?.(true);
      });
      acRef.current = ac;
    } catch {
      /* fall back to manual entry */
    }
  }, [apiLoaded, isDarkTheme]);

  return (
    <div className="relative">
      <MapPin className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isDarkTheme ? 'text-slate-500' : 'text-slate-400'}`} />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          setValidated(false);
          onValidRef.current?.(false);
          onChange(e.target.value);
        }}
        placeholder={placeholder}
        autoComplete="off"
        className={`w-full rounded-lg border pl-9 pr-9 py-3 text-base outline-none focus:ring-2 focus:ring-[#7DB00E]/40 ${
          validated
            ? (isDarkTheme ? 'border-[#7DB00E]/60 bg-slate-800 text-white' : 'border-[#7DB00E]/60 bg-white text-slate-900')
            : (isDarkTheme ? 'border-white/20 bg-slate-800 text-white placeholder:text-slate-500' : 'border-slate-200 bg-white text-slate-900 placeholder:text-slate-400')
        }`}
      />
      <div className="absolute right-3 top-1/2 -translate-y-1/2">
        {loading ? (
          <Loader2 className={`w-4 h-4 animate-spin ${isDarkTheme ? 'text-slate-500' : 'text-slate-400'}`} />
        ) : validated ? (
          <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#7DB00E]/20">
            <Check className="w-3 h-3 text-[#7DB00E]" strokeWidth={3} />
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default QuoteAddressInput;
