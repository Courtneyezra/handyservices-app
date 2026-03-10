// Price calculation utilities for quote building
import type { TaskItem } from '@/types/quote-builder';

const MATERIALS_MARKUP = 1.3; // 30% markup on materials

const COMPLEXITY_MULTIPLIERS: Record<TaskItem['complexity'], number> = {
  low: 0.85,
  medium: 1.0,
  high: 1.25,
};

export interface CalculatedTotals {
  /** Effective hours (adjusted by complexity multipliers) */
  totalHours: number;
  totalMaterials: number;
  materialsWithMarkup: number;
}

/**
 * Calculate hours and materials from tasks.
 * Labor pricing is handled by EVE (see eve-pricing.ts).
 */
export function calculateTotals(tasks: TaskItem[]): CalculatedTotals {
  let totalHours = 0;
  let totalMaterials = 0;

  tasks.forEach(task => {
    const hours = (task.hours || 0) * (task.quantity || 1);
    const multiplier = COMPLEXITY_MULTIPLIERS[task.complexity] || 1.0;
    totalHours += hours * multiplier;
    totalMaterials += (task.materialCost || 0) * (task.quantity || 1);
  });

  const materialsWithMarkup = totalMaterials * MATERIALS_MARKUP;

  return {
    totalHours,
    totalMaterials,
    materialsWithMarkup,
  };
}

/**
 * Get the effective price - either from override or calculated
 */
export function getEffectivePrice(priceOverride: string, calculatedTotal: number): number {
  return priceOverride ? parseFloat(priceOverride) : calculatedTotal;
}

export { MATERIALS_MARKUP };

/**
 * Map API task response to TaskItem format
 */
export function mapApiTasksToTaskItems(apiTasks: any[]): TaskItem[] {
  return (apiTasks || []).map((t: any, idx: number) => ({
    id: `task-${idx}`,
    description: t.description || t.task || 'Task',
    quantity: t.quantity || 1,
    hours: t.estimatedHours || t.hours || 1,
    materialCost: t.materialCost || t.materials || 0,
    complexity: t.complexity || 'medium',
  }));
}

/**
 * Calculate base price from API analysis response (used as metadata only, EVE sets actual price)
 */
export function calculateBasePriceFromAnalysis(data: any): number {
  if (data.estimatedRange?.low && data.estimatedRange?.high) {
    return Math.round((data.estimatedRange.low + data.estimatedRange.high) / 2);
  } else if (data.basePricePounds) {
    return Math.round(data.basePricePounds);
  }
  return 0;
}

/**
 * Create a new empty task
 */
export function createEmptyTask(): TaskItem {
  return {
    id: `task-${Date.now()}`,
    description: 'New task',
    quantity: 1,
    hours: 1,
    materialCost: 0,
    complexity: 'medium',
  };
}

/**
 * Convert price in pounds to pence
 */
export function poundsToPence(pounds: number): number {
  return Math.round(pounds * 100);
}

/**
 * Convert price in pence to pounds
 */
export function penceToPounds(pence: number): number {
  return pence / 100;
}
