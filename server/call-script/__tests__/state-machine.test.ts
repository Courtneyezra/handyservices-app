/**
 * State Machine Tests for Call Script Tube Map
 *
 * Tests the state machine that manages call flow through stations:
 * LISTEN -> SEGMENT -> QUALIFY -> DESTINATION
 *
 * Owner: Agent 6 (Testing Agent)
 *
 * These tests verify:
 * - Station transitions occur correctly
 * - State is properly maintained between transitions
 * - Invalid transitions are rejected
 * - Event handlers are called appropriately
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CallScriptStateMachine } from '../state-machine';
import {
  createMockCallState,
  createStateHistory,
  TestScenarioBuilder,
  assertions,
  measureLatency,
  type CallScriptState,
  type Station,
} from './utils/test-helpers';
import { TRANSCRIPT_FIXTURES, EDGE_CASE_FIXTURES } from './fixtures/transcripts';
import { extractInfoFromEntries } from '../../services/info-extractor';
import { classifySegmentSync, extractCallerSpeech } from '../../services/segment-classifier';

describe('CallScriptStateMachine', () => {
  describe('Initialization', () => {
    it('should initialize in LISTEN station', () => {
      const machine = new CallScriptStateMachine('test-init-001');
      expect(machine.getCurrentStation()).toBe('LISTEN');
    });

    it('should have empty captured info on init', () => {
      const machine = new CallScriptStateMachine('test-init-002');
      const state = machine.getState();

      expect(state.capturedInfo.job).toBeNull();
      expect(state.capturedInfo.postcode).toBeNull();
      expect(state.capturedInfo.name).toBeNull();
      expect(state.capturedInfo.contact).toBeNull();
      expect(state.capturedInfo.isDecisionMaker).toBeNull();
      expect(state.capturedInfo.isRemote).toBeNull();
      expect(state.capturedInfo.hasTenant).toBeNull();
    });

    it('should have null segment on init', () => {
      const machine = new CallScriptStateMachine('test-init-003');
      const state = machine.getState();

      expect(state.detectedSegment).toBeNull();
      expect(state.segmentConfidence).toBe(0);
      expect(state.segmentSignals).toHaveLength(0);
    });

    it('should have null destination on init', () => {
      const machine = new CallScriptStateMachine('test-init-004');
      const state = machine.getState();

      expect(state.recommendedDestination).toBeNull();
      expect(state.selectedDestination).toBeNull();
    });

    it('should generate unique call IDs', () => {
      const machine1 = new CallScriptStateMachine('call-001');
      const machine2 = new CallScriptStateMachine('call-002');

      expect(machine1.getCallId()).toBe('call-001');
      expect(machine2.getCallId()).toBe('call-002');
      expect(machine1.getCallId()).not.toBe(machine2.getCallId());
    });

    it('should accept optional initial state', () => {
      const machine = new CallScriptStateMachine('test-init-005', {
        capturedInfo: { job: 'Fix boiler' },
        detectedSegment: 'LANDLORD',
        segmentConfidence: 70,
      });

      const state = machine.getState();
      expect(state.capturedInfo.job).toBe('Fix boiler');
      expect(state.detectedSegment).toBe('LANDLORD');
      expect(state.segmentConfidence).toBe(70);
    });
  });

  describe('Station Transitions', () => {
    describe('LISTEN -> SEGMENT', () => {
      it('should transition to SEGMENT when job is captured', () => {
        const machine = new CallScriptStateMachine('test-trans-001');
        machine.updateCapturedInfo({ job: 'Fix leaking tap' });

        const result = machine.confirmStation();

        expect(result.success).toBe(true);
        expect(result.newStation).toBe('SEGMENT');
        expect(machine.getCurrentStation()).toBe('SEGMENT');
      });

      it('should remain in LISTEN when job not captured', () => {
        const machine = new CallScriptStateMachine('test-trans-002');

        const canAdvance = machine.canAdvanceToStation('SEGMENT');

        expect(canAdvance.allowed).toBe(false);
        expect(canAdvance.reason).toBe('Job description not captured');
      });

      it('should add LISTEN to completedStations after transition', () => {
        const machine = new CallScriptStateMachine('test-trans-003');
        machine.updateCapturedInfo({ job: 'Fix boiler' });
        machine.confirmStation();

        expect(machine.getState().completedStations).toContain('LISTEN');
      });

      it('should preserve captured info during transition', () => {
        const machine = new CallScriptStateMachine('test-trans-004');
        machine.updateCapturedInfo({
          job: 'Fix boiler',
          postcode: 'SW11 2AB',
          isDecisionMaker: true,
        });
        machine.confirmStation();

        const state = machine.getState();
        expect(state.capturedInfo.job).toBe('Fix boiler');
        expect(state.capturedInfo.postcode).toBe('SW11 2AB');
        expect(state.capturedInfo.isDecisionMaker).toBe(true);
      });

      it('should update stationEnteredAt on transition', () => {
        const machine = new CallScriptStateMachine('test-trans-005');
        const beforeTime = machine.getState().stationEnteredAt;

        machine.updateCapturedInfo({ job: 'Fix boiler' });
        machine.confirmStation();

        const afterTime = machine.getState().stationEnteredAt;
        expect(afterTime.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      });

      it('should emit "station:changed" event on transition', () => {
        const machine = new CallScriptStateMachine('test-trans-006');
        const events: any[] = [];

        machine.on('station:changed', (data) => events.push(data));

        machine.updateCapturedInfo({ job: 'Fix boiler' });
        machine.confirmStation();

        expect(events.length).toBe(1);
        expect(events[0].from).toBe('LISTEN');
        expect(events[0].to).toBe('SEGMENT');
      });
    });

    describe('SEGMENT -> QUALIFY', () => {
      it('should transition to QUALIFY when segment is confirmed', () => {
        const machine = new CallScriptStateMachine('test-seg-001');
        machine.updateCapturedInfo({ job: 'Fix boiler' });
        machine.confirmStation();

        machine.updateSegment('LANDLORD', 80, ['rental', 'tenant']);
        machine.confirmSegment('LANDLORD');
        const result = machine.confirmStation();

        expect(result.success).toBe(true);
        expect(machine.getCurrentStation()).toBe('QUALIFY');
      });

      it('should not transition until segment is detected', () => {
        const machine = new CallScriptStateMachine('test-seg-002');
        machine.updateCapturedInfo({ job: 'Fix boiler' });
        machine.confirmStation();

        const canAdvance = machine.canAdvanceToStation('QUALIFY');

        expect(canAdvance.allowed).toBe(false);
        expect(canAdvance.reason).toBe('Segment not confirmed');
      });

      it('should carry segment signals to QUALIFY station', () => {
        const machine = new CallScriptStateMachine('test-seg-003');
        machine.updateCapturedInfo({ job: 'Fix boiler' });
        machine.confirmStation();

        machine.updateSegment('LANDLORD', 85, ['rental property', 'tenant', 'buy to let']);
        machine.confirmSegment('LANDLORD');
        machine.confirmStation();

        const state = machine.getState();
        expect(state.segmentSignals).toContain('rental property');
        expect(state.segmentSignals).toContain('tenant');
      });

      it('should emit "segment:confirmed" event', () => {
        const machine = new CallScriptStateMachine('test-seg-004');
        const events: any[] = [];

        machine.on('segment:confirmed', (data) => events.push(data));

        machine.updateCapturedInfo({ job: 'Fix boiler' });
        machine.confirmStation();
        machine.updateSegment('LANDLORD', 80, ['rental']);
        machine.confirmSegment('LANDLORD');

        expect(events.length).toBe(1);
        expect(events[0].segment).toBe('LANDLORD');
      });
    });

    describe('QUALIFY -> DESTINATION', () => {
      it('should transition to DESTINATION when qualified', () => {
        const machine = new CallScriptStateMachine('test-qual-001');

        // Progress through to QUALIFY
        machine.updateCapturedInfo({ job: 'Fix boiler' });
        machine.confirmStation();
        machine.updateSegment('LANDLORD', 80, ['rental']);
        machine.confirmSegment('LANDLORD');
        machine.confirmStation();

        machine.setQualified(true);
        const result = machine.confirmStation();

        expect(result.success).toBe(true);
        expect(machine.getCurrentStation()).toBe('DESTINATION');
      });

      it('should set isQualified to true for qualified leads', () => {
        const machine = new CallScriptStateMachine('test-qual-002');
        machine.updateCapturedInfo({ job: 'Fix boiler' });
        machine.confirmStation();
        machine.confirmSegment('LANDLORD');
        machine.confirmStation();

        machine.setQualified(true);

        expect(machine.getState().isQualified).toBe(true);
      });

      it('should set isQualified to false for disqualified leads', () => {
        const machine = new CallScriptStateMachine('test-qual-003');
        machine.updateCapturedInfo({ job: 'Fix boiler' });
        machine.confirmStation();
        machine.confirmSegment('BUDGET');
        machine.confirmStation();

        machine.setQualified(false, ['Price shopping only']);

        expect(machine.getState().isQualified).toBe(false);
        expect(machine.getState().qualificationNotes).toContain('Price shopping only');
      });

      it('should record qualification notes', () => {
        const machine = new CallScriptStateMachine('test-qual-004');
        machine.updateCapturedInfo({ job: 'Fix boiler' });
        machine.confirmStation();
        machine.confirmSegment('LANDLORD');
        machine.confirmStation();

        machine.setQualified(true, ['Has key safe', 'Decision maker confirmed']);

        const state = machine.getState();
        expect(state.qualificationNotes).toContain('Has key safe');
        expect(state.qualificationNotes).toContain('Decision maker confirmed');
      });

      it('should set recommendedDestination based on segment', () => {
        const machine = new CallScriptStateMachine('test-qual-005');
        machine.updateCapturedInfo({ job: 'Fix boiler' });
        machine.confirmStation();
        machine.confirmSegment('LANDLORD');
        machine.confirmStation();
        machine.setQualified(true);
        machine.confirmStation();

        expect(machine.getState().recommendedDestination).toBe('INSTANT_QUOTE');
      });
    });

    describe('Invalid Transitions', () => {
      it('should reject transition from LISTEN to QUALIFY', () => {
        const machine = new CallScriptStateMachine('test-invalid-001');

        const canAdvance = machine.canAdvanceToStation('QUALIFY');

        expect(canAdvance.allowed).toBe(false);
        expect(canAdvance.reason).toBe('Must complete stations in order');
      });

      it('should reject transition from LISTEN to DESTINATION', () => {
        const machine = new CallScriptStateMachine('test-invalid-002');

        const canAdvance = machine.canAdvanceToStation('DESTINATION');

        expect(canAdvance.allowed).toBe(false);
      });

      it('should reject transition from SEGMENT to LISTEN', () => {
        const machine = new CallScriptStateMachine('test-invalid-003');
        machine.updateCapturedInfo({ job: 'Fix boiler' });
        machine.confirmStation();

        const canAdvance = machine.canAdvanceToStation('LISTEN');

        expect(canAdvance.allowed).toBe(false);
        expect(canAdvance.reason).toBe('Cannot go backwards in the flow');
      });

      it('should reject backward transitions', () => {
        const machine = new CallScriptStateMachine('test-invalid-004');
        machine.updateCapturedInfo({ job: 'Fix boiler' });
        machine.confirmStation();
        machine.confirmSegment('LANDLORD');
        machine.confirmStation();

        // Try to go back to SEGMENT
        const canAdvance = machine.canAdvanceToStation('SEGMENT');
        expect(canAdvance.allowed).toBe(false);
      });
    });
  });

  describe('State Updates', () => {
    describe('Captured Info Updates', () => {
      it('should update job from transcript', () => {
        const machine = new CallScriptStateMachine('test-info-001');
        machine.updateCapturedInfo({ job: 'Fix leaking tap' });

        expect(machine.getState().capturedInfo.job).toBe('Fix leaking tap');
      });

      it('should update postcode when detected', () => {
        const machine = new CallScriptStateMachine('test-info-002');
        machine.updateCapturedInfo({ postcode: 'SW11 2AB' });

        expect(machine.getState().capturedInfo.postcode).toBe('SW11 2AB');
      });

      it('should update isDecisionMaker flag', () => {
        const machine = new CallScriptStateMachine('test-info-003');
        machine.updateCapturedInfo({ isDecisionMaker: true });

        expect(machine.getState().capturedInfo.isDecisionMaker).toBe(true);
      });

      it('should update isRemote flag', () => {
        const machine = new CallScriptStateMachine('test-info-004');
        machine.updateCapturedInfo({ isRemote: true });

        expect(machine.getState().capturedInfo.isRemote).toBe(true);
      });

      it('should update hasTenant flag', () => {
        const machine = new CallScriptStateMachine('test-info-005');
        machine.updateCapturedInfo({ hasTenant: true });

        expect(machine.getState().capturedInfo.hasTenant).toBe(true);
      });

      it('should merge partial updates', () => {
        const machine = new CallScriptStateMachine('test-info-006');

        machine.updateCapturedInfo({ job: 'Fix boiler' });
        machine.updateCapturedInfo({ postcode: 'SW11 2AB' });
        machine.updateCapturedInfo({ isDecisionMaker: true });

        const state = machine.getState();
        expect(state.capturedInfo.job).toBe('Fix boiler');
        expect(state.capturedInfo.postcode).toBe('SW11 2AB');
        expect(state.capturedInfo.isDecisionMaker).toBe(true);
      });
    });

    describe('Segment Updates', () => {
      it('should update segment when new signals detected', () => {
        const machine = new CallScriptStateMachine('test-segment-001');
        machine.updateSegment('LANDLORD', 70, ['rental property']);

        expect(machine.getState().detectedSegment).toBe('LANDLORD');
      });

      it('should update confidence with matching signals', () => {
        const machine = new CallScriptStateMachine('test-segment-002');

        machine.updateSegment('LANDLORD', 50, ['rental']);
        machine.updateSegment('LANDLORD', 80, ['rental', 'tenant', 'buy to let']);

        expect(machine.getState().segmentConfidence).toBe(80);
      });

      it('should track all detected signals', () => {
        const machine = new CallScriptStateMachine('test-segment-003');
        machine.updateSegment('LANDLORD', 70, ['rental property', 'tenant']);

        expect(machine.getState().segmentSignals).toContain('rental property');
        expect(machine.getState().segmentSignals).toContain('tenant');
      });

      it('should add signals with addSegmentSignal', () => {
        const machine = new CallScriptStateMachine('test-segment-004');
        machine.updateSegment('LANDLORD', 70, ['rental']);
        machine.addSegmentSignal('tenant');
        machine.addSegmentSignal('buy to let');

        const signals = machine.getState().segmentSignals;
        expect(signals).toContain('tenant');
        expect(signals).toContain('buy to let');
      });

      it('should not duplicate signals', () => {
        const machine = new CallScriptStateMachine('test-segment-005');
        machine.updateSegment('LANDLORD', 70, ['rental']);
        machine.addSegmentSignal('rental');
        machine.addSegmentSignal('rental');

        const signals = machine.getState().segmentSignals;
        const rentalCount = signals.filter((s) => s === 'rental').length;
        expect(rentalCount).toBe(1);
      });
    });

    describe('Qualification Updates', () => {
      it('should add qualification notes as discovered', () => {
        const machine = new CallScriptStateMachine('test-qual-001');
        machine.addQualificationNote('Has key safe access');
        machine.addQualificationNote('Decision maker confirmed');

        const notes = machine.getState().qualificationNotes;
        expect(notes).toContain('Has key safe access');
        expect(notes).toContain('Decision maker confirmed');
      });

      it('should not duplicate qualification notes', () => {
        const machine = new CallScriptStateMachine('test-qual-002');
        machine.addQualificationNote('Has key safe');
        machine.addQualificationNote('Has key safe');

        const notes = machine.getState().qualificationNotes;
        const keySafeCount = notes.filter((n) => n === 'Has key safe').length;
        expect(keySafeCount).toBe(1);
      });
    });
  });

  describe('Event Handlers', () => {
    it('should call onSegmentDetected when segment changes', () => {
      const machine = new CallScriptStateMachine('test-event-001');
      const events: any[] = [];

      machine.on('segment:detected', (data) => events.push(data));
      machine.updateSegment('LANDLORD', 70, ['rental', 'tenant']);

      expect(events.length).toBe(1);
      expect(events[0].segment).toBe('LANDLORD');
      expect(events[0].confidence).toBe(70);
    });

    it('should call onStationChange when transitioning', () => {
      const machine = new CallScriptStateMachine('test-event-002');
      const events: any[] = [];

      machine.on('station:changed', (data) => events.push(data));
      machine.updateCapturedInfo({ job: 'Fix boiler' });
      machine.confirmStation();

      expect(events.length).toBe(1);
      expect(events[0].from).toBe('LISTEN');
      expect(events[0].to).toBe('SEGMENT');
    });

    it('should call onQualified when qualification determined', () => {
      const machine = new CallScriptStateMachine('test-event-003');
      const events: any[] = [];

      machine.on('qualified:set', (data) => events.push(data));
      machine.setQualified(true, ['Good lead']);

      expect(events.length).toBe(1);
      expect(events[0].qualified).toBe(true);
      expect(events[0].notes).toContain('Good lead');
    });

    it('should call onDestinationReached at terminal state', () => {
      const machine = new CallScriptStateMachine('test-event-004');
      const events: any[] = [];

      machine.on('destination:selected', (data) => events.push(data));

      machine.updateCapturedInfo({ job: 'Fix boiler' });
      machine.confirmStation();
      machine.confirmSegment('LANDLORD');
      machine.confirmStation();
      machine.setQualified(true);
      machine.confirmStation();
      machine.selectDestination('INSTANT_QUOTE');

      expect(events.length).toBe(1);
      expect(events[0].destination).toBe('INSTANT_QUOTE');
    });

    it('should support multiple handlers per event', () => {
      const machine = new CallScriptStateMachine('test-event-005');
      const handler1Calls: any[] = [];
      const handler2Calls: any[] = [];

      machine.on('segment:detected', () => handler1Calls.push(1));
      machine.on('segment:detected', () => handler2Calls.push(2));

      machine.updateSegment('LANDLORD', 70, ['rental']);

      expect(handler1Calls.length).toBe(1);
      expect(handler2Calls.length).toBe(1);
    });

    it('should handle handler errors gracefully', () => {
      const machine = new CallScriptStateMachine('test-event-006');
      const goodHandlerCalls: any[] = [];

      machine.on('segment:detected', () => {
        throw new Error('Handler error');
      });
      machine.on('segment:detected', () => goodHandlerCalls.push(1));

      // Should not throw, and second handler should still be called
      expect(() => machine.updateSegment('LANDLORD', 70, ['rental'])).not.toThrow();
      expect(goodHandlerCalls.length).toBe(1);
    });

    it('should allow removing event handlers', () => {
      const machine = new CallScriptStateMachine('test-event-007');
      const events: any[] = [];
      const handler = () => events.push(1);

      machine.on('segment:detected', handler);
      machine.updateSegment('LANDLORD', 70, ['rental']);
      expect(events.length).toBe(1);

      machine.off('segment:detected', handler);
      machine.updateSegment('BUSY_PRO', 70, ['busy']);
      expect(events.length).toBe(1); // No new events
    });
  });

  describe('State Persistence', () => {
    it('should serialize state to JSON', () => {
      const machine = new CallScriptStateMachine('test-persist-001');
      machine.updateCapturedInfo({ job: 'Fix boiler', postcode: 'SW11 2AB' });
      machine.updateSegment('LANDLORD', 80, ['rental', 'tenant']);

      const json = machine.toJSON();

      expect(json.callId).toBe('test-persist-001');
      expect(json.capturedInfo.job).toBe('Fix boiler');
      expect(json.detectedSegment).toBe('LANDLORD');
    });

    it('should deserialize state from JSON', () => {
      const original = new CallScriptStateMachine('test-persist-002');
      original.updateCapturedInfo({ job: 'Fix boiler', postcode: 'SW11 2AB' });
      original.updateSegment('LANDLORD', 80, ['rental', 'tenant']);
      original.confirmStation();

      const json = original.toJSON();
      const restored = CallScriptStateMachine.fromJSON(json);

      expect(restored.getCallId()).toBe('test-persist-002');
      expect(restored.getCurrentStation()).toBe('SEGMENT');
      expect(restored.getState().capturedInfo.job).toBe('Fix boiler');
      expect(restored.getState().detectedSegment).toBe('LANDLORD');
    });

    it('should restore full state including Date objects', () => {
      const original = new CallScriptStateMachine('test-persist-003');
      const json = original.toJSON();
      const restored = CallScriptStateMachine.fromJSON(json);

      expect(restored.getState().createdAt).toBeInstanceOf(Date);
      expect(restored.getState().stationEnteredAt).toBeInstanceOf(Date);
    });

    it('should handle missing fields in deserialization', () => {
      const partialState = {
        callId: 'test-persist-004',
        currentStation: 'LISTEN' as const,
        // Missing many fields
      };

      // Should not throw
      const machine = CallScriptStateMachine.fromJSON(partialState as any);
      expect(machine.getCallId()).toBe('test-persist-004');
      expect(machine.getCurrentStation()).toBe('LISTEN');
    });
  });

  describe('Emergency Fast-Track', () => {
    it('should allow fast-track to DESTINATION for emergencies', () => {
      const machine = new CallScriptStateMachine('test-emergency-001');
      machine.updateSegment('EMERGENCY', 95, ['flooding', 'burst']);
      machine.updateCapturedInfo({ job: 'Burst pipe', postcode: 'SW11 2AB' });

      const result = machine.fastTrackToDestination();

      expect(result.success).toBe(true);
      expect(machine.getCurrentStation()).toBe('DESTINATION');
      expect(machine.getState().recommendedDestination).toBe('EMERGENCY_DISPATCH');
    });

    it('should mark all intermediate stations as complete', () => {
      const machine = new CallScriptStateMachine('test-emergency-002');
      machine.updateSegment('EMERGENCY', 95, ['flooding']);
      machine.updateCapturedInfo({ job: 'Burst pipe' });

      machine.fastTrackToDestination();

      const completed = machine.getState().completedStations;
      expect(completed).toContain('LISTEN');
      expect(completed).toContain('SEGMENT');
      expect(completed).toContain('QUALIFY');
    });

    it('should require job description for fast-track', () => {
      const machine = new CallScriptStateMachine('test-emergency-003');
      machine.updateSegment('EMERGENCY', 95, ['flooding']);

      const result = machine.fastTrackToDestination();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Job description required for fast-track');
    });
  });

  describe('Station-Specific Behavior', () => {
    describe('LISTEN Station', () => {
      it('should accumulate info from multiple updates', () => {
        const machine = new CallScriptStateMachine('test-listen-001');

        machine.updateCapturedInfo({ job: 'Fix tap' });
        machine.updateCapturedInfo({ postcode: 'SW11 2AB' });
        machine.updateCapturedInfo({ isDecisionMaker: true });

        const info = machine.getState().capturedInfo;
        expect(info.job).toBe('Fix tap');
        expect(info.postcode).toBe('SW11 2AB');
        expect(info.isDecisionMaker).toBe(true);
      });
    });

    describe('SEGMENT Station', () => {
      it('should support manual segment override', () => {
        const machine = new CallScriptStateMachine('test-seg-001');
        machine.updateCapturedInfo({ job: 'Fix tap' });
        machine.confirmStation();

        // Initially detected as LANDLORD
        machine.updateSegment('LANDLORD', 60, ['rental']);
        // Override to BUSY_PRO
        machine.confirmSegment('BUSY_PRO');

        expect(machine.getState().detectedSegment).toBe('BUSY_PRO');
        expect(machine.getState().segmentConfidence).toBe(100); // Confirmed = full confidence
      });
    });

    describe('DESTINATION Station', () => {
      it('should recommend EMERGENCY_DISPATCH for emergencies', () => {
        const machine = new CallScriptStateMachine('test-dest-001');
        machine.updateCapturedInfo({ job: 'Burst pipe' });
        machine.confirmStation();
        machine.confirmSegment('EMERGENCY');
        machine.confirmStation();
        machine.setQualified(true);
        machine.confirmStation();

        expect(machine.getState().recommendedDestination).toBe('EMERGENCY_DISPATCH');
      });

      it('should recommend SITE_VISIT for OAP segment', () => {
        const machine = new CallScriptStateMachine('test-dest-002');
        machine.updateCapturedInfo({ job: 'Fix shelves' });
        machine.confirmStation();
        machine.confirmSegment('OAP');
        machine.confirmStation();
        machine.setQualified(true);
        machine.confirmStation();

        expect(machine.getState().recommendedDestination).toBe('SITE_VISIT');
      });

      it('should recommend EXIT for pure budget shoppers', () => {
        const machine = new CallScriptStateMachine('test-dest-003');
        machine.updateCapturedInfo({ job: 'Hang door' });
        machine.confirmStation();
        machine.confirmSegment('BUDGET');
        machine.confirmStation();
        machine.setQualified(false);
        machine.confirmStation();

        expect(machine.getState().recommendedDestination).toBe('EXIT');
      });

      it('should recommend INSTANT_QUOTE for qualified leads', () => {
        const machine = new CallScriptStateMachine('test-dest-004');
        machine.updateCapturedInfo({ job: 'Fix tap' });
        machine.confirmStation();
        machine.confirmSegment('LANDLORD');
        machine.confirmStation();
        machine.setQualified(true);
        machine.confirmStation();

        expect(machine.getState().recommendedDestination).toBe('INSTANT_QUOTE');
      });

      it('should support destination override by agent', () => {
        const machine = new CallScriptStateMachine('test-dest-005');
        machine.updateCapturedInfo({ job: 'Fix tap' });
        machine.confirmStation();
        machine.confirmSegment('LANDLORD');
        machine.confirmStation();
        machine.setQualified(true);
        machine.confirmStation();

        // Override default INSTANT_QUOTE to SITE_VISIT
        machine.selectDestination('SITE_VISIT');

        expect(machine.getState().selectedDestination).toBe('SITE_VISIT');
      });
    });
  });

  describe('Integration with Fixtures', () => {
    describe('LANDLORD Transcript Flow', () => {
      it('should process LANDLORD transcript through all stations', () => {
        const fixture = TRANSCRIPT_FIXTURES.LANDLORD;
        const machine = new CallScriptStateMachine('test-landlord-flow');

        const info = extractInfoFromEntries(fixture.transcript);
        machine.updateCapturedInfo(info);
        machine.confirmStation();

        const callerText = extractCallerSpeech(fixture.transcript);
        const result = classifySegmentSync(callerText);
        machine.confirmSegment(result.primary.segment);
        machine.confirmStation();

        machine.setQualified(true);
        machine.confirmStation();

        expect(machine.getCurrentStation()).toBe('DESTINATION');
      });

      it('should detect LANDLORD segment with correct confidence', () => {
        const fixture = TRANSCRIPT_FIXTURES.LANDLORD;
        const callerText = extractCallerSpeech(fixture.transcript);
        const result = classifySegmentSync(callerText);

        expect(result.primary.segment).toBe('LANDLORD');
        expect(result.primary.confidence).toBeGreaterThan(50);
      });

      it('should capture expected info for LANDLORD', () => {
        const fixture = TRANSCRIPT_FIXTURES.LANDLORD;
        const info = extractInfoFromEntries(fixture.transcript);

        expect(info.hasTenant).toBe(true);
        expect(info.isRemote).toBe(true);
        expect(info.isDecisionMaker).toBe(true);
      });

      it('should route LANDLORD to INSTANT_QUOTE', () => {
        const machine = new CallScriptStateMachine('test-landlord-dest');
        machine.updateCapturedInfo({ job: 'Fix boiler' });
        machine.confirmStation();
        machine.confirmSegment('LANDLORD');
        machine.confirmStation();
        machine.setQualified(true);
        machine.confirmStation();

        expect(machine.getState().recommendedDestination).toBe('INSTANT_QUOTE');
      });
    });

    describe('EMERGENCY Transcript Flow', () => {
      it('should fast-track EMERGENCY to DESTINATION', () => {
        const machine = new CallScriptStateMachine('test-emergency-flow');
        machine.updateSegment('EMERGENCY', 95, ['flooding', 'burst']);
        machine.updateCapturedInfo({ job: 'Burst pipe', postcode: 'SW4 7AB' });

        machine.fastTrackToDestination();

        expect(machine.getCurrentStation()).toBe('DESTINATION');
        expect(machine.getState().recommendedDestination).toBe('EMERGENCY_DISPATCH');
      });

      it('should capture address immediately for emergencies', () => {
        const fixture = TRANSCRIPT_FIXTURES.EMERGENCY;
        const info = extractInfoFromEntries(fixture.transcript);

        expect(info.postcode).toBe('SW4 7AB');
        expect(info.job).not.toBeNull();
      });
    });

    describe('BUDGET Transcript Flow', () => {
      it('should detect BUDGET segment early', () => {
        const fixture = TRANSCRIPT_FIXTURES.BUDGET;
        const callerText = extractCallerSpeech(fixture.transcript);
        const result = classifySegmentSync(callerText);

        expect(result.primary.segment).toBe('BUDGET');
      });

      it('should route unrecovered BUDGET to EXIT', () => {
        const machine = new CallScriptStateMachine('test-budget-flow');
        machine.updateCapturedInfo({ job: 'Hang door' });
        machine.confirmStation();
        machine.confirmSegment('BUDGET');
        machine.confirmStation();
        machine.setQualified(false, ['Price shopping only']);
        machine.confirmStation();

        expect(machine.getState().recommendedDestination).toBe('EXIT');
      });
    });
  });

  describe('Performance Requirements', () => {
    it('should process transcript chunk in < 50ms', async () => {
      const machine = new CallScriptStateMachine('test-perf-001');

      const latency = await measureLatency(async () => {
        const result = classifySegmentSync('I have a rental property with a tenant');
        machine.updateSegment(
          result.primary.segment,
          result.primary.confidence,
          result.primary.signals
        );
      });

      expect(latency).toBeLessThan(50);
    });

    it('should complete station transition in < 30ms', async () => {
      const machine = new CallScriptStateMachine('test-perf-002');
      machine.updateCapturedInfo({ job: 'Fix boiler' });

      const latency = await measureLatency(async () => {
        machine.confirmStation();
      });

      expect(latency).toBeLessThan(30);
    });
  });

  describe('Utility Methods', () => {
    it('should check if segment has been detected', () => {
      const machine = new CallScriptStateMachine('test-util-001');

      expect(machine.hasSegment()).toBe(false);

      machine.updateSegment('LANDLORD', 70, ['rental']);
      expect(machine.hasSegment()).toBe(true);
    });

    it('should check if qualified', () => {
      const machine = new CallScriptStateMachine('test-util-002');

      expect(machine.isQualified()).toBeNull();

      machine.setQualified(true);
      expect(machine.isQualified()).toBe(true);
    });

    it('should check if at final station', () => {
      const machine = new CallScriptStateMachine('test-util-003');

      expect(machine.isAtFinalStation()).toBe(false);

      machine.updateCapturedInfo({ job: 'Fix boiler' });
      machine.confirmStation();
      machine.confirmSegment('LANDLORD');
      machine.confirmStation();
      machine.setQualified(true);
      machine.confirmStation();

      expect(machine.isAtFinalStation()).toBe(true);
    });

    it('should get time in current station', async () => {
      const machine = new CallScriptStateMachine('test-util-004');

      await new Promise((r) => setTimeout(r, 10));
      const time = machine.getTimeInCurrentStation();

      expect(time).toBeGreaterThanOrEqual(10);
    });

    it('should get available destinations', () => {
      const machine = new CallScriptStateMachine('test-util-005');
      machine.updateSegment('LANDLORD', 70, ['rental']);

      const destinations = machine.getAvailableDestinations();

      expect(destinations.some((d) => d.destination === 'INSTANT_QUOTE')).toBe(true);
      expect(destinations.some((d) => d.destination === 'SITE_VISIT')).toBe(true);
      expect(destinations.some((d) => d.destination === 'EXIT')).toBe(true);
    });

    it('should get current prompt', () => {
      const machine = new CallScriptStateMachine('test-util-006');

      const prompt = machine.getCurrentPrompt();

      expect(prompt.instruction).toBeDefined();
    });

    it('should reset state', () => {
      const machine = new CallScriptStateMachine('test-util-007');
      machine.updateCapturedInfo({ job: 'Fix boiler' });
      machine.updateSegment('LANDLORD', 70, ['rental']);
      machine.confirmStation();

      machine.reset();

      expect(machine.getCurrentStation()).toBe('LISTEN');
      expect(machine.getState().capturedInfo.job).toBeNull();
      expect(machine.getState().detectedSegment).toBeNull();
    });
  });
});
