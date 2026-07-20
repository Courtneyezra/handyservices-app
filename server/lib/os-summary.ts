/**
 * Admin OS — Pipeline + Send shaping (DB-free, unit-tested).
 * The DB glue lives in server/os-routes.ts. See docs/contractor-platform §5a.
 */

export interface OsItem {
  id: string;
  title: string;
  subtitle: string;
}

export interface PipelineStage {
  key: 'leads' | 'quotes' | 'jobs' | 'invoiced';
  label: string;
  count: number;
  items: OsItem[];
}

export interface OsPipeline {
  stages: PipelineStage[];
}

export interface StageInput {
  count: number;
  items: OsItem[];
}

const STAGE_ORDER: Array<{ key: PipelineStage['key']; label: string }> = [
  { key: 'leads', label: 'Leads' },
  { key: 'quotes', label: 'Quotes' },
  { key: 'jobs', label: 'Jobs' },
  { key: 'invoiced', label: 'Invoiced' },
];

/** Pure: assemble the four pipeline stages in fixed lifecycle order. */
export function buildPipeline(buckets: Record<PipelineStage['key'], StageInput>): OsPipeline {
  return {
    stages: STAGE_ORDER.map(({ key, label }) => ({
      key,
      label,
      count: buckets[key]?.count ?? 0,
      items: buckets[key]?.items ?? [],
    })),
  };
}

export interface OsSend {
  readyToSend: OsItem[];
  threads: OsItem[];
}

/** Pure: assemble the Send workspace (quotes to send + conversations to progress). */
export function buildSend(readyToSend: OsItem[], threads: OsItem[]): OsSend {
  return { readyToSend, threads };
}
