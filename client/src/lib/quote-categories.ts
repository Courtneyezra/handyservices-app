/**
 * The quote engine's job categories — one list, shared by every surface that
 * lets an operator pick or correct a line's category (contextual builder,
 * comms quote-prep panel). Values must match what /api/pricing/parse-job and
 * the multi-line engine understand.
 */
export const CATEGORY_LABELS: Record<string, string> = {
  general_fixing: 'General Fixing',
  flat_pack: 'Flat Pack Assembly',
  tv_mounting: 'TV Mounting',
  carpentry: 'Carpentry',
  plumbing_minor: 'Plumbing (Minor)',
  electrical_minor: 'Electrical (Minor)',
  painting: 'Painting',
  tiling: 'Tiling',
  plastering: 'Plastering',
  lock_change: 'Lock Change',
  guttering: 'Guttering',
  pressure_washing: 'Pressure Washing',
  fencing: 'Fencing',
  garden_maintenance: 'Garden Maintenance',
  bathroom_fitting: 'Bathroom Fitting',
  kitchen_fitting: 'Kitchen Fitting',
  door_fitting: 'Door Fitting',
  flooring: 'Flooring',
  curtain_blinds: 'Curtain & Blinds',
  silicone_sealant: 'Silicone / Sealant',
  shelving: 'Shelving',
  furniture_repair: 'Furniture Repair',
  waste_removal: 'Waste Removal',
  other: 'Other',
};

export const CATEGORY_OPTIONS = Object.entries(CATEGORY_LABELS).map(([value, label]) => ({
  value,
  label,
}));
