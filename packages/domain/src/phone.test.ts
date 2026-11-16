import { describe, expect, it } from 'vitest';
import { normalizeBdPhone } from './phone';

describe('normalizeBdPhone', () => {
  it('accepts the ways people write a Bangladeshi mobile number', () => {
    for (const input of ['01711000001', '8801711000001', '+8801711000001', '017-1100 0001', ' +880 1711-000001 ']) {
      expect(normalizeBdPhone(input)).toBe('+8801711000001');
    }
  });

  it('accepts every operator prefix from 013 to 019', () => {
    for (const p of ['3', '4', '5', '6', '7', '8', '9']) {
      expect(normalizeBdPhone(`01${p}11000001`)).toBe(`+8801${p}11000001`);
    }
  });

  it('rejects anything else, including foreign numbers', () => {
    for (const input of [
      '',
      '0171100000',
      '017110000011',
      '01211000001',
      '1711000001',
      '8801211000001',
      '+447911123456',
      '+1 415 555 0100',
      '01711OOOOO1',
      '০১৭১১০০০০০১',
    ]) {
      expect(normalizeBdPhone(input), input).toBeNull();
    }
  });
});
