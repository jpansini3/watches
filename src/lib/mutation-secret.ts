/**
 * Constant-time string compare for Next middleware (Edge).
 * Same contract as crypto.timingSafeEqual: reject length mismatch, then XOR.
 */
export function secretsMatch(
  provided: string | undefined,
  expected: string,
): boolean {
  if (!provided) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) {
    mismatch |= left[i]! ^ right[i]!;
  }
  return mismatch === 0;
}

export function mutationSecret(): string | undefined {
  const value = process.env.API_MUTATION_SECRET?.trim();
  return value || undefined;
}
