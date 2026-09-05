export const DADS = ["dad", "father-in-law", "me", "brother-in-law", "cam", "mark", "tim"] as const;

export function isDad(value: string): value is (typeof DADS)[number] {
  return (DADS as readonly string[]).includes(value);
}
