import { describe, it, expect } from 'vitest';
import {
  appPayLines, jobPayFields, forbiddenMoneyKeys, isAppJobStatus, statusVerdict, PAY_ESTIMATE_LABEL, type StatusBooking,
} from './contractor-app-view';
import { computeContractorPay } from './contractor-pay';

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

describe('statusVerdict', () => {
  const today = '2026-09-17';
  const b = (over: Partial<StatusBooking> = {}): StatusBooking => ({
    contractorId: 'hp_me', assignedContractorId: null, status: 'accepted', assignmentStatus: 'accepted', acceptedAt: null,
    dayOfStatus: 'scheduled', scheduledDate: '2026-09-17T09:00:00', durationDays: 1, scheduledDates: null, ...over,
  });

  it('knows only the two statuses', () => {
    expect(isAppJobStatus('on_my_way')).toBe(true);
    expect(isAppJobStatus('arrived')).toBe(true);
    expect(isAppJobStatus('en_route')).toBe(false);
    expect(isAppJobStatus(undefined)).toBe(false);
  });

  it('moves scheduled → en_route → arrived, and allows arriving without on my way', () => {
    expect(statusVerdict(b(), 'hp_me', 'on_my_way', today)).toEqual({ ok: true, changed: true, dayOfStatus: 'en_route', stamp: 'enRouteAt' });
    expect(statusVerdict(b({ dayOfStatus: 'en_route' }), 'hp_me', 'arrived', today)).toEqual({ ok: true, changed: true, dayOfStatus: 'arrived', stamp: 'arrivedAt' });
    expect(statusVerdict(b({ dayOfStatus: null }), 'hp_me', 'arrived', today)).toEqual({ ok: true, changed: true, dayOfStatus: 'arrived', stamp: 'arrivedAt' });
  });

  it('treats a repeat as a no-op and never goes backwards', () => {
    expect(statusVerdict(b({ dayOfStatus: 'en_route' }), 'hp_me', 'on_my_way', today)).toEqual({ ok: true, changed: false });
    expect(statusVerdict(b({ dayOfStatus: 'arrived' }), 'hp_me', 'arrived', today)).toEqual({ ok: true, changed: false });
    expect(statusVerdict(b({ dayOfStatus: 'arrived' }), 'hp_me', 'on_my_way', today)).toMatchObject({ ok: false, status: 409 });
    for (const s of ['in_progress', 'access_failed', 'customer_unreachable', 'completed', 'cancelled_day_of']) {
      expect(statusVerdict(b({ dayOfStatus: s }), 'hp_me', 'arrived', today)).toMatchObject({ ok: false, status: 409 });
    }
  });

  it('counts acceptance the way the rest of the app does', () => {
    expect(statusVerdict(b({ status: 'pending', assignmentStatus: 'assigned' }), 'hp_me', 'arrived', today)).toMatchObject({ ok: false, status: 409, error: 'Accept the job first' });
    expect(statusVerdict(b({ status: 'pending', assignmentStatus: 'assigned', acceptedAt: new Date() }), 'hp_me', 'arrived', today)).toMatchObject({ ok: true });
    expect(statusVerdict(b({ status: 'pending', assignmentStatus: 'in_progress' }), 'hp_me', 'arrived', today)).toMatchObject({ ok: true });
  });

  it('refuses closed, declined, unscheduled and other-day jobs, and other contractors', () => {
    expect(statusVerdict(null, 'hp_me', 'arrived', today)).toMatchObject({ status: 404 });
    expect(statusVerdict(b({ assignedContractorId: 'hp_other' }), 'hp_me', 'arrived', today)).toMatchObject({ status: 403 });
    expect(statusVerdict(b({ contractorId: 'hp_other', assignedContractorId: 'hp_me' }), 'hp_me', 'arrived', today)).toMatchObject({ ok: true });
    expect(statusVerdict(b({ assignmentStatus: 'completed' }), 'hp_me', 'arrived', today)).toMatchObject({ status: 409 });
    expect(statusVerdict(b({ status: 'declined', acceptedAt: new Date() }), 'hp_me', 'arrived', today)).toMatchObject({ status: 409 });
    expect(statusVerdict(b({ scheduledDate: null }), 'hp_me', 'arrived', today)).toMatchObject({ status: 409, error: 'That job has no day yet' });
    expect(statusVerdict(b({ scheduledDate: '2026-09-18T09:00:00' }), 'hp_me', 'arrived', today)).toMatchObject({ status: 409, error: 'That job is not today' });
  });

  it('a multi-day job may be marked on any of its days', () => {
    const span = b({ scheduledDate: '2026-09-15T09:00:00', durationDays: 3, scheduledDates: ['2026-09-15', '2026-09-16', '2026-09-17'] });
    expect(statusVerdict(span, 'hp_me', 'on_my_way', today)).toMatchObject({ ok: true, changed: true });
    expect(statusVerdict(span, 'hp_me', 'on_my_way', '2026-09-18')).toMatchObject({ ok: false, error: 'That job is not today' });
  });
});
