export type Microdollars = bigint;

export const MICRODOLLARS_PER_DOLLAR = 1_000_000n;

export function usdToMicrodollars(value: string, name: string): Microdollars {
  if (!/^\d+(?:\.\d{1,6})?$/.test(value)) {
    throw new Error(`${name} must be a non-negative USD decimal with at most six decimal places.`);
  }

  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * MICRODOLLARS_PER_DOLLAR + BigInt(fraction.padEnd(6, "0"));
}

export function microdollarsToUsd(value: Microdollars): string {
  const whole = value / MICRODOLLARS_PER_DOLLAR;
  const fraction = (value % MICRODOLLARS_PER_DOLLAR).toString().padStart(6, "0");
  return `${whole}.${fraction}`;
}