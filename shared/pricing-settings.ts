export interface PricingSettings {
  // Margins & Deposits
  materialsMarginPercent: number;      // default 27
  depositPercent: number;              // default 30
  payInFullDiscountPercent: number;    // default 3

  // Booking Rules
  flexibleDiscountPercent: number;     // default 10
  urgentPremiumPercent: number;        // default 25
  depositSplitThresholdPence: number;  // default 15000 (£150)
  maxBatchDiscountPercent: number;     // default 15
  minMarginPencePerHour: number;       // default 6000 (£60/hr)

  // Social Proof
  googleRating: string;               // default "4.9"
  reviewCount: number;                 // default 127
  propertiesServed: string;            // default "230+"
  jobsCompleted: string;              // default "500+"
}

export const DEFAULT_PRICING_SETTINGS: PricingSettings = {
  materialsMarginPercent: 27,
  depositPercent: 30,
  payInFullDiscountPercent: 3,
  flexibleDiscountPercent: 10,
  urgentPremiumPercent: 25,
  depositSplitThresholdPence: 15000,
  maxBatchDiscountPercent: 15,
  minMarginPencePerHour: 6000,
  googleRating: "4.9",
  reviewCount: 127,
  propertiesServed: "230+",
  jobsCompleted: "500+",
};
