/**
 * How a local index build shares the JS thread. WatermelonDB's JSI mode runs
 * each SQL chunk synchronously, so the chunk size sets the longest pause the
 * UI can suffer and the yield sets how much air it gets between chunks.
 */
export type BuildPace = {
  /** Rows (or booths) per chunk. */
  chunk: number;
  /** Milliseconds to wait between chunks. */
  yieldMs: number;
};

/** Behind a live screen on an upgraded phone: short chunks, real pauses. */
export const GENTLE_PACE: BuildPace = { chunk: 1000, yieldMs: 40 };

/** During a first download, where only the progress text needs a frame. */
export const FAST_PACE: BuildPace = { chunk: 5000, yieldMs: 0 };
