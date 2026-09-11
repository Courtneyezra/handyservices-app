/**
 * Goal 2 - the comms_v2_approvers row: what a stored value means, including a malformed one,
 * which must assign nobody rather than someone.
 */
import { describe, expect, it } from 'vitest';
import { parseApproverAssignments, slotAssigned, slotOf } from './approvers';

describe('parseApproverAssignments', () => {
    it('keeps slot -> user ids, trimming and dropping blanks', () => {
        expect(parseApproverAssignments({ ben: [' user_1 ', '', 'user_2'], ' ': ['x'] })).toEqual({ ben: ['user_1', 'user_2'] });
    });

    it('a missing or malformed row assigns nobody', () => {
        expect(parseApproverAssignments(undefined)).toEqual({});
        expect(parseApproverAssignments(null)).toEqual({});
        expect(parseApproverAssignments('ben')).toEqual({});
        expect(parseApproverAssignments(['ben'])).toEqual({});
        expect(parseApproverAssignments({ ben: 'user_1' })).toEqual({});
        expect(parseApproverAssignments({ ben: [1, null, {}] })).toEqual({});
    });
});

describe('slotOf and slotAssigned', () => {
    it('maps a listed user id to its slot and nobody else', () => {
        const a = parseApproverAssignments({ ben: ['user_1'] });
        expect(slotOf({ id: 'user_1' }, a)).toEqual({ kind: 'human', id: 'ben' });
        expect(slotOf({ id: 'user_2' }, a)).toBeNull();
        expect(slotAssigned({ kind: 'human', id: 'ben' }, a)).toBe(true);
        expect(slotAssigned({ kind: 'human', id: 'ben' }, {})).toBe(false);
    });
});
