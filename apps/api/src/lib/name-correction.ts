/** A voter's English name as shown: the roll's first and last name columns together. */
export function joinedName(first: unknown, last: unknown): string {
  return [first, last]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(' ');
}

/**
 * What to write when an agent sets a voter's English name.
 *
 * The whole name goes into `eFirstName`, where rolls usually carry it, and the
 * surname column is cleared so it is not shown twice. The roll's spelling is
 * kept in `eFirstNameRoll` the first time it changes, so the app can show it
 * and an agent can go back to it; going back to it clears it again. An
 * unchanged or empty name writes nothing.
 */
export function nameCorrection(
  existing: { eFirstName: string | null; eLastName: string | null; eFirstNameRoll: string | null },
  name: string,
) {
  const next = name.trim().replace(/\s+/g, ' ');
  const current = joinedName(existing.eFirstName, existing.eLastName);

  if (!next || next === current) return {};

  const roll = existing.eFirstNameRoll ?? current;

  return {
    eFirstName: next,
    eLastName: null,
    eFirstNameRoll: next.toUpperCase() === roll.toUpperCase() ? null : roll,
  };
}
