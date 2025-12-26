import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Calendar, Clock, ChevronLeft, ChevronRight, CheckCircle } from 'lucide-react';

interface DatePreference {
  preferredDate: string;
  timeSlot: 'AM' | 'PM';
  preferenceOrder: number;
}

interface DateSelectionFormProps {
  tier: 'H' | 'HH' | 'HHH';
  onSubmit: (preferences: DatePreference[]) => Promise<void>;
}

interface AvailableDate {
  date: string;
  dayName: string;
  dayNumber: number;
  monthName: string;
  daysFromNow: number;
  isLocked: boolean;
}

export function DateSelectionForm({ tier, onSubmit }: DateSelectionFormProps) {
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [showTimeAssignment, setShowTimeAssignment] = useState(false);
  const [currentDateForTimeSelection, setCurrentDateForTimeSelection] = useState<string | null>(null);
  const [timeSlots, setTimeSlots] = useState<Record<string, 'AM' | 'PM'>>({});
  const [dateOffset, setDateOffset] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get minimum days based on tier
  const getMinimumDaysForTier = (): number => {
    switch (tier) {
      case 'H':
        return 14; // Essential: 14+ days out
      case 'HH':
        return 7;  // Enhanced: 7+ days out
      case 'HHH':
        return 1;  // Elite: next day
      default:
        return 1;
    }
  };

  const minimumDays = getMinimumDaysForTier();

  // Generate available dates for selection
  const getAvailableDates = (): AvailableDate[] => {
    const dates = [];
    const today = new Date();
    
    const startOffset = Math.max(1, dateOffset + 1);
    
    for (let i = startOffset; i <= startOffset + 13; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      const dateString = date.toISOString().split('T')[0];
      
      // Check if this is a weekend (0 = Sunday, 6 = Saturday)
      const dayOfWeek = date.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      
      // Check if this date is available for the current tier
      const isAvailableForTier = i >= minimumDays;
      
      dates.push({
        date: dateString,
        dayName: date.toLocaleDateString('en-GB', { weekday: 'short' }),
        dayNumber: date.getDate(),
        monthName: date.toLocaleDateString('en-GB', { month: 'short' }),
        daysFromNow: i,
        isLocked: !isAvailableForTier || isWeekend
      });
    }
    
    return dates;
  };

  const availableDates = getAvailableDates();

  // Navigation
  const goToPreviousWeek = () => {
    setDateOffset(Math.max(0, dateOffset - 7));
  };

  const goToNextWeek = () => {
    setDateOffset(dateOffset + 7);
  };

  // Get date range for display
  const getDateRangeInfo = () => {
    const today = new Date();
    const startDate = new Date(today);
    const endDate = new Date(today);
    
    startDate.setDate(today.getDate() + Math.max(1, dateOffset + 1));
    endDate.setDate(today.getDate() + Math.max(1, dateOffset + 1) + 13);
    
    return {
      start: startDate.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' }),
      end: endDate.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' }),
    };
  };

  // Handle date click - show AM/PM popup immediately
  const handleDateClick = (date: string) => {
    if (selectedDates.includes(date)) {
      // Deselect - remove from list
      setSelectedDates(selectedDates.filter(d => d !== date));
      const newTimeSlots = { ...timeSlots };
      delete newTimeSlots[date];
      setTimeSlots(newTimeSlots);
    } else {
      // Select - show AM/PM popup if not already 3 dates
      if (selectedDates.length < 3) {
        setCurrentDateForTimeSelection(date);
        setShowTimeAssignment(true);
      }
    }
    setError(null);
  };

  // Handle time slot selection from popup
  const handleTimeSlotSelected = (timeSlot: 'AM' | 'PM') => {
    if (!currentDateForTimeSelection) return;
    
    // Add date with time slot using functional setState to ensure latest state
    const dateToAdd = currentDateForTimeSelection;
    setSelectedDates(prev => [...prev, dateToAdd]);
    setTimeSlots(prev => ({ ...prev, [dateToAdd]: timeSlot }));
    
    // Close popup
    setShowTimeAssignment(false);
    setCurrentDateForTimeSelection(null);
  };

  // Handle final submission
  const handleFinalSubmit = async () => {
    const preferences = selectedDates.map((date, index) => ({
      preferredDate: date,
      timeSlot: timeSlots[date] || 'AM',
      preferenceOrder: index + 1
    }));

    setIsSubmitting(true);
    setError(null);

    try {
      await onSubmit(preferences);
    } catch (err: any) {
      setError(err.message || 'Failed to submit preferences. Please try again.');
      setIsSubmitting(false);
      setShowTimeAssignment(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-GB', { 
      weekday: 'short',
      month: 'short', 
      day: 'numeric' 
    });
  };

  const getTierName = () => {
    switch (tier) {
      case 'H': return 'Handy Fix';
      case 'HH': return 'Hassle-Free';
      case 'HHH': return 'High Standard';
      default: return tier;
    }
  };

  // Sort selected dates chronologically
  const sortedSelectedDates = [...selectedDates].sort();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center">
        <h2 className="text-2xl font-bold text-white mb-2">
          Select Your Preferred Dates
        </h2>
        <p className="text-gray-200 text-sm mb-2">
          Choose 3 preferred appointment dates with your time preference (AM/PM)
        </p>
        <div className="text-sm text-gray-300">
          <Badge variant="secondary" className="mr-2">{getTierName()}</Badge>
          Selected {selectedDates.length} of 3 dates
        </div>
      </div>

      {/* Date Selection Grid */}
      <Card className="bg-white border-gray-300">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-gray-900 font-semibold flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Select Dates
            </h3>
            
            {/* Navigation arrows */}
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={goToPreviousWeek}
                disabled={dateOffset <= 0}
                className="h-8 w-8 p-0 text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                data-testid="button-prev-week"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              
              <span className="text-xs text-gray-600 min-w-[100px] text-center">
                {getDateRangeInfo().start} - {getDateRangeInfo().end}
              </span>
              
              <Button
                variant="ghost"
                size="sm"
                onClick={goToNextWeek}
                className="h-8 w-8 p-0 text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                data-testid="button-next-week"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
          
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2">
            {availableDates.map((date) => {
              const isLocked = date.isLocked;
              const isSelected = selectedDates.includes(date.date);
              
              // Generate tooltip message
              const getTooltipMessage = () => {
                if (!isLocked) return '';
                
                // Check if it's a weekend
                const dateObj = new Date(date.date);
                const dayOfWeek = dateObj.getDay();
                const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                
                if (isWeekend) {
                  return 'Weekend dates are not available';
                }
                
                const tierName = getTierName();
                return `${tierName} tier requires ${minimumDays} days advance booking`;
              };
              
              const dateButton = (
                <Button
                  variant="outline"
                  className={`p-2 sm:p-3 h-auto flex flex-col gap-1 relative text-center w-full ${
                    isLocked
                      ? "bg-gray-200 text-gray-400 border-gray-200 opacity-50 pointer-events-none"
                      : isSelected
                        ? "bg-green-50 text-green-900 border-green-500 border-2 shadow-md"
                        : "bg-gray-50 hover:bg-gray-100 text-gray-900 border-gray-300"
                  }`}
                  onClick={() => !isLocked && handleDateClick(date.date)}
                  data-testid={`button-date-${date.date}`}
                >
                  {isSelected && (
                    <CheckCircle className="absolute top-1 right-1 h-4 w-4 text-green-600" />
                  )}
                  <span className="text-xs font-medium">{date.dayName}</span>
                  <span className="text-lg font-bold">{date.dayNumber}</span>
                  <span className="text-xs">{date.monthName}</span>
                </Button>
              );
              
              // Wrap with tooltip if locked
              return isLocked ? (
                <TooltipProvider key={date.date}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-not-allowed">
                        {dateButton}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{getTooltipMessage()}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : (
                <div key={date.date}>
                  {dateButton}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Submit button - auto-submit when 3 dates selected */}
      {selectedDates.length === 3 && (
        <div className="text-center">
          <Button
            onClick={handleFinalSubmit}
            className="bg-[#e8b323] hover:bg-[#d4a520] text-black font-bold px-8 py-3"
            disabled={isSubmitting}
            data-testid="button-submit-preferences"
          >
            {isSubmitting ? 'Submitting...' : 'Submit Preferences'}
          </Button>
        </div>
      )}

      {/* Time Selection Dialog - Shows immediately after clicking a date */}
      <Dialog open={showTimeAssignment} onOpenChange={(open) => {
        if (!open) {
          setShowTimeAssignment(false);
          setCurrentDateForTimeSelection(null);
        }
      }}>
        <DialogContent className="bg-white border-gray-300 text-gray-900 max-w-md w-[95vw] sm:w-full mx-2 sm:mx-auto">
          <DialogHeader>
            <DialogTitle className="text-red-600 flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Choose Time Preference
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            {currentDateForTimeSelection && (
              <>
                <p className="text-sm text-gray-600">
                  Select AM or PM for <strong>{formatDate(currentDateForTimeSelection)}</strong>:
                </p>
                
                <div className="flex flex-col gap-3">
                  <Button
                    className="w-full py-6 bg-gray-50 hover:bg-gray-100 text-gray-900 border border-gray-300 text-left justify-start"
                    onClick={() => handleTimeSlotSelected('AM')}
                    data-testid="button-select-am"
                  >
                    <div className="flex flex-col">
                      <span className="font-bold text-lg">Morning (AM)</span>
                      <span className="text-sm text-gray-600">9:00 AM - 12:00 PM</span>
                    </div>
                  </Button>
                  
                  <Button
                    className="w-full py-6 bg-gray-50 hover:bg-gray-100 text-gray-900 border border-gray-300 text-left justify-start"
                    onClick={() => handleTimeSlotSelected('PM')}
                    data-testid="button-select-pm"
                  >
                    <div className="flex flex-col">
                      <span className="font-bold text-lg">Afternoon (PM)</span>
                      <span className="text-sm text-gray-600">1:00 PM - 5:00 PM</span>
                    </div>
                  </Button>
                </div>

                <Button
                  variant="destructive"
                  className="w-full"
                  onClick={() => {
                    setShowTimeAssignment(false);
                    setCurrentDateForTimeSelection(null);
                  }}
                  data-testid="button-cancel-time-selection"
                >
                  Back
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Error message */}
      {error && (
        <div className="bg-red-900/30 border border-red-500 rounded-md p-4 text-center">
          <p className="text-red-200 text-sm">{error}</p>
        </div>
      )}

      {/* Loading state */}
      {isSubmitting && (
        <div className="text-center">
          <div className="inline-flex items-center gap-2 text-gray-200">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-[#e8b323]"></div>
            <span>Submitting your preferences...</span>
          </div>
        </div>
      )}
    </div>
  );
}
