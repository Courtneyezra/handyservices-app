import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { ArrowRight, Video, MessageCircle, Zap, Loader2, CheckCircle, Clock, Shield, Home, MapPin, Gift, Mic, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import mikeAvatar from '@assets/Untitled_design_(22)_1765479867985.png';
import heroImage from "@assets/f7550ab2-8282-4cf6-b2af-83496eef2eee_1764599750751.png";

interface IntakeDecision {
  intakeId: string;
  recommendation: string;
  rationale: string;
  confidence: number;
  primaryAction: {
    label: string;
    description: string;
    route: string;
    price?: string;
  };
  alternatives: Array<{
    route: string;
    label: string;
    description: string;
  }>;
  freeVideoOption?: {
    label: string;
    description: string;
    visualReason: string;
    route: string;
  };
}

interface TaskItem {
  description: string;
  originalIndex: number;
}

interface SkuInfo {
  id: string;
  skuCode: string;
  name: string;
  description: string;
  pricePence: number;
  timeEstimateMinutes: number;
  personalizedName?: string;
  materialsIncluded: string[] | null;
  materialsNote: string | null;
  category: string;
}

interface MultiTaskDetectionResult {
  originalText: string;
  tasks: TaskItem[];
  matchedServices: Array<{
    task: TaskItem;
    sku: SkuInfo;
    confidence: number;
  }>;
  unmatchedTasks: TaskItem[];
  totalMatchedPrice: number;
  hasMatches: boolean;
  hasUnmatched: boolean;
  isMixed: boolean;
  nextRoute: 'INSTANT_PRICE' | 'VIDEO_QUOTE' | 'MIXED_QUOTE';
  needsClarification?: boolean;
}

interface AddressSuggestion {
  value: string;
  address: string;
  latitude?: number;
  longitude?: number;
}

interface IntakeHeroProps {
  location: string;
  source?: string;
}

type IntakeStep = 'job' | 'address' | 'result';

function getRouteIcon(recommendation: string, hasFreeVideoOption: boolean) {
  if (recommendation === 'VIDEO_QUOTE' && hasFreeVideoOption) {
    return <Home className="w-8 h-8" />;
  }
  switch (recommendation) {
    case 'VIDEO_QUOTE':
      return <Video className="w-8 h-8" />;
    case 'CHAT_WITH_HANDYMAN':
      return <MessageCircle className="w-8 h-8" />;
    case 'INSTANT_QUOTE':
      return <Zap className="w-8 h-8" />;
    default:
      return <ArrowRight className="w-8 h-8" />;
  }
}

const JOB_EXAMPLES = [
  "Fix my dripping tap",
  "Hang a mirror and 2 shelves",
  "Assemble my new IKEA wardrobe",
  "Seal the bath and replace a tile",
  "Mount my TV to the wall",
];

export function IntakeHero({ location, source = "landing" }: IntakeHeroProps) {
  const [, navigate] = useLocation();
  const [inputValue, setInputValue] = useState("");
  const [step, setStep] = useState<IntakeStep>('job');
  const [addressInput, setAddressInput] = useState("");
  const [addressSuggestions, setAddressSuggestions] = useState<AddressSuggestion[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<AddressSuggestion | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [decision, setDecision] = useState<IntakeDecision | null>(null);
  const [visualReason, setVisualReason] = useState<string>("");
  const [typingPlaceholder, setTypingPlaceholder] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [showMicTooltip, setShowMicTooltip] = useState(false);
  const addressInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const recognitionRef = useRef<any>(null);

  // Check for speech recognition support and show tooltip for first-time users
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const isSupported = !!SpeechRecognition;
    setSpeechSupported(isSupported);

    // Show tooltip for first-time users (only once)
    if (isSupported && !localStorage.getItem('micTooltipSeen')) {
      setShowMicTooltip(true);
      setTimeout(() => {
        setShowMicTooltip(false);
        localStorage.setItem('micTooltipSeen', 'true');
      }, 5000); // Auto-hide after 5 seconds
    }
  }, []);

  // Speech recognition handlers
  const startListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-GB';

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results)
        .map((result: any) => result[0].transcript)
        .join('');
      setInputValue(transcript);
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }
  };

  // Typing animation effect
  useEffect(() => {
    if (inputValue.length > 0) return; // Don't animate if user is typing

    let exampleIndex = 0;
    let charIndex = 0;
    let isDeleting = false;
    let timeoutId: NodeJS.Timeout;

    const type = () => {
      const currentExample = JOB_EXAMPLES[exampleIndex];

      if (!isDeleting) {
        setTypingPlaceholder(currentExample.substring(0, charIndex + 1));
        charIndex++;

        if (charIndex === currentExample.length) {
          isDeleting = true;
          timeoutId = setTimeout(type, 2000); // Pause before deleting
          return;
        }
        timeoutId = setTimeout(type, 40); // Typing speed
      } else {
        setTypingPlaceholder(currentExample.substring(0, charIndex));
        charIndex--;

        if (charIndex === 0) {
          isDeleting = false;
          exampleIndex = (exampleIndex + 1) % JOB_EXAMPLES.length;
          timeoutId = setTimeout(type, 500); // Pause before next example
          return;
        }
        timeoutId = setTimeout(type, 20); // Deleting speed
      }
    };

    timeoutId = setTimeout(type, 1000); // Initial delay

    return () => clearTimeout(timeoutId);
  }, [inputValue]);

  useEffect(() => {
    if (addressInput.length < 3 || selectedAddress) {
      setAddressSuggestions([]);
      return;
    }

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const response = await fetch(`/api/address-autocomplete?q=${encodeURIComponent(addressInput)}`);
        const data = await response.json();
        setAddressSuggestions(data.suggestions || []);
        setShowSuggestions(true);
      } catch (error) {
        console.error('Error fetching address suggestions:', error);
      }
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [addressInput, selectedAddress]);

  // Multi-task SKU detection mutation - splits jobs and detects matches
  const skuDetectMutation = useMutation({
    mutationFn: async (text: string) => {
      const response = await apiRequest('POST', '/api/intake/sku-detect-multi', { text });
      return await response.json() as MultiTaskDetectionResult;
    },
    onSuccess: (data) => {
      sessionStorage.setItem('intakeJobText', inputValue.trim());

      // If clarification is needed (repair vs replace), always go to mixed-quote for the clarification UI
      if (data.needsClarification) {
        sessionStorage.setItem('multiTaskResult', JSON.stringify(data));
        navigate('/mixed-quote');
      }
      // Single SKU match - show instant price for just that one
      else if (data.nextRoute === 'INSTANT_PRICE' && data.matchedServices.length === 1) {
        sessionStorage.setItem('matchedSku', JSON.stringify(data.matchedServices[0].sku));
        sessionStorage.setItem('skuIntakeId', data.matchedServices[0].sku.id);
        navigate('/instant-price');
      }
      // Multiple matches (all SKUs matched) OR mixed (some matched, some custom) - show mixed quote
      else if (data.matchedServices.length > 1 || data.nextRoute === 'MIXED_QUOTE') {
        sessionStorage.setItem('multiTaskResult', JSON.stringify(data));
        navigate('/mixed-quote');
      }
      // No matches - go to video quote flow
      else {
        preAnalyzeMutation.mutate(inputValue.trim());
      }
    },
    onError: () => {
      preAnalyzeMutation.mutate(inputValue.trim());
    },
  });

  // Pre-analyze mutation - runs GPT analysis when "Get Quote" is clicked
  const preAnalyzeMutation = useMutation({
    mutationFn: async (text: string) => {
      const response = await apiRequest('POST', '/api/intake/pre-analyze', { text });
      return await response.json() as { visualReason: string; needsVisual: boolean };
    },
    onSuccess: (data) => {
      sessionStorage.setItem('intakeJobText', inputValue.trim());
      sessionStorage.setItem('intakeVisualReason', data.visualReason);
      navigate('/address');
    },
  });

  const intakeMutation = useMutation({
    mutationFn: async (text: string) => {
      const address = selectedAddress?.address || addressInput.trim();
      const response = await apiRequest('POST', '/api/intake/decision', {
        text,
        source,
        address,
        latitude: selectedAddress?.latitude,
        longitude: selectedAddress?.longitude,
      });
      return await response.json() as IntakeDecision;
    },
    onSuccess: (data) => {
      setDecision(data);
      setStep('result');
    },
  });

  const handleJobSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim().length > 0) {
      skuDetectMutation.mutate(inputValue.trim());
    }
  };

  const isAnalyzing = skuDetectMutation.isPending || preAnalyzeMutation.isPending;

  const handleAddressSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedAddress || addressInput.trim().length > 0) {
      intakeMutation.mutate(inputValue.trim());
    }
  };

  const handleAddressSelect = (suggestion: AddressSuggestion) => {
    setSelectedAddress(suggestion);
    // Combine value (street) and address (city) for full display
    const fullAddress = suggestion.address && suggestion.address !== suggestion.value
      ? `${suggestion.value}, ${suggestion.address}`
      : suggestion.value;
    setAddressInput(fullAddress);
    setShowSuggestions(false);
  };

  const handlePrimaryAction = () => {
    if (decision) {
      navigate(decision.primaryAction.route);
    }
  };

  const handleAlternative = (route: string) => {
    navigate(route);
  };

  if (decision) {
    const hasFreeVideoOption = !!decision.freeVideoOption;

    // When we have a free video option, show two options for assessment
    if (hasFreeVideoOption && decision.freeVideoOption) {
      return (
        <section className="bg-slate-800 px-4 lg:px-8 py-12 lg:py-20">
          <div className="max-w-3xl mx-auto">
            <div className="bg-slate-700/50 rounded-3xl p-8 lg:p-12">
              <div className="text-center mb-8">
                <h2 className="text-2xl lg:text-3xl font-bold text-white mb-4">
                  Choose how you'd like us to assess your job:
                </h2>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Paid Site Visit Option */}
                <Button
                  onClick={handlePrimaryAction}
                  className="w-full py-4 px-3 bg-amber-400 hover:bg-amber-500 text-slate-900 font-bold rounded-xl text-sm flex flex-col items-center gap-1 h-auto"
                  data-testid="button-primary-action"
                >
                  <Home className="w-6 h-6" />
                  <span>Book Quote</span>
                  <span className="text-xs font-normal">£39</span>
                </Button>

                {/* Free Video Option */}
                <Button
                  onClick={() => navigate(`/video-instant?intake=${decision.intakeId}`)}
                  className="w-full py-4 px-3 bg-green-500 hover:bg-green-600 text-white font-bold rounded-xl text-sm flex flex-col items-center gap-1 h-auto"
                  data-testid="button-free-video"
                >
                  <Video className="w-6 h-6" />
                  <span>Quick Video</span>
                  <span className="text-xs font-normal bg-white text-green-600 px-2 rounded">FREE</span>
                </Button>
              </div>
            </div>
          </div>
        </section>
      );
    }

    // Standard flow for other recommendation types
    return (
      <section className="bg-slate-800 px-4 lg:px-8 py-12 lg:py-20">
        <div className="max-w-3xl mx-auto">
          <div className="bg-slate-700/50 rounded-3xl p-8 lg:p-12">
            <div className="text-center mb-8">
              <div className="w-20 h-20 bg-amber-400 rounded-full flex items-center justify-center mx-auto mb-6 text-slate-900">
                {getRouteIcon(decision.recommendation, false)}
              </div>
              <h2 className="text-2xl lg:text-3xl font-bold text-white mb-4">
                {decision.primaryAction.label}
              </h2>
              <p className="text-white/70 text-lg mb-2">
                {decision.rationale}
              </p>
            </div>

            <Button
              onClick={handlePrimaryAction}
              className="w-full py-6 bg-amber-400 hover:bg-amber-500 text-slate-900 font-bold rounded-full text-lg mb-4"
              data-testid="button-primary-action"
            >
              {decision.primaryAction.label}
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>

            <p className="text-white/50 text-sm text-center mb-6">
              {decision.primaryAction.description}
            </p>

            {decision.alternatives.length > 0 && (
              <div className="border-t border-white/10 pt-6 mt-6">
                <p className="text-white/50 text-sm text-center mb-4">Or choose another option:</p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                  {decision.alternatives.map((alt, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleAlternative(alt.route)}
                      className="px-6 py-3 border border-white/20 text-white/80 hover:text-white hover:border-white/40 rounded-full transition-colors text-sm"
                      data-testid={`button-alternative-${idx}`}
                    >
                      {alt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    );
  }

  // Address step
  if (step === 'address') {
    return (
      <section className="bg-slate-800 px-4 lg:px-8 py-12 lg:py-20">
        <div className="max-w-3xl mx-auto">
          <div className="bg-slate-700/50 rounded-3xl p-8 lg:p-12">
            <div className="text-center mb-8">
              <img
                src={mikeAvatar}
                alt="Mike"
                width={80}
                height={80}
                loading="lazy"
                decoding="async"
                className="w-20 h-20 rounded-full mx-auto mb-6 object-cover"
              />
              <h2 className="text-2xl lg:text-3xl font-bold text-white mb-4">
                "{visualReason}"
              </h2>
              <p className="text-white/70 text-lg">
                What's your address?
              </p>
            </div>

            <form onSubmit={handleAddressSubmit} className="relative">
              <input
                ref={addressInputRef}
                type="text"
                value={addressInput}
                onChange={(e) => {
                  setAddressInput(e.target.value);
                  setSelectedAddress(null);
                }}
                onFocus={() => addressSuggestions.length > 0 && setShowSuggestions(true)}
                placeholder="Start typing your address..."
                className="w-full px-6 py-4 bg-white text-slate-900 rounded-xl text-lg placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-amber-400/30"
                data-testid="input-address"
                autoComplete="off"
              />

              {showSuggestions && addressSuggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-lg overflow-hidden z-10">
                  {addressSuggestions.map((suggestion, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleAddressSelect(suggestion)}
                      className="w-full px-4 py-3 text-left hover:bg-slate-100 border-b border-slate-100 last:border-b-0 flex items-start gap-3"
                      data-testid={`address-suggestion-${idx}`}
                    >
                      <MapPin className="w-5 h-5 text-slate-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-slate-900 font-medium">{suggestion.value}</p>
                        <p className="text-slate-500 text-sm">{suggestion.address}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              <Button
                type="submit"
                disabled={!selectedAddress && addressInput.trim().length === 0 || intakeMutation.isPending}
                className="mt-4 w-full py-4 bg-amber-400 hover:bg-amber-500 text-slate-900 font-bold rounded-full text-lg"
                data-testid="button-submit-address"
              >
                {intakeMutation.isPending ? (
                  <span className="flex items-center gap-1">
                    <span className="animate-bounce" style={{ animationDelay: '0ms' }}>.</span>
                    <span className="animate-bounce" style={{ animationDelay: '150ms' }}>.</span>
                    <span className="animate-bounce" style={{ animationDelay: '300ms' }}>.</span>
                  </span>
                ) : (
                  <>
                    Continue
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </>
                )}
              </Button>

              <button
                type="button"
                onClick={() => setStep('job')}
                className="mt-3 w-full text-white/60 hover:text-white text-sm"
              >
                ← Back to job description
              </button>
            </form>
          </div>
        </div>
      </section>
    );
  }

  // Job description step (initial) - Split layout on desktop
  return (
    <>
      {/* Christmas Banner */}
      <div className="bg-gradient-to-r from-red-600 to-green-600 px-4 py-2 flex items-center justify-center gap-2">
        <Gift className="w-4 h-4 text-white animate-bounce" />
        <p className="text-white font-semibold text-sm text-center">
          <span className="sm:hidden">Christmas slots available!</span>
          <span className="hidden sm:inline">Christmas slots still available! Book now for pre-holiday service</span>
        </p>
        <Gift className="w-4 h-4 text-white animate-bounce hidden sm:block" />
      </div>

      <section id="hero" className="bg-slate-800 px-4 lg:px-8 py-12 lg:py-20">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Left Column - Text and Form */}
            <div className="text-center lg:text-left order-2 lg:order-1">
              <div className="inline-flex items-center gap-2 bg-amber-400/20 px-4 py-2 rounded-full mb-6">
                <CheckCircle className="w-4 h-4 text-amber-400" />
                <span className="text-amber-400 font-medium text-sm">Trusted by 300+ {location} Homeowners</span>
              </div>

              {/* Tick icon for mobile */}
              <div className="lg:hidden flex justify-center mb-6">
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-amber-400 to-amber-500 flex items-center justify-center shadow-lg shadow-amber-400/30">
                  <CheckCircle className="w-12 h-12 text-slate-900" strokeWidth={2.5} />
                </div>
              </div>

              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white mb-6 leading-tight">
                The Easiest Way to Book a Handyman in <span className="text-amber-400">{location}</span>
              </h1>

              <p className="text-xl text-white font-bold mb-10 max-w-xl mx-auto lg:mx-0">
                Call or WhatsApp for an instant fixed quote.
              </p>

              {/* Primary Actions: Call & WhatsApp */}
              <div className="flex flex-col sm:flex-row gap-4 max-w-xl mx-auto lg:mx-0 mb-10">
                <Button
                  type="button"
                  onClick={() => window.location.href = "tel:+447700900000"}
                  className="flex-1 py-8 bg-amber-400 hover:bg-amber-500 text-slate-900 font-bold rounded-2xl text-xl flex items-center justify-center gap-3 shadow-lg shadow-amber-400/20 transition-transform hover:scale-105"
                >
                  <div className="bg-white/20 p-2 rounded-full">
                    <Phone className="w-6 h-6" />
                  </div>
                  <div>
                    <span className="block text-sm font-normal opacity-80 uppercase tracking-wider">Instant Quote</span>
                    Call Now
                  </div>
                </Button>

                <Button
                  type="button"
                  onClick={() => window.open("https://wa.me/447700900000", "_blank")}
                  className="flex-1 py-8 bg-[#25D366] hover:bg-[#20bd5a] text-white font-bold rounded-2xl text-xl flex items-center justify-center gap-3 shadow-lg shadow-green-500/20 transition-transform hover:scale-105"
                >
                  <div className="bg-white/20 p-2 rounded-full">
                    <MessageCircle className="w-6 h-6" />
                  </div>
                  <div>
                    <span className="block text-sm font-normal opacity-80 uppercase tracking-wider">Video Quote</span>
                    WhatsApp Us
                  </div>
                </Button>
              </div>

              {/* Secondary: Text Input */}
              <div className="max-w-xl mx-auto lg:mx-0 mb-8 border-t border-white/10 pt-8">
                <p className="text-white/60 text-sm mb-4 font-medium uppercase tracking-wider">
                  Or type your job description below
                </p>
                <form onSubmit={handleJobSubmit}>
                  <div className="flex flex-col">
                    <div className="relative">
                      <textarea
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        placeholder={inputValue.length === 0 && typingPlaceholder ? typingPlaceholder : "Describe your jobs..."}
                        className="w-full px-6 py-5 bg-white text-slate-900 rounded-2xl text-lg placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-amber-400/30 resize-none min-h-[160px]"
                        data-testid="input-job-description"
                        rows={4}
                      />
                      {speechSupported && (
                        <div className="absolute bottom-4 right-4">
                          <button
                            type="button"
                            onClick={isListening ? stopListening : startListening}
                            className={`relative p-3 rounded-full transition-all ${isListening
                              ? 'bg-red-500 hover:bg-red-600'
                              : 'bg-amber-400 hover:bg-amber-500'
                              } text-slate-900 shadow-lg`}
                            aria-label={isListening ? 'Stop recording' : 'Start voice input'}
                            data-testid="button-voice-input"
                          >
                            {isListening ? (
                              <div className="flex items-center justify-center gap-0.5">
                                <div className="w-0.5 bg-slate-900 rounded-full animate-pulse" style={{ height: '12px', animationDuration: '0.5s' }} />
                                <div className="w-0.5 bg-slate-900 rounded-full animate-pulse" style={{ height: '16px', animationDuration: '0.6s', animationDelay: '0.1s' }} />
                                <div className="w-0.5 bg-slate-900 rounded-full animate-pulse" style={{ height: '10px', animationDuration: '0.7s', animationDelay: '0.2s' }} />
                                <div className="w-0.5 bg-slate-900 rounded-full animate-pulse" style={{ height: '14px', animationDuration: '0.5s', animationDelay: '0.15s' }} />
                                <div className="w-0.5 bg-slate-900 rounded-full animate-pulse" style={{ height: '12px', animationDuration: '0.6s', animationDelay: '0.05s' }} />
                              </div>
                            ) : (
                              <Mic className="w-5 h-5" />
                            )}
                          </button>
                          {showMicTooltip && (
                            <div className="absolute bottom-full right-0 mb-2 w-48 bg-slate-900 text-white text-xs rounded-lg p-3 shadow-xl z-10">
                              <div className="absolute bottom-0 right-4 transform translate-y-1/2 rotate-45 w-2 h-2 bg-slate-900" />
                              <p className="font-semibold mb-1">🎤 Try voice input!</p>
                              <p className="text-white/80">Tap the microphone to speak your job instead of typing.</p>
                              <button
                                onClick={() => {
                                  setShowMicTooltip(false);
                                  localStorage.setItem('micTooltipSeen', 'true');
                                }}
                                className="mt-2 text-amber-400 hover:text-amber-300 text-xs font-medium"
                              >
                                Got it!
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <p className="text-white/50 text-xs mt-3 mb-3 text-center lg:text-left">
                      No obligation · Fast response · Prices upfront where possible
                    </p>

                    <Button
                      type="submit"
                      disabled={inputValue.trim().length === 0 || isAnalyzing}
                      className="w-full sm:w-auto px-6 py-3 bg-amber-400 hover:bg-amber-500 text-slate-900 font-bold rounded-full"
                      data-testid="button-submit-intake"
                    >
                      {isAnalyzing ? (
                        <span className="flex items-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Checking jobs...
                        </span>
                      ) : (
                        <>
                          Get My Quote Options
                          <ArrowRight className="w-4 h-4 ml-1" />
                        </>
                      )}
                    </Button>
                  </div>
                </form>
              </div>

              <div className="flex flex-wrap items-center justify-center lg:justify-start gap-6 text-white/60">
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-amber-400" />
                  <span>Next-day service</span>
                </div>
                <div className="flex items-center gap-2">
                  <Mic className="w-5 h-5 text-amber-400" />
                  <span>Voice recording</span>
                </div>
                <div className="flex items-center gap-2">
                  <Shield className="w-5 h-5 text-amber-400" />
                  <span>Fully insured</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-amber-400" />
                  <span>DBS checked</span>
                </div>
              </div>
            </div>

            {/* Right Column - Hero Image */}
            <div className="order-1 lg:order-2 hidden lg:block">
              <div className="relative rounded-3xl overflow-hidden max-w-lg mx-auto shadow-2xl">
                <img
                  src={heroImage}
                  alt="Handy Services handyman at customer door"
                  className="w-full h-auto object-cover"
                  loading="eager"
                  decoding="async"
                />
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
