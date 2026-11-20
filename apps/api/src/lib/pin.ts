import { randomInt } from 'node:crypto';

/** Ambiguous characters (0/O, 1/I) are left out so PINs survive being read aloud. */
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';

/**
 * Builds a PIN in the shape of "S29GD241B1":
 * state code + constituency code + assembly number + a random letter/digit pair.
 */
export function buildPin(stateCode: string, code: string, assemblyNo: number): string {
  const letter = LETTERS[randomInt(LETTERS.length)];
  const digit = DIGITS[randomInt(DIGITS.length)];

  return `${stateCode}${code}${assemblyNo}${letter}${digit}`.toUpperCase();
}

/**
 * Generates a PIN that is not already taken. Falls back to a longer suffix if
 * the short space for this constituency is crowded.
 */
export async function generateUniquePin(
  assembly: { stateCode: string; code: string; assemblyNo: number },
  exists: (pin: string) => Promise<boolean>,
): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const pin = buildPin(assembly.stateCode, assembly.code, assembly.assemblyNo);

    if (!(await exists(pin))) return pin;
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const pin = `${buildPin(assembly.stateCode, assembly.code, assembly.assemblyNo)}${
      LETTERS[randomInt(LETTERS.length)]
    }`;

    if (!(await exists(pin))) return pin;
  }

  throw new Error('Could not generate a unique PIN for this constituency');
}
