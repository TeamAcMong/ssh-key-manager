/**
 * Rough passphrase strength (0..4) from estimated entropy. It only guides the user;
 * it is not a security guarantee.
 */
export function passphraseStrength(p: string): 0 | 1 | 2 | 3 | 4 {
  if (!p) return 0;
  let pool = 0;
  if (/[a-z]/.test(p)) pool += 26;
  if (/[A-Z]/.test(p)) pool += 26;
  if (/[0-9]/.test(p)) pool += 10;
  if (/[^A-Za-z0-9\s]/.test(p)) pool += 33;
  if (/\s/.test(p)) pool += 1;
  if (/[^\x00-\x7F]/.test(p)) pool += 64;
  const unique = new Set(p).size;
  // Repetition ("aaaaaa", "abcabc") adds little entropy: count distinct characters more.
  const effectiveLen = Math.min(p.length, unique * 2);
  const bits = effectiveLen * Math.log2(Math.max(pool, 2));
  if (bits < 28) return 0;
  if (bits < 40) return 1;
  if (bits < 60) return 2;
  if (bits < 80) return 3;
  return 4;
}
