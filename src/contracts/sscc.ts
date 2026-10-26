// Pallet labels (plan 04, stage 8): each pallet gets an 18-digit SSCC, the Serial Shipping Container Code
// of GS1 (gs1uk.org, "Logistics labels and SSCCs"). Shared by the sim, which numbers the pallets, and the
// panels, which list a batch's pallets without the snapshot carrying every code.

/**
 * GS1's own example company prefix, used in its documentation, so no real company's codes are copied.
 * Seven digits leave nine for the serial reference.
 */
export const GS1_COMPANY_PREFIX = '0614141';

/** The SSCC's first digit, free for the company to choose; it only widens the serial range. */
export const SSCC_EXTENSION_DIGIT = '3';

/**
 * A batch's pallets are numbered 1 to 999, and the serial reference is batch × 1,000 + pallet number, so
 * every pallet of a batch carries a consecutive SSCC and the codes never repeat (checkPlantConfig keeps
 * a batch under 1,000 pallets).
 */
export const MAX_PALLETS_PER_BATCH = 999;

const SERIAL_DIGITS = 17 - SSCC_EXTENSION_DIGIT.length - GS1_COMPANY_PREFIX.length;

/**
 * The GS1 check digit of a string of digits (GTIN, SSCC and the rest): weight the digits 3, 1, 3, 1 …
 * from the right, and the check digit brings the sum up to a multiple of 10.
 */
export function gs1CheckDigit(digits: string): number {
  if (!/^\d+$/.test(digits)) throw new RangeError(`A GS1 check digit needs digits only, got "${digits}"`);
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    const digit = Number(digits[digits.length - 1 - i]);
    sum += i % 2 === 0 ? 3 * digit : digit;
  }
  return (10 - (sum % 10)) % 10;
}

/** The 18-digit SSCC of a batch's pallet: extension digit, company prefix, serial reference, check digit. */
export function ssccFor(batchId: number, palletNo: number): string {
  if (!(Number.isInteger(batchId) && batchId >= 0) || !(Number.isInteger(palletNo) && palletNo >= 1 && palletNo <= MAX_PALLETS_PER_BATCH)) {
    throw new RangeError(`No SSCC for pallet ${palletNo} of batch ${batchId}`);
  }
  const serial = String(batchId * (MAX_PALLETS_PER_BATCH + 1) + palletNo).padStart(SERIAL_DIGITS, '0');
  if (serial.length > SERIAL_DIGITS) throw new RangeError(`Batch ${batchId} is past the SSCC serial range`);
  const body = `${SSCC_EXTENSION_DIGIT}${GS1_COMPANY_PREFIX}${serial}`;
  return `${body}${gs1CheckDigit(body)}`;
}

/** An SSCC as a label prints it under the barcode: "(00) 3 0614141 000054001 4". */
export function formatSscc(sscc: string): string {
  const prefixEnd = SSCC_EXTENSION_DIGIT.length + GS1_COMPANY_PREFIX.length;
  return `(00) ${sscc.slice(0, SSCC_EXTENSION_DIGIT.length)} ${sscc.slice(SSCC_EXTENSION_DIGIT.length, prefixEnd)} ${sscc.slice(prefixEnd, 17)} ${sscc.slice(17)}`;
}
