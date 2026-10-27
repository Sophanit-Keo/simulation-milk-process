// Pallet labels (src/contracts/sscc.ts): the GS1 check digit and the 18-digit SSCC each pallet carries.
import { describe, expect, it } from 'vitest';
import { formatSscc, gs1CheckDigit, GS1_COMPANY_PREFIX, MAX_PALLETS_PER_BATCH, ssccFor } from '../../src/contracts';

describe('gs1CheckDigit', () => {
  // Published examples, each with its check digit last: an EAN-13 (GTIN-13) and a UPC-A (GTIN-12), which use
  // the same GS1 mod-10 rule as the SSCC: weights 3, 1, 3, 1 … from the right.
  it.each([
    ['400638133393', 1, 'EAN-13 4006381333931'],
    ['03600029145', 2, 'UPC-A 036000291452'],
  ])('%s gives %i (%s)', (digits, check) => {
    expect(gs1CheckDigit(digits)).toBe(check);
  });

  it('works the SSCC weights by hand: 3 0614141 000054001', () => {
    // From the right, 1 0 0 4 5 0 0 0 0 1 4 1 4 1 6 0 3 weighted 3, 1, 3, …:
    // 3 + 0 + 0 + 4 + 15 + 0 + 0 + 0 + 0 + 1 + 12 + 1 + 12 + 1 + 18 + 0 + 9 = 76, and 76 + 4 = 80.
    expect(gs1CheckDigit('30614141000054001')).toBe(4);
  });

  it('refuses anything but digits', () => {
    expect(() => gs1CheckDigit('12a4')).toThrow(RangeError);
    expect(() => gs1CheckDigit('')).toThrow(RangeError);
  });
});

describe('ssccFor', () => {
  it('is 18 digits: extension 3, the GS1 example company prefix, a 9-digit serial, the check digit', () => {
    const sscc = ssccFor(54, 1);
    expect(sscc).toMatch(/^\d{18}$/);
    expect(sscc.slice(0, 1)).toBe('3');
    expect(sscc.slice(1, 8)).toBe(GS1_COMPANY_PREFIX);
    expect(sscc.slice(8, 17)).toBe('000054001');
    expect(Number(sscc[17])).toBe(gs1CheckDigit(sscc.slice(0, 17)));
    expect(sscc).toBe('306141410000540014');
  });

  it("numbers a batch's pallets consecutively, and two batches never share a code", () => {
    const codes = new Set<string>();
    for (const batchId of [1, 2, 999, 1_000]) {
      for (let palletNo = 1; palletNo <= 60; palletNo++) {
        const sscc = ssccFor(batchId, palletNo);
        expect(Number(sscc.slice(8, 17))).toBe(batchId * 1_000 + palletNo);
        codes.add(sscc);
      }
    }
    expect(codes.size).toBe(4 * 60);
  });

  it(`refuses pallet 0, pallet ${MAX_PALLETS_PER_BATCH + 1} and batches past the serial range`, () => {
    expect(() => ssccFor(1, 0)).toThrow(RangeError);
    expect(() => ssccFor(1, MAX_PALLETS_PER_BATCH + 1)).toThrow(RangeError);
    expect(() => ssccFor(1_000_000, 1)).toThrow(RangeError);
    expect(() => ssccFor(1.5, 1)).toThrow(RangeError);
  });

  it('prints as the label does: (00) 3 0614141 000054001 4', () => {
    expect(formatSscc(ssccFor(54, 1))).toBe('(00) 3 0614141 000054001 4');
  });
});
