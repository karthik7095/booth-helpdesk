import { Buffer } from "buffer";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { PermissionsAndroid, Platform } from "react-native";
import UPNG from "upng-js";
import RNBluetoothClassic from "react-native-bluetooth-classic";
import type { BluetoothDevice, BluetoothNativeDevice } from "react-native-bluetooth-classic";

import { getMeta, removeMeta, setMeta } from "@/lib/db";

/**
 * Bluetooth Classic (SPP) thermal printers — the 58mm ESC/POS slips agents
 * carry in the field. Discovery, pairing and the RFCOMM socket are Android-only
 * APIs; iOS only ever sees MFi-certified accessories, which these are not.
 */
export const DISCOVERY_SUPPORTED = Platform.OS === "android";

const ADDRESS_KEY = "printerAddress";
const NAME_KEY = "printerName";

export type PrinterDevice = {
  name: string;
  address: string;
  paired: boolean;
};

function toPrinterDevice(device: BluetoothNativeDevice): PrinterDevice {
  return {
    name: device.name || device.address,
    address: device.address,
    paired: Boolean(device.bonded),
  };
}

function apiLevel(): number {
  return typeof Platform.Version === "number" ? Platform.Version : Number(Platform.Version);
}

/**
 * Android 12 replaced the location-permission dance with dedicated scan and
 * connect permissions. Below that, discovery silently returns nothing unless
 * fine location is granted — the single most common "it finds no printers" bug.
 */
export async function ensureBluetoothPermissions(): Promise<boolean> {
  if (Platform.OS !== "android") return true;

  const needed =
    apiLevel() >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];

  const result = await PermissionsAndroid.requestMultiple(needed);

  return needed.every((permission) => result[permission] === PermissionsAndroid.RESULTS.GRANTED);
}

export async function isBluetoothEnabled(): Promise<boolean> {
  try {
    return await RNBluetoothClassic.isBluetoothEnabled();
  } catch {
    return false;
  }
}

/** Shows the system "turn on Bluetooth?" prompt. Resolves false if declined. */
export async function enableBluetooth(): Promise<boolean> {
  try {
    return await RNBluetoothClassic.requestBluetoothEnabled();
  } catch {
    return false;
  }
}

export function openBluetoothSettings(): void {
  RNBluetoothClassic.openBluetoothSettings();
}

export async function pairedDevices(): Promise<PrinterDevice[]> {
  const devices = await RNBluetoothClassic.getBondedDevices();

  return devices.map(toPrinterDevice);
}

/**
 * Runs a full discovery cycle (~12s on most phones) and resolves with the
 * unpaired devices found. Live results arrive through `onDeviceDiscovered`, so
 * the screen can fill the list before this settles.
 */
export async function discoverDevices(): Promise<PrinterDevice[]> {
  const devices = await RNBluetoothClassic.startDiscovery();

  return devices.map(toPrinterDevice).filter((device) => !device.paired);
}

export async function cancelDiscovery(): Promise<void> {
  try {
    await RNBluetoothClassic.cancelDiscovery();
  } catch {
    // Discovery was not running — nothing to cancel.
  }
}

export function onDeviceDiscovered(listener: (device: PrinterDevice) => void) {
  return RNBluetoothClassic.onDeviceDiscovered((event) => listener(toPrinterDevice(event.device)));
}

export function onBluetoothStateChanged(listener: (enabled: boolean) => void) {
  return RNBluetoothClassic.onStateChanged((event) => listener(event.enabled));
}

export function onDeviceDisconnected(listener: (address: string) => void) {
  return RNBluetoothClassic.onDeviceDisconnected((event) => listener(event.device.address));
}

/**
 * Bonds with the printer if it isn't paired yet, then opens the RFCOMM socket.
 * Cheap printers are split roughly evenly between accepting a secure socket and
 * only accepting an insecure one, so a refused connection is retried insecurely
 * before it is reported as a failure.
 */
/**
 * Opens the RFCOMM socket. Cheap printers are split roughly evenly between
 * accepting a secure socket and only accepting an insecure one, so a refused
 * connection is retried insecurely before it counts as a failure.
 */
async function openSocket(address: string): Promise<BluetoothDevice> {
  const options = { connectorType: "rfcomm", delimiter: "", charset: "ascii" };

  try {
    return await RNBluetoothClassic.connectToDevice(address, options);
  } catch {
    return RNBluetoothClassic.connectToDevice(address, { ...options, secureSocket: false });
  }
}

export async function connectPrinter(address: string): Promise<PrinterDevice> {
  await cancelDiscovery();

  const bonded = await RNBluetoothClassic.getBondedDevices();

  if (!bonded.some((device) => device.address === address)) {
    await RNBluetoothClassic.pairDevice(address);
  }

  const device = await openSocket(address);
  const printer = { ...toPrinterDevice(device), paired: true };

  await setMeta(ADDRESS_KEY, printer.address);
  await setMeta(NAME_KEY, printer.name);

  return printer;
}

export async function disconnectPrinter(address: string): Promise<void> {
  try {
    await RNBluetoothClassic.disconnectFromDevice(address);
  } finally {
    await removeMeta(ADDRESS_KEY);
    await removeMeta(NAME_KEY);
  }
}

/**
 * The printer this phone is set up with.
 *
 * The RFCOMM socket lives in the app process, so Android killing the app — or
 * an agent swiping it away, or the printer being switched off overnight —
 * closes it while the address stays remembered. Without `reconnect` the next
 * print would fall silently back to the system print dialog and the agent would
 * have no idea why, so the print path reopens the socket first. The device is
 * already bonded at the OS level, so this is a socket open, not a re-pair.
 *
 * The printer screen passes `reconnect: false`: it reports the live state, and
 * should not sit for several seconds dialling a printer that is switched off.
 */
export async function connectedPrinter(
  { reconnect = false }: { reconnect?: boolean } = {},
): Promise<PrinterDevice | null> {
  const address = await getMeta(ADDRESS_KEY);

  if (!address) return null;

  const found = async () => ({
    name: (await getMeta(NAME_KEY)) ?? address,
    address,
    paired: true,
  });

  try {
    if (await RNBluetoothClassic.isDeviceConnected(address)) return await found();
  } catch {
    // Treated as disconnected; the reconnect below decides the outcome.
  }

  if (!reconnect) return null;

  try {
    await reopenSocket(address);

    return await found();
  } catch {
    return null;
  }
}

/**
 * One reconnect at a time per printer: the background watcher and a print
 * can both decide to reopen the socket, and two RFCOMM connects to the same
 * printer at once make both fail.
 */
const reopening = new Map<string, Promise<BluetoothDevice>>();

function reopenSocket(address: string): Promise<BluetoothDevice> {
  const pending = reopening.get(address);

  if (pending) return pending;

  const attempt = openSocket(address).finally(() => reopening.delete(address));

  reopening.set(address, attempt);

  return attempt;
}

/** The remembered printer's name, connected or not. */
export async function rememberedPrinterName(): Promise<string | null> {
  return getMeta(NAME_KEY);
}

/** The remembered printer, connected or not — used to mark it in the list. */
export async function rememberedPrinterAddress(): Promise<string | null> {
  return getMeta(ADDRESS_KEY);
}

const ESC = "\x1B";
const GS = "\x1D";
const INIT = `${ESC}@`;
const CENTER = `${ESC}a\x01`;
const LEFT = `${ESC}a\x00`;
const BOLD_ON = `${ESC}E\x01`;
const BOLD_OFF = `${ESC}E\x00`;
/**
 * Emphasised glyphs are a dot wider than the 12-dot cell, so bold letters run
 * into each other; ESC SP n leaves n blank dots after every character.
 */
const BOLD_SPACING = 2;
const SPACING_BOLD = `${ESC} ${String.fromCharCode(BOLD_SPACING)}`;
const SPACING_NORMAL = `${ESC} \x00`;
/** GS ! n — high nibble is width, low nibble height, both zero-based. */
const SIZE_NORMAL = `${GS}!\x00`;
/** Double height only. Character width is unchanged, so all 32 columns remain. */
const SIZE_TALL = `${GS}!\x01`;
/** Double both. Twice as loud, but the line is only 16 columns wide. */
const SIZE_LARGE = `${GS}!\x11`;
const CUT = `${GS}V\x00`;

/**
 * Characters per line at font A on 58mm paper: 384 dots wide, 12 dots per
 * character. Double-size text fits half as many.
 */
export const PRINTER_COLUMNS = 32;

/** Characters per line in bold, with the extra spacing between letters. */
export const BOLD_COLUMNS = Math.floor(384 / (12 + BOLD_SPACING));

/**
 * These printers hold one built-in code page and no Indic font, so anything
 * outside printable ASCII would come out as blanks or mojibake. Callers are
 * expected to supply English text; this is the last line of defence.
 */
function ascii(text: string): string {
  return text.replace(/[^\x20-\x7E\n]/g, "");
}

/**
 * `8<` rather than a scissors glyph: the printer carries no Unicode font, so ✂
 * would reach the paper as a blank. It is the long-standing plain-text cut mark
 * and reads as scissors to anyone who has held a shop receipt.
 */
function cutMarkLine(): string {
  const mark = " 8< ";
  const side = Math.max(0, Math.floor((PRINTER_COLUMNS - mark.length) / 2));
  // "- " reads as a tear-off rule; a solid run of dashes reads as a border.
  const dashes = "- ".repeat(Math.ceil(side / 2)).slice(0, side);

  return `${dashes}${mark}${dashes}`;
}

/**
 * `tall` doubles height and keeps 32 columns; `large` doubles both and leaves
 * only 16, so a label that has to share a line with a value wants `tall`.
 */
export type ReceiptSize = "normal" | "tall" | "large";

/** One printable piece of a slip. */
export type ReceiptBlock =
  | { type: "text"; text: string; align?: "left" | "center"; bold?: boolean; size?: ReceiptSize }
  | { type: "rule" }
  | { type: "cut"; label?: string }
  | { type: "image"; uri: string };

/** Columns available at a given size. */
export function columnsFor(size: ReceiptSize | undefined, bold = false): number {
  const columns = bold ? BOLD_COLUMNS : PRINTER_COLUMNS;
  return size === "large" ? Math.floor(columns / 2) : columns;
}

function render(block: Exclude<ReceiptBlock, { type: "image" }>): string {
  if (block.type === "rule") return `${LEFT}${"-".repeat(PRINTER_COLUMNS)}\n`;

  if (block.type === "cut") {
    // Instruction first, then the line it refers to, then a blank line so the
    // detail below is not read as part of the tear-off.
    return (
      `${CENTER}${ascii(block.label ?? "Please cut here")}\n` +
      `${LEFT}${cutMarkLine()}\n\n`
    );
  }

  const size =
    block.size === "large" ? SIZE_LARGE : block.size === "tall" ? SIZE_TALL : SIZE_NORMAL;

  return (
    `${block.align === "center" ? CENTER : LEFT}` +
    `${size}${block.bold ? BOLD_ON + SPACING_BOLD : BOLD_OFF}` +
    `${ascii(block.text)}${BOLD_OFF}${SPACING_NORMAL}${SIZE_NORMAL}\n`
  );
}

/** Sends plain ESC/POS text, left-aligned. */
export async function printLines(address: string, lines: string[]): Promise<void> {
  await RNBluetoothClassic.writeToDevice(
    address,
    `${INIT}${LEFT}${ascii(lines.join("\n"))}\n\n\n${CUT}`,
    "ascii",
  );
}

/**
 * Sends a composed slip. Text is batched into as few writes as possible, but an
 * image block forces a flush: rasters go down the socket as binary and have to
 * land between the text either side of them, which is the only way the caller
 * can control where the cover sits in the slip.
 */
export async function printReceipt(address: string, blocks: ReceiptBlock[]): Promise<void> {
  let buffer = INIT;

  const flush = async () => {
    if (!buffer) return;

    await RNBluetoothClassic.writeToDevice(address, buffer, "ascii");
    buffer = "";
  };

  for (const block of blocks) {
    if (block.type === "image") {
      await flush();

      try {
        await writeImage(address, block.uri);
      } catch {
        // A cover that will not render must never cost the agent the slip.
      }

      continue;
    }

    buffer += render(block);
  }

  buffer += `\n\n\n${CUT}`;
  await flush();
}

export async function testPrint(address: string): Promise<void> {
  await RNBluetoothClassic.writeToDevice(
    address,
    `${INIT}${CENTER}${BOLD_ON}Printer connected${BOLD_OFF}\n${LEFT}` +
      `${new Date().toLocaleString()}\nBooth Help Desk\n\n\n${CUT}`,
    "ascii",
  );
}

const IMAGE_KEY = "printerImageEnabled";

/**
 * Whether this phone tops slips with the cover image, where the constituency
 * prints slip images at all. On unless the agent has switched it off.
 */
export async function isImagePrintEnabled(): Promise<boolean> {
  return (await getMeta(IMAGE_KEY)) !== "0";
}

export async function setImagePrintEnabled(enabled: boolean): Promise<void> {
  await setMeta(IMAGE_KEY, enabled ? "1" : "0");
}

const CUT_NOTE_KEY = "printerCutNoteEnabled";

/** Whether the Telugu "cut here" caution follows the cover image. On unless turned off. */
export async function isCutNoteEnabled(): Promise<boolean> {
  return (await getMeta(CUT_NOTE_KEY)) !== "0";
}

export async function setCutNoteEnabled(enabled: boolean): Promise<void> {
  await setMeta(CUT_NOTE_KEY, enabled ? "1" : "0");
}
/** The head is 384 dots across on 58mm paper; one bit per dot. */
const DOTS_PER_LINE = 384;
/**
 * Rows per `GS v 0` command. These printers have a small input buffer and a
 * full-height raster in one command overruns it on the cheaper models, which
 * shows up as a half-printed image; banding keeps each write small.
 */
const BAND_ROWS = 64;

/**
 * Floyd–Steinberg. The head can only print a dot or not print one, so a plain
 * brightness threshold turns a photograph into flat blobs. Diffusing the error
 * into neighbouring pixels trades spatial resolution for apparent greys, which
 * is what makes a face on a banner still readable at one bit per dot.
 */
function dither(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const grey = new Float32Array(width * height);

  for (let i = 0; i < width * height; i += 1) {
    const r = rgba[i * 4]!;
    const g = rgba[i * 4 + 1]!;
    const b = rgba[i * 4 + 2]!;
    const a = rgba[i * 4 + 3]! / 255;

    // Composite onto white: transparent areas must not print as black.
    grey[i] = 255 - a * (255 - (0.299 * r + 0.587 * g + 0.114 * b));
  }

  const bits = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const old = grey[i]!;
      const next = old < 128 ? 0 : 255;

      bits[i] = next === 0 ? 1 : 0;

      const error = old - next;
      const spread = (dx: number, dy: number, weight: number) => {
        const nx = x + dx;
        const ny = y + dy;

        if (nx < 0 || nx >= width || ny >= height) return;

        grey[ny * width + nx] += (error * weight) / 16;
      };

      spread(1, 0, 7);
      spread(-1, 1, 3);
      spread(0, 1, 5);
      spread(1, 1, 1);
    }
  }

  return bits;
}

/** Packs one band of set bits into ESC/POS raster bytes, MSB first. */
function band(bits: Uint8Array, width: number, top: number, rows: number): Buffer {
  const bytesPerRow = Math.ceil(width / 8);
  const header = Buffer.from([
    0x1d,
    0x76,
    0x30,
    0x00,
    bytesPerRow & 0xff,
    (bytesPerRow >> 8) & 0xff,
    rows & 0xff,
    (rows >> 8) & 0xff,
  ]);
  const data = Buffer.alloc(bytesPerRow * rows, 0);

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (bits[(top + y) * width + x] === 1) {
        data[y * bytesPerRow + (x >> 3)]! |= 0x80 >> (x & 7);
      }
    }
  }

  return Buffer.concat([header, data]);
}

/**
 * Prints an image at the top of a slip. The file is resized to the head's dot
 * width and re-encoded as PNG first: the banner arrives as whatever the server
 * stored, and PNG is the one format that decodes losslessly in JS here.
 */
type Raster = { bits: Uint8Array; width: number; height: number };

/**
 * Resizes to the head's dot width and reduces to one bit per dot. The file is
 * re-encoded as PNG first: the cover arrives as whatever the dashboard was
 * given, and PNG is the one format that decodes losslessly in JS here.
 */
async function rasterize(uri: string): Promise<Raster> {
  const context = ImageManipulator.manipulate(uri).resize({ width: DOTS_PER_LINE });
  const rendered = await (await context.renderAsync()).saveAsync({
    format: SaveFormat.PNG,
    base64: true,
  });

  if (!rendered.base64) throw new Error("Could not read the cover image.");

  const decoded = UPNG.decode(Buffer.from(rendered.base64, "base64").buffer as ArrayBuffer);
  const rgba = new Uint8Array(UPNG.toRGBA8(decoded)[0]!);

  return {
    bits: dither(rgba, decoded.width, decoded.height),
    width: decoded.width,
    height: decoded.height,
  };
}

/** Writes a raster mid-receipt. No INIT: that would reset the receipt's state. */
async function writeImage(address: string, uri: string): Promise<void> {
  const { bits, width, height } = await rasterize(uri);

  // Centre alignment applies to raster images too, so a cover narrower than the
  // head is not left-justified against the edge of the paper.
  await RNBluetoothClassic.writeToDevice(address, CENTER, "ascii");

  for (let top = 0; top < height; top += BAND_ROWS) {
    const rows = Math.min(BAND_ROWS, height - top);

    await RNBluetoothClassic.writeToDevice(address, band(bits, width, top, rows));
  }

  await RNBluetoothClassic.writeToDevice(address, `${LEFT}\n`, "ascii");
}
