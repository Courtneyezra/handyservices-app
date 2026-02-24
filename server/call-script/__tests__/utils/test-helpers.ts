/**
 * Test Utilities for Call Script Tube Map
 *
 * Helper functions for creating mock objects, simulating real-time streams,
 * and measuring performance in tests.
 */

/**
 * Station types in the Tube Map flow
 */
export type Station = 'LISTEN' | 'SEGMENT' | 'QUALIFY' | 'DESTINATION';

/**
 * Possible destinations after qualification
 */
export type Destination = 'INSTANT_QUOTE' | 'SITE_VISIT' | 'EMERGENCY_DISPATCH' | 'EXIT' | 'CALLBACK';

/**
 * Segment types that can be detected
 */
export type SegmentType =
  | 'LANDLORD'
  | 'BUSY_PRO'
  | 'OAP'
  | 'PROP_MGR'
  | 'SMALL_BIZ'
  | 'EMERGENCY'
  | 'BUDGET'
  | 'DIY_DEFERRER'
  | 'UNKNOWN';

/**
 * Information captured during the call
 */
export interface CapturedInfo {
  job: string | null;
  postcode: string | null;
  name: string | null;
  contact: string | null;
  isDecisionMaker: boolean | null;
  isRemote: boolean | null;
  hasTenant: boolean | null;
}

/**
 * Call script state machine state
 */
export interface CallScriptState {
  callId: string;
  currentStation: Station;
  completedStations: Station[];
  detectedSegment: SegmentType | null;
  segmentConfidence: number;
  segmentSignals: string[];
  capturedInfo: CapturedInfo;
  isQualified: boolean | null;
  qualificationNotes: string[];
  recommendedDestination: Destination | null;
  selectedDestination: Destination | null;
  stationEnteredAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Transcript entry from real-time transcription
 */
export interface TranscriptChunk {
  speaker: 'agent' | 'caller';
  text: string;
  timestamp: number;
  isFinal: boolean;
}

/**
 * Create a mock call state with default values
 * @param overrides - Partial state to override defaults
 */
export function createMockCallState(overrides: Partial<CallScriptState> = {}): CallScriptState {
  const now = new Date();
  const defaultCapturedInfo: CapturedInfo = {
    job: null,
    postcode: null,
    name: null,
    contact: null,
    isDecisionMaker: null,
    isRemote: null,
    hasTenant: null,
  };

  // Extract capturedInfo from overrides for deep merge
  const { capturedInfo: overrideCapturedInfo, ...restOverrides } = overrides;

  return {
    callId: 'test-call-123',
    currentStation: 'LISTEN',
    completedStations: [],
    detectedSegment: null,
    segmentConfidence: 0,
    segmentSignals: [],
    capturedInfo: {
      ...defaultCapturedInfo,
      ...overrideCapturedInfo,
    },
    isQualified: null,
    qualificationNotes: [],
    recommendedDestination: null,
    selectedDestination: null,
    stationEnteredAt: now,
    createdAt: now,
    updatedAt: now,
    ...restOverrides,
  };
}

/**
 * Create mock captured info
 * @param overrides - Partial info to override defaults
 */
export function createMockCapturedInfo(overrides: Partial<CapturedInfo> = {}): CapturedInfo {
  return {
    job: null,
    postcode: null,
    name: null,
    contact: null,
    isDecisionMaker: null,
    isRemote: null,
    hasTenant: null,
    ...overrides,
  };
}

/**
 * Convert a simple transcript array to a stream of chunks
 * Simulates real-time transcript delivery with timestamps
 *
 * @param transcript - Array of speaker/text entries
 * @param delayMs - Simulated delay between entries (default 3000ms)
 */
export function createTranscriptStream(
  transcript: Array<{ speaker: 'agent' | 'caller'; text: string }>,
  delayMs = 3000
): TranscriptChunk[] {
  const baseTime = Date.now();
  return transcript.map((entry, index) => ({
    speaker: entry.speaker,
    text: entry.text,
    timestamp: baseTime + index * delayMs,
    isFinal: true,
  }));
}

/**
 * Create a partial/streaming transcript chunk (simulates interim results)
 *
 * @param speaker - Who is speaking
 * @param text - The partial text
 */
export function createInterimChunk(speaker: 'agent' | 'caller', text: string): TranscriptChunk {
  return {
    speaker,
    text,
    timestamp: Date.now(),
    isFinal: false,
  };
}

/**
 * Measure the latency of an async function
 *
 * @param fn - Async function to measure
 * @returns Promise resolving to latency in milliseconds
 */
export async function measureLatency(fn: () => Promise<unknown>): Promise<number> {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

/**
 * Measure average latency over multiple runs
 *
 * @param fn - Async function to measure
 * @param runs - Number of runs to average (default 5)
 * @returns Promise resolving to average latency in milliseconds
 */
export async function measureAverageLatency(
  fn: () => Promise<unknown>,
  runs = 5
): Promise<{ average: number; min: number; max: number; samples: number[] }> {
  const samples: number[] = [];

  for (let i = 0; i < runs; i++) {
    samples.push(await measureLatency(fn));
  }

  return {
    average: samples.reduce((a, b) => a + b, 0) / samples.length,
    min: Math.min(...samples),
    max: Math.max(...samples),
    samples,
  };
}

/**
 * Assert that a function completes within a time limit
 *
 * @param fn - Async function to test
 * @param maxMs - Maximum allowed time in milliseconds
 * @param description - Description for error message
 */
export async function assertCompletesWithin(
  fn: () => Promise<unknown>,
  maxMs: number,
  description = 'Operation'
): Promise<void> {
  const latency = await measureLatency(fn);
  if (latency > maxMs) {
    throw new Error(
      `${description} took ${latency.toFixed(2)}ms, exceeding limit of ${maxMs}ms`
    );
  }
}

/**
 * Create a mock WebSocket-like event emitter for testing real-time updates
 */
export function createMockWebSocket(): {
  on: (event: string, handler: (data: unknown) => void) => void;
  emit: (event: string, data: unknown) => void;
  handlers: Map<string, Array<(data: unknown) => void>>;
} {
  const handlers = new Map<string, Array<(data: unknown) => void>>();

  return {
    handlers,
    on(event: string, handler: (data: unknown) => void) {
      if (!handlers.has(event)) {
        handlers.set(event, []);
      }
      handlers.get(event)!.push(handler);
    },
    emit(event: string, data: unknown) {
      const eventHandlers = handlers.get(event);
      if (eventHandlers) {
        eventHandlers.forEach((handler) => handler(data));
      }
    },
  };
}

/**
 * Simulate a transcript stream being delivered in real-time
 *
 * @param chunks - Transcript chunks to deliver
 * @param onChunk - Callback for each chunk
 * @param intervalMs - Time between chunks (default 100ms for tests)
 */
export async function simulateRealtimeStream(
  chunks: TranscriptChunk[],
  onChunk: (chunk: TranscriptChunk) => Promise<void> | void,
  intervalMs = 100
): Promise<void> {
  for (const chunk of chunks) {
    await onChunk(chunk);
    await sleep(intervalMs);
  }
}

/**
 * Sleep for a specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate a unique call ID for testing
 */
export function generateTestCallId(): string {
  return `test-call-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create a deterministic call ID for snapshot testing
 */
export function createDeterministicCallId(seed: string): string {
  return `test-call-${seed}`;
}

/**
 * Assert that detected signals match expected signals
 * Allows for partial matching and ordering flexibility
 */
export function assertSignalsMatch(
  detected: string[],
  expected: string[],
  options: { exact?: boolean; minMatch?: number } = {}
): { matched: string[]; missing: string[]; extra: string[] } {
  const { exact = false, minMatch = expected.length } = options;

  const normalizedDetected = detected.map((s) => s.toLowerCase().trim());
  const normalizedExpected = expected.map((s) => s.toLowerCase().trim());

  const matched = normalizedExpected.filter((e) =>
    normalizedDetected.some((d) => d.includes(e) || e.includes(d))
  );
  const missing = normalizedExpected.filter(
    (e) => !normalizedDetected.some((d) => d.includes(e) || e.includes(d))
  );
  const extra = exact
    ? normalizedDetected.filter(
        (d) => !normalizedExpected.some((e) => d.includes(e) || e.includes(d))
      )
    : [];

  if (matched.length < minMatch) {
    throw new Error(
      `Signal match failed. Expected at least ${minMatch} matches but got ${matched.length}.\n` +
        `Matched: ${matched.join(', ')}\n` +
        `Missing: ${missing.join(', ')}\n` +
        `Detected: ${detected.join(', ')}`
    );
  }

  return { matched, missing, extra };
}

/**
 * Create a state transition history for testing state machine flows
 */
export function createStateHistory(): {
  record: (state: CallScriptState) => void;
  getHistory: () => CallScriptState[];
  getStationSequence: () => Station[];
  clear: () => void;
} {
  const history: CallScriptState[] = [];

  return {
    record(state: CallScriptState) {
      history.push({ ...state });
    },
    getHistory() {
      return [...history];
    },
    getStationSequence() {
      return history.map((s) => s.currentStation);
    },
    clear() {
      history.length = 0;
    },
  };
}

/**
 * Test data builder for creating complex test scenarios
 */
export class TestScenarioBuilder {
  private state: CallScriptState;
  private transcriptChunks: TranscriptChunk[] = [];

  constructor(callId = 'test-call-builder') {
    this.state = createMockCallState({ callId });
  }

  withSegment(segment: SegmentType, confidence = 0.8): this {
    this.state.detectedSegment = segment;
    this.state.segmentConfidence = confidence;
    return this;
  }

  withSignals(signals: string[]): this {
    this.state.segmentSignals = signals;
    return this;
  }

  withStation(station: Station): this {
    this.state.currentStation = station;
    return this;
  }

  withCompletedStations(stations: Station[]): this {
    this.state.completedStations = stations;
    return this;
  }

  withCapturedInfo(info: Partial<CapturedInfo>): this {
    this.state.capturedInfo = { ...this.state.capturedInfo, ...info };
    return this;
  }

  withQualification(isQualified: boolean, notes: string[] = []): this {
    this.state.isQualified = isQualified;
    this.state.qualificationNotes = notes;
    return this;
  }

  withDestination(destination: Destination): this {
    this.state.recommendedDestination = destination;
    this.state.selectedDestination = destination;
    return this;
  }

  addTranscript(speaker: 'agent' | 'caller', text: string): this {
    this.transcriptChunks.push({
      speaker,
      text,
      timestamp: Date.now(),
      isFinal: true,
    });
    return this;
  }

  build(): { state: CallScriptState; transcript: TranscriptChunk[] } {
    return {
      state: { ...this.state },
      transcript: [...this.transcriptChunks],
    };
  }

  reset(): this {
    this.state = createMockCallState();
    this.transcriptChunks = [];
    return this;
  }
}

/**
 * Assertion helpers for common test patterns
 */
export const assertions = {
  /**
   * Assert state is at expected station
   */
  atStation(state: CallScriptState, expected: Station): void {
    if (state.currentStation !== expected) {
      throw new Error(
        `Expected station ${expected}, but was at ${state.currentStation}`
      );
    }
  },

  /**
   * Assert segment matches expected
   */
  hasSegment(state: CallScriptState, expected: SegmentType): void {
    if (state.detectedSegment !== expected) {
      throw new Error(
        `Expected segment ${expected}, but detected ${state.detectedSegment}`
      );
    }
  },

  /**
   * Assert confidence is above threshold
   */
  confidenceAbove(state: CallScriptState, threshold: number): void {
    if (state.segmentConfidence < threshold) {
      throw new Error(
        `Expected confidence above ${threshold}, but was ${state.segmentConfidence}`
      );
    }
  },

  /**
   * Assert destination matches expected
   */
  hasDestination(state: CallScriptState, expected: Destination): void {
    if (state.recommendedDestination !== expected) {
      throw new Error(
        `Expected destination ${expected}, but got ${state.recommendedDestination}`
      );
    }
  },

  /**
   * Assert qualification status
   */
  isQualified(state: CallScriptState, expected: boolean): void {
    if (state.isQualified !== expected) {
      throw new Error(
        `Expected isQualified=${expected}, but was ${state.isQualified}`
      );
    }
  },

  /**
   * Assert captured info matches
   */
  capturedInfoMatches(
    state: CallScriptState,
    expected: Partial<CapturedInfo>
  ): void {
    for (const [key, value] of Object.entries(expected)) {
      const actual = state.capturedInfo[key as keyof CapturedInfo];
      if (actual !== value) {
        throw new Error(
          `Expected capturedInfo.${key}=${value}, but was ${actual}`
        );
      }
    }
  },
};

export default {
  createMockCallState,
  createMockCapturedInfo,
  createTranscriptStream,
  createInterimChunk,
  measureLatency,
  measureAverageLatency,
  assertCompletesWithin,
  createMockWebSocket,
  simulateRealtimeStream,
  sleep,
  generateTestCallId,
  createDeterministicCallId,
  assertSignalsMatch,
  createStateHistory,
  TestScenarioBuilder,
  assertions,
};
