import { prisma } from '../prisma.js';

/**
 * Turns a GPS fix into a short place name using OpenStreetMap's Nominatim.
 * Its usage policy allows one request a second with an identifying
 * User-Agent, so lookups are queued, spaced out and cached by position.
 */
const ENDPOINT = 'https://nominatim.openstreetmap.org/reverse';
const USER_AGENT = 'voter-management/1.0 (constituency dashboard)';
const MIN_GAP_MS = 1100;
const TIMEOUT_MS = 8000;
/** ~110 m cells: people moving within a street share one lookup. */
const CELL_DECIMALS = 3;
const CACHE_LIMIT = 5000;

type Address = Record<string, string | undefined>;

const cache = new Map<string, string | null>();
let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

function cellKey(latitude: number, longitude: number) {
  return `${latitude.toFixed(CELL_DECIMALS)},${longitude.toFixed(CELL_DECIMALS)}`;
}

/** "Sri Ram Nagar Colony, Banjara Hills, Hyderabad" — locality, area, city. */
export function placeNameFrom(address: Address, displayName?: string): string | null {
  const pick = (...keys: string[]) => keys.map((key) => address[key]).find(Boolean);

  const parts = [
    pick('neighbourhood', 'quarter', 'hamlet', 'road'),
    pick('suburb', 'village', 'city_district'),
    pick('city', 'town', 'municipality', 'county', 'state_district'),
  ].filter((part, index, all): part is string => !!part && all.indexOf(part) === index);

  if (parts.length > 0) return parts.join(', ');

  return displayName?.split(',').slice(0, 3).map((part) => part.trim()).join(', ') || null;
}

async function lookup(latitude: number, longitude: number): Promise<string | null> {
  const wait = lastRequestAt + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();

  const url = `${ENDPOINT}?format=jsonv2&zoom=16&addressdetails=1&lat=${latitude}&lon=${longitude}`;
  const response = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, 'accept-language': 'en' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) throw new Error(`Nominatim ${response.status}`);

  const body = (await response.json()) as { address?: Address; display_name?: string };

  return placeNameFrom(body.address ?? {}, body.display_name);
}

/** Resolves a place name, or null when there is none or the lookup failed. */
export function reverseGeocode(latitude: number, longitude: number): Promise<string | null> {
  const key = cellKey(latitude, longitude);

  if (cache.has(key)) return Promise.resolve(cache.get(key) ?? null);

  const result = queue.then(() =>
    cache.has(key) ? (cache.get(key) ?? null) : lookup(latitude, longitude),
  );

  queue = result.catch(() => undefined);

  return result
    .then((name) => {
      if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
      cache.set(key, name);
      return name;
    })
    // A failed lookup is not cached, so it is retried on the next heartbeat.
    .catch(() => null);
}

/**
 * Fills in the place name of a usage row in the background. The coordinates
 * are part of the update's filter, so a newer fix saved meanwhile is never
 * labelled with this one's place.
 */
export function namePlaceLater(rowId: string, latitude: number, longitude: number) {
  void reverseGeocode(latitude, longitude).then((placeName) =>
    placeName
      ? prisma.appUsageDay
          .updateMany({ where: { id: rowId, latitude, longitude }, data: { placeName } })
          .catch(() => undefined)
      : undefined,
  );
}

/** The same for a slip print, whose position never changes once saved. */
export function namePrintPlaceLater(printId: string, latitude: number, longitude: number) {
  void reverseGeocode(latitude, longitude).then((placeName) =>
    placeName
      ? prisma.slipPrint
          .updateMany({ where: { id: printId }, data: { placeName } })
          .catch(() => undefined)
      : undefined,
  );
}
