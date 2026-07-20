import { describe, it, expect } from 'vitest';
import { buildPipeline, buildSend, type StageInput, type OsItem } from './os-summary';

const item = (id: string): OsItem => ({ id, title: id, subtitle: '' });

describe('buildPipeline', () => {
  it('returns the four stages in fixed lifecycle order with labels', () => {
    const empty: StageInput = { count: 0, items: [] };
    const p = buildPipeline({ leads: empty, quotes: empty, jobs: empty, invoiced: empty });
    expect(p.stages.map((s) => s.key)).toEqual(['leads', 'quotes', 'jobs', 'invoiced']);
    expect(p.stages.map((s) => s.label)).toEqual(['Leads', 'Quotes', 'Jobs', 'Invoiced']);
  });

  it('carries counts and items through per stage', () => {
    const p = buildPipeline({
      leads: { count: 4, items: [item('a'), item('b')] },
      quotes: { count: 3, items: [item('q')] },
      jobs: { count: 6, items: [] },
      invoiced: { count: 2, items: [item('i')] },
    });
    expect(p.stages.find((s) => s.key === 'leads')!.count).toBe(4);
    expect(p.stages.find((s) => s.key === 'leads')!.items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(p.stages.find((s) => s.key === 'jobs')!.count).toBe(6);
    expect(p.stages.find((s) => s.key === 'invoiced')!.items).toHaveLength(1);
  });

  it('defaults missing buckets to zero/empty', () => {
    const p = buildPipeline({} as any);
    expect(p.stages.every((s) => s.count === 0 && s.items.length === 0)).toBe(true);
  });
});

describe('buildSend', () => {
  it('assembles readyToSend and threads', () => {
    const s = buildSend([item('q1')], [item('t1'), item('t2')]);
    expect(s.readyToSend.map((i) => i.id)).toEqual(['q1']);
    expect(s.threads).toHaveLength(2);
  });
});
