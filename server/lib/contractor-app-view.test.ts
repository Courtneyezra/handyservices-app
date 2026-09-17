import { describe, it, expect } from 'vitest';
import {
  appPayLines, jobPayFields, forbiddenMoneyKeys, isAppJobStatus, appStatusRefusal, APP_STATUS_STEP, PAY_ESTIMATE_LABEL, type StatusBooking,
} from './contractor-app-view';
import { computeContractorPay } from './contractor-pay';
import { dayOfStepRefusal } from './day-of-transitions';

describe('appPayLines / jobPayFields', () => {
  // £20 labour over 3h: a minimum beats the share, which is exactly the "minimum pay" the app must not claim.
  const pay = computeContractorPay([{ category: 'general_fixing', guardedPricePence: 2000, scheduleMinutes: 180, materialsCostPence: 500 }], 'adhoc');

  it('drops the customer labour price and the floor marker from every line', () => {
    expect(pay.lines[0].method).not.toBe('share');
    expect(Object.keys(appPayLines(pay.lines)![0])).not.toContain('method');
    const [line] = appPayLines(pay.lines)!;
    expect(line).toEqual({ category: 'general_fixing', description: null, tier: pay.lines[0].tier, payPence: pay.lines[0].payPence, materialsPence: 500 });
    expect(appPayLines(null)).toBeNull();
  });

  it('labels the pay as an estimate and carries no customer figure', () => {
    const fields = jobPayFields({ estimatedPayPence: pay.totalPayPence, pay });
    expect(fields).toMatchObject({ payoutPence: pay.totalPayPence, payoutLabel: PAY_ESTIMATE_LABEL, materialsAllowancePence: 500 });
    expect(forbiddenMoneyKeys(fields)).toEqual([]);
    expect(jobPayFields({ estimatedPayPence: undefined, pay: null })).toEqual({ payoutPence: null, payoutLabel: PAY_ESTIMATE_LABEL, materialsAllowancePence: null, payLines: null });
  });
});

describe('forbiddenMoneyKeys', () => {
  it('finds a job value or a total at any depth, and passes the materials run spend', () => {
    expect(forbiddenMoneyKeys({ booked: [{ id: 'b', valuePence: 1, payLines: [{ labourPence: 2 }] }], earnedPence: 3 }))
      .toEqual(['booked[0].valuePence', 'booked[0].payLines[0].labourPence', 'earnedPence']);
    expect(forbiddenMoneyKeys({ plans: [{ totalPence: 1 }], balanceDuePence: 2, allTimePence: 3 })).toEqual(['plans[0].totalPence', 'balanceDuePence', 'allTimePence']);
    expect(forbiddenMoneyKeys({ totalIncVatPence: 1, items: [{ lineCostPence: 2 }], payoutPence: 3 })).toEqual([]);
    expect(forbiddenMoneyKeys(null)).toEqual([]);
  });
});

describe('appStatusRefusal', () => {
  const today = '2026-09-17';
  const b = (over: Partial<StatusBooking> = {}): StatusBooking => ({
    contractorId: 'hp_me', assignedContractorId: null, status: 'accepted', assignmentStatus: 'accepted', acceptedAt: null,
    scheduledDate: '2026-09-17T09:00:00', durationDays: 1, scheduledDates: null, ...over,
  });

  it('knows only the two statuses, each a step on the day-of ladder', () => {
    expect(isAppJobStatus('on_my_way')).toBe(true);
    expect(isAppJobStatus('arrived')).toBe(true);
    expect(isAppJobStatus('en_route')).toBe(false);
    expect(isAppJobStatus(undefined)).toBe(false);
    expect(APP_STATUS_STEP).toEqual({ on_my_way: 'en_route', arrived: 'arrived' });
  });

  it('passes his accepted job for today', () => {
    expect(appStatusRefusal(b(), 'hp_me', today)).toBeNull();
  });

  it('counts acceptance the way the rest of the app does', () => {
    expect(appStatusRefusal(b({ status: 'pending', assignmentStatus: 'assigned' }), 'hp_me', today)).toEqual({ status: 409, error: 'Accept the job first' });
    expect(appStatusRefusal(b({ status: 'pending', assignmentStatus: 'assigned', acceptedAt: new Date() }), 'hp_me', today)).toBeNull();
    expect(appStatusRefusal(b({ status: 'pending', assignmentStatus: 'in_progress' }), 'hp_me', today)).toBeNull();
  });

  it('refuses closed, declined, unscheduled and other-day jobs, and other contractors', () => {
    expect(appStatusRefusal(null, 'hp_me', today)).toMatchObject({ status: 404 });
    expect(appStatusRefusal(b({ assignedContractorId: 'hp_other' }), 'hp_me', today)).toMatchObject({ status: 403 });
    expect(appStatusRefusal(b({ contractorId: 'hp_other', assignedContractorId: 'hp_me' }), 'hp_me', today)).toBeNull();
    expect(appStatusRefusal(b({ assignmentStatus: 'completed' }), 'hp_me', today)).toMatchObject({ status: 409 });
    expect(appStatusRefusal(b({ status: 'declined', acceptedAt: new Date() }), 'hp_me', today)).toMatchObject({ status: 409 });
    expect(appStatusRefusal(b({ scheduledDate: null }), 'hp_me', today)).toEqual({ status: 409, error: 'That job has no day yet' });
    expect(appStatusRefusal(b({ scheduledDate: '2026-09-18T09:00:00' }), 'hp_me', today)).toEqual({ status: 409, error: 'That job is not today' });
  });

  it('a multi-day job may be marked on any of its days', () => {
    const span = b({ scheduledDate: '2026-09-15T09:00:00', durationDays: 3, scheduledDates: ['2026-09-15', '2026-09-16', '2026-09-17'] });
    expect(appStatusRefusal(span, 'hp_me', today)).toBeNull();
    expect(appStatusRefusal(span, 'hp_me', '2026-09-18')).toEqual({ status: 409, error: 'That job is not today' });
  });
});

describe('dayOfStepRefusal', () => {
  it('climbs scheduled → en_route → arrived → in_progress one rung at a time', () => {
    expect(dayOfStepRefusal('scheduled', 'en_route')).toBeNull();
    expect(dayOfStepRefusal(null, 'en_route')).toBeNull();
    expect(dayOfStepRefusal('en_route', 'arrived')).toBeNull();
    expect(dayOfStepRefusal('arrived', 'in_progress')).toBeNull();
  });

  it('refuses skipping a rung, going back and moving a closed day', () => {
    expect(dayOfStepRefusal('scheduled', 'arrived')).toBe("Cannot transition to arrived from status 'scheduled'. Must be 'en_route'.");
    expect(dayOfStepRefusal(null, 'arrived')).not.toBeNull();
    expect(dayOfStepRefusal('arrived', 'en_route')).not.toBeNull();
    expect(dayOfStepRefusal('en_route', 'en_route')).not.toBeNull();
    for (const s of ['in_progress', 'access_failed', 'customer_unreachable', 'completed', 'cancelled_day_of']) {
      expect(dayOfStepRefusal(s, 'en_route')).not.toBeNull();
      expect(dayOfStepRefusal(s, 'arrived')).not.toBeNull();
    }
  });
});
