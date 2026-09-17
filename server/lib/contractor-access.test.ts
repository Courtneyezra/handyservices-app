import { describe, expect, it } from 'vitest';
import {
  ACCESS_CODE_HASH_PREFIX,
  ACCESS_CODE_LENGTH,
  accessCodeNeedsUpgrade,
  generateAccessCode,
  hashAccessCode,
  isActivated,
  storedAccessCodeCandidates,
} from './contractor-access';

describe('contractor access codes', () => {
  it('issues keypad codes: eight digits', () => {
    for (let i = 0; i < 50; i++) expect(generateAccessCode()).toMatch(new RegExp(`^[0-9]{${ACCESS_CODE_LENGTH}}$`));
  });

  it('stores a code as a sha256 hash that is not the code and fits the column', () => {
    const stored = hashAccessCode('12345678');
    expect(stored).toBe(hashAccessCode('12345678'));
    expect(stored.startsWith(ACCESS_CODE_HASH_PREFIX)).toBe(true);
    expect(stored).not.toContain('12345678');
    expect(stored.length).toBeLessThanOrEqual(80);
    expect(hashAccessCode('12345679')).not.toBe(stored);
  });

  it('a typed code matches its hash, or itself for a code stored before hashing', () => {
    expect(storedAccessCodeCandidates('4321')).toEqual([hashAccessCode('4321'), '4321']);
  });

  it('a typed value shaped like a stored hash matches nothing, so a leaked hash is not a code', () => {
    expect(storedAccessCodeCandidates(hashAccessCode('4321'))).toEqual([]);
    expect(storedAccessCodeCandidates('')).toEqual([]);
  });

  it('only a plain-text stored code needs rehashing', () => {
    expect(accessCodeNeedsUpgrade('4321')).toBe(true);
    expect(accessCodeNeedsUpgrade(hashAccessCode('4321'))).toBe(false);
    expect(accessCodeNeedsUpgrade(null)).toBe(false);
  });

  it('a contractor is activated only while activatedAt is set', () => {
    expect(isActivated({ activatedAt: new Date() })).toBe(true);
    expect(isActivated({ activatedAt: null })).toBe(false);
    expect(isActivated({ activatedAt: undefined })).toBe(false);
  });
});
