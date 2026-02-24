/**
 * Performance Benchmarks for Call Script Tube Map
 *
 * Tests performance requirements for real-time call processing:
 * - Tier 1 pattern matching: < 5ms average
 * - Info extraction: < 10ms average
 * - Full classification (Tier 1 only): < 50ms
 * - Streaming updates: < 100ms latency
 *
 * Owner: Agent 6 (Testing Agent)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  tier1PatternMatch,
  classifySegment,
  classifySegmentSync,
  StreamingClassifier,
} from '../../services/segment-classifier';
import {
  extractInfo,
  extractInfoFromEntries,
  StreamingInfoExtractor,
} from '../../services/info-extractor';
import { CallScriptStateMachine } from '../state-machine';
import { TRANSCRIPT_FIXTURES } from './fixtures/transcripts';
import { measureLatency, measureAverageLatency } from './utils/test-helpers';

describe('Performance Benchmarks', () => {
  const sampleTranscript = `
    Hi, I have a rental property in Brixton. My tenant reported that the boiler
    isn't working. I'm not local, I live in Manchester. Can you coordinate with
    the tenant directly? I'll need photos and a proper invoice for my records.
  `;

  const shortTranscript = 'I have a rental property with a tenant';

  const longTranscript = `
    Hi there, I hope you can help me. I have a rental property in Brixton, South London.
    The postcode is SW2 5AB. My tenant called me this morning to say the boiler has stopped
    working completely. No hot water, no heating. It's been like this since yesterday.

    I'm not local myself - I live up in Manchester, about 4 hours away. So I can't be there
    to let anyone in. But my tenant is working from home this week so they can provide access.
    Their name is John Smith and they're available most of the day.

    I've used other handyman services before but they weren't very reliable. I need someone
    who can coordinate with the tenant directly, send me photos of the work, and provide
    a proper invoice for my records - it's for my accountant, you know, tax purposes.

    The boiler is a Worcester Greenstar 25i, about 8 years old. It's been serviced regularly
    but this is the first major issue we've had. The tenant said it's making a clicking sound
    but not firing up. Could be the ignition or maybe the gas valve.

    I'd like to get this sorted as quickly as possible. My tenant has young kids and they
    need hot water. What's your availability like this week? And can you give me a rough
    idea of cost before we proceed?
  `;

  describe('Tier 1 Pattern Matching', () => {
    it('should process short transcript in < 2ms', async () => {
      const latency = await measureLatency(async () => {
        tier1PatternMatch(shortTranscript);
      });
      expect(latency).toBeLessThan(2);
    });

    it('should process medium transcript in < 5ms', async () => {
      const latency = await measureLatency(async () => {
        tier1PatternMatch(sampleTranscript);
      });
      expect(latency).toBeLessThan(5);
    });

    it('should process long transcript in < 10ms', async () => {
      const latency = await measureLatency(async () => {
        tier1PatternMatch(longTranscript);
      });
      expect(latency).toBeLessThan(10);
    });

    it('should average < 5ms over 100 runs', async () => {
      const times: number[] = [];

      for (let i = 0; i < 100; i++) {
        const start = performance.now();
        tier1PatternMatch(sampleTranscript);
        times.push(performance.now() - start);
      }

      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      const p95 = times.sort((a, b) => a - b)[94];
      const p99 = times.sort((a, b) => a - b)[98];

      console.log(`  Tier 1 Pattern Matching:`);
      console.log(`    Average: ${avg.toFixed(3)}ms`);
      console.log(`    P95: ${p95.toFixed(3)}ms`);
      console.log(`    P99: ${p99.toFixed(3)}ms`);

      expect(avg).toBeLessThan(5);
      expect(p95).toBeLessThan(10);
    });

    it('should maintain performance with many segments checked', async () => {
      // Text that matches multiple segments
      const multiMatchText = `
        I have a rental property (LANDLORD), I'm at work all day (BUSY_PRO),
        I manage 15 properties (PROP_MGR), I live alone (OAP), it's my shop (SMALL_BIZ),
        there's flooding (EMERGENCY), how much per hour (BUDGET)
      `;

      const latency = await measureLatency(async () => {
        const result = tier1PatternMatch(multiMatchText);
        expect(result.length).toBeGreaterThan(3); // Should match multiple
      });

      expect(latency).toBeLessThan(10);
    });
  });

  describe('Sync Classification', () => {
    it('should classify in < 10ms', async () => {
      const latency = await measureLatency(async () => {
        classifySegmentSync(sampleTranscript);
      });
      expect(latency).toBeLessThan(10);
    });

    it('should average < 5ms over 100 runs', async () => {
      const times: number[] = [];

      for (let i = 0; i < 100; i++) {
        const start = performance.now();
        classifySegmentSync(sampleTranscript);
        times.push(performance.now() - start);
      }

      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      console.log(`  Sync Classification average: ${avg.toFixed(3)}ms`);
      expect(avg).toBeLessThan(5);
    });
  });

  describe('Async Classification (Tier 1 only)', () => {
    it('should classify in < 50ms with Tier 2 disabled', async () => {
      const latency = await measureLatency(async () => {
        await classifySegment(sampleTranscript, { useTier2: false });
      });
      expect(latency).toBeLessThan(50);
    });

    it('should average < 10ms over 50 runs', async () => {
      const times: number[] = [];

      for (let i = 0; i < 50; i++) {
        const start = performance.now();
        await classifySegment(sampleTranscript, { useTier2: false });
        times.push(performance.now() - start);
      }

      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      console.log(`  Async Classification (Tier 1) average: ${avg.toFixed(3)}ms`);
      expect(avg).toBeLessThan(10);
    });
  });

  describe('Info Extraction', () => {
    it('should extract info in < 5ms', async () => {
      const latency = await measureLatency(async () => {
        extractInfo(sampleTranscript);
      });
      expect(latency).toBeLessThan(5);
    });

    it('should average < 10ms over 100 runs', async () => {
      const times: number[] = [];

      for (let i = 0; i < 100; i++) {
        const start = performance.now();
        extractInfo(sampleTranscript);
        times.push(performance.now() - start);
      }

      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      console.log(`  Info Extraction average: ${avg.toFixed(3)}ms`);
      expect(avg).toBeLessThan(10);
    });

    it('should handle long transcripts efficiently', async () => {
      const latency = await measureLatency(async () => {
        extractInfo(longTranscript);
      });
      expect(latency).toBeLessThan(20);
    });
  });

  describe('State Machine Operations', () => {
    it('should create state machine in < 1ms', async () => {
      const latency = await measureLatency(async () => {
        new CallScriptStateMachine('test-perf-001');
      });
      expect(latency).toBeLessThan(1);
    });

    it('should update state in < 1ms', async () => {
      const machine = new CallScriptStateMachine('test-perf-002');

      const latency = await measureLatency(async () => {
        machine.updateCapturedInfo({ job: 'Fix boiler', postcode: 'SW11 2AB' });
        machine.updateSegment('LANDLORD', 85, ['rental', 'tenant', 'buy to let']);
      });
      expect(latency).toBeLessThan(1);
    });

    it('should transition station in < 1ms', async () => {
      const machine = new CallScriptStateMachine('test-perf-003');
      machine.updateCapturedInfo({ job: 'Fix boiler' });

      const latency = await measureLatency(async () => {
        machine.confirmStation();
      });
      expect(latency).toBeLessThan(1);
    });

    it('should complete full flow in < 5ms', async () => {
      const latency = await measureLatency(async () => {
        const machine = new CallScriptStateMachine('test-perf-004');

        machine.updateCapturedInfo({ job: 'Fix boiler', postcode: 'SW11 2AB' });
        machine.confirmStation(); // LISTEN -> SEGMENT

        machine.updateSegment('LANDLORD', 85, ['rental', 'tenant']);
        machine.confirmSegment('LANDLORD');
        machine.confirmStation(); // SEGMENT -> QUALIFY

        machine.setQualified(true);
        machine.confirmStation(); // QUALIFY -> DESTINATION

        machine.selectDestination('INSTANT_QUOTE');
      });
      expect(latency).toBeLessThan(5);
    });
  });

  describe('Streaming Classifier', () => {
    it('should process chunks in < 10ms each', async () => {
      const times: number[] = [];
      const classifier = new StreamingClassifier(
        () => {},
        { debounceMs: 0, useTier2: false }
      );

      const chunks = [
        'Hi there',
        'I have a rental property',
        'My tenant called',
        'about a boiler issue',
        'in Brixton SW2',
      ];

      for (const chunk of chunks) {
        const start = performance.now();
        classifier.addChunk(chunk);
        times.push(performance.now() - start);
      }

      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      console.log(`  Streaming chunk processing average: ${avg.toFixed(3)}ms`);
      expect(avg).toBeLessThan(10);

      classifier.reset();
    });

    it('should handle rapid fire chunks efficiently', async () => {
      const classifier = new StreamingClassifier(
        () => {},
        { debounceMs: 5, useTier2: false }
      );

      const start = performance.now();

      // Simulate 50 rapid chunks
      for (let i = 0; i < 50; i++) {
        classifier.addChunk(`Chunk ${i}: rental property tenant`);
      }

      const elapsed = performance.now() - start;
      console.log(`  50 rapid chunks processed in: ${elapsed.toFixed(3)}ms`);
      expect(elapsed).toBeLessThan(100);

      classifier.reset();
    });
  });

  describe('Streaming Info Extractor', () => {
    it('should process chunks in < 5ms each', async () => {
      const times: number[] = [];
      const extractor = new StreamingInfoExtractor(() => {});

      const chunks = [
        'I need a tap fixed',
        'The address is SW11 2AB',
        "I'm the owner of the property",
        'My tenant can let you in',
      ];

      for (const chunk of chunks) {
        const start = performance.now();
        extractor.addChunk(chunk);
        times.push(performance.now() - start);
      }

      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      console.log(`  Streaming info extraction average: ${avg.toFixed(3)}ms`);
      expect(avg).toBeLessThan(5);
    });
  });

  describe('Full Pipeline Performance', () => {
    it('should process complete transcript in < 20ms', async () => {
      const fixture = TRANSCRIPT_FIXTURES.LANDLORD;

      const latency = await measureLatency(async () => {
        const machine = new CallScriptStateMachine('test-pipeline-001');

        for (const entry of fixture.transcript) {
          if (entry.speaker === 'caller') {
            // Classify
            const result = classifySegmentSync(entry.text);
            if (result.primary.confidence > 30) {
              machine.updateSegment(
                result.primary.segment,
                result.primary.confidence,
                result.primary.signals
              );
            }

            // Extract info
            const info = extractInfo(entry.text);
            machine.updateCapturedInfo(info);
          }
        }
      });

      console.log(`  Full pipeline (LANDLORD fixture): ${latency.toFixed(3)}ms`);
      expect(latency).toBeLessThan(20);
    });

    it('should process all fixtures in < 200ms total', async () => {
      const fixtures = Object.entries(TRANSCRIPT_FIXTURES);
      const start = performance.now();

      for (const [name, fixture] of fixtures) {
        const machine = new CallScriptStateMachine(`test-all-${name}`);

        for (const entry of fixture.transcript) {
          if (entry.speaker === 'caller') {
            const result = classifySegmentSync(entry.text);
            machine.updateSegment(
              result.primary.segment,
              result.primary.confidence,
              result.primary.signals
            );
            const info = extractInfo(entry.text);
            machine.updateCapturedInfo(info);
          }
        }
      }

      const elapsed = performance.now() - start;
      console.log(`  All ${fixtures.length} fixtures processed in: ${elapsed.toFixed(3)}ms`);
      expect(elapsed).toBeLessThan(200);
    });
  });

  describe('Memory Efficiency', () => {
    it('should not leak memory with many state machines', () => {
      const initialMemory = process.memoryUsage().heapUsed;
      const machines: CallScriptStateMachine[] = [];

      // Create 1000 machines
      for (let i = 0; i < 1000; i++) {
        const machine = new CallScriptStateMachine(`test-memory-${i}`);
        machine.updateCapturedInfo({ job: `Job ${i}`, postcode: 'SW11 2AB' });
        machine.updateSegment('LANDLORD', 80, ['rental', 'tenant']);
        machines.push(machine);
      }

      const afterCreation = process.memoryUsage().heapUsed;
      const memoryPerMachine = (afterCreation - initialMemory) / 1000;

      console.log(`  Memory per state machine: ${(memoryPerMachine / 1024).toFixed(2)}KB`);

      // Each machine should use less than 50KB
      expect(memoryPerMachine).toBeLessThan(50 * 1024);

      // Cleanup
      machines.length = 0;
    });

    it('should handle repeated classifications without memory growth', async () => {
      const initialMemory = process.memoryUsage().heapUsed;

      for (let i = 0; i < 1000; i++) {
        tier1PatternMatch(sampleTranscript);
        extractInfo(sampleTranscript);
      }

      // Force GC if available
      if (global.gc) {
        global.gc();
      }

      const afterProcessing = process.memoryUsage().heapUsed;
      const memoryGrowth = afterProcessing - initialMemory;

      console.log(`  Memory growth after 1000 iterations: ${(memoryGrowth / 1024).toFixed(2)}KB`);

      // Memory growth should be minimal (< 10MB)
      expect(memoryGrowth).toBeLessThan(10 * 1024 * 1024);
    });
  });

  describe('Concurrent Processing', () => {
    it('should handle 10 concurrent calls efficiently', async () => {
      const start = performance.now();

      const promises = Array(10)
        .fill(null)
        .map(async (_, i) => {
          const machine = new CallScriptStateMachine(`test-concurrent-${i}`);
          const fixture = TRANSCRIPT_FIXTURES.LANDLORD;

          for (const entry of fixture.transcript) {
            if (entry.speaker === 'caller') {
              const result = await classifySegment(entry.text, { useTier2: false });
              machine.updateSegment(
                result.primary.segment,
                result.primary.confidence,
                result.primary.signals
              );
            }
          }

          return machine.getState();
        });

      const results = await Promise.all(promises);
      const elapsed = performance.now() - start;

      console.log(`  10 concurrent calls processed in: ${elapsed.toFixed(3)}ms`);
      expect(elapsed).toBeLessThan(200);
      expect(results.length).toBe(10);
    });

    it('should handle 50 concurrent classifications', async () => {
      const transcripts = Array(50)
        .fill(null)
        .map((_, i) => `I have a rental property ${i}, my tenant reported a leak`);

      const start = performance.now();
      const results = await Promise.all(
        transcripts.map((t) => classifySegment(t, { useTier2: false }))
      );
      const elapsed = performance.now() - start;

      console.log(`  50 concurrent classifications in: ${elapsed.toFixed(3)}ms`);
      expect(elapsed).toBeLessThan(500);
      expect(results.every((r) => r.primary.segment === 'LANDLORD')).toBe(true);
    });
  });
});
