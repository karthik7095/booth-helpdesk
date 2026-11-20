import { useSyncExternalStore } from "react";
import { AppState } from "react-native";

import {
  connectedPrinter,
  DISCOVERY_SUPPORTED,
  isBluetoothEnabled,
  onBluetoothStateChanged,
  onDeviceDisconnected,
  rememberedPrinterAddress,
  rememberedPrinterName,
} from "@/lib/printer";

/**
 * Keeps the agent's paired printer connected while the app is open. Printers
 * get switched off between voters to save their battery, and switched on
 * again; this notices and reopens the socket by itself, so the agent never
 * has to visit the Printer screen to reconnect.
 *
 * Only the remembered printer is tried, and only while the app is in front,
 * Bluetooth is on and the Printer screen (which pairs and connects by hand)
 * is not open. A switched-off printer costs one failed socket open every
 * RETRY_MS, done natively off the JS thread.
 */

export type PrinterState =
  /** No printer has been set up on this phone. */
  | "none"
  | "connected"
  /** Trying to reopen the socket right now. */
  | "connecting"
  /** Set up, but switched off, out of range, or Bluetooth is off. */
  | "off";

export type PrinterStatus = { state: PrinterState; name: string | null };

const CONNECTED_CHECK_MS = 30_000;
const RETRY_MS = 15_000;
const AFTER_DROP_MS = 3_000;

let status: PrinterStatus = { state: "none", name: null };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let paused = 0;
let started = false;

function set(next: PrinterStatus): void {
  if (next.state === status.state && next.name === status.name) return;

  status = next;
  for (const listener of listeners) listener();
}

function schedule(ms: number): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void tick(), ms);
}

async function tick(): Promise<void> {
  timer = null;

  // Paused or in the background: the resume or the AppState change runs it again.
  if (running || paused > 0 || AppState.currentState !== "active") return;

  running = true;

  try {
    const address = await rememberedPrinterAddress();

    if (!address) {
      set({ state: "none", name: null });
      schedule(CONNECTED_CHECK_MS);
      return;
    }

    const name = (await rememberedPrinterName()) ?? address;

    if (!(await isBluetoothEnabled().catch(() => false))) {
      set({ state: "off", name });
      schedule(RETRY_MS);
      return;
    }

    if (await connectedPrinter().catch(() => null)) {
      set({ state: "connected", name });
      schedule(CONNECTED_CHECK_MS);
      return;
    }

    set({ state: "connecting", name });

    const again = await connectedPrinter({ reconnect: true }).catch(() => null);

    // The Printer screen may have opened meanwhile; its own state wins.
    if (paused > 0) return;

    set({ state: again ? "connected" : "off", name });
    schedule(again ? CONNECTED_CHECK_MS : RETRY_MS);
  } finally {
    running = false;
  }
}

/** Starts watching; once per app run, from the root layout. Android only. */
export function startPrinterWatch(): void {
  if (started || !DISCOVERY_SUPPORTED) return;

  started = true;

  onDeviceDisconnected(() => {
    set({ ...status, state: "off" });
    schedule(AFTER_DROP_MS);
  });
  onBluetoothStateChanged((enabled) => {
    if (!enabled) set({ ...status, state: status.state === "none" ? "none" : "off" });
    schedule(enabled ? AFTER_DROP_MS : RETRY_MS);
  });
  AppState.addEventListener("change", (next) => {
    if (next === "active") schedule(0);
  });

  schedule(0);
}

/**
 * Holds off automatic reconnects (the Printer screen, while it pairs and
 * connects by hand). Returns the function that lets them run again.
 */
export function pausePrinterWatch(): () => void {
  paused += 1;

  let resumed = false;

  return () => {
    if (resumed) return;

    resumed = true;
    paused = Math.max(0, paused - 1);
    if (paused === 0) schedule(0);
  };
}

/** Checks now rather than at the next interval, e.g. when a screen opens. */
export function checkPrinterNow(): void {
  schedule(0);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

export function usePrinterStatus(): PrinterStatus {
  return useSyncExternalStore(subscribe, () => status);
}
