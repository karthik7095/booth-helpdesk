import { Model } from "@nozbe/watermelondb";

/**
 * One voter slip printed from this phone. Written once, pushed by the next
 * sync, never read back on the phone — so there are no getters, only the
 * raw setter the write path needs (see `VoterModel` for why not decorators).
 */
export default class SlipPrintModel extends Model {
  static table = "slip_prints";

  set(column: string, value: string | number | null): void {
    this._setRaw(column, value);
  }
}
