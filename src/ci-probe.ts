/** Intentionally untested production code to exercise the patch-coverage gate. */
export function classify(n: number): number {
  if (n < 0) return -1;
  if (n === 0) return 0;
  if (n < 10) return 1;
  return 2;
}
