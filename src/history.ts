export type HistoryEntry<T> = { state: T; label: string };

/** Bounded, branching history. Callers supply immutable action snapshots. */
export class History<T> {
  readonly past: HistoryEntry<T>[] = [];
  readonly future: HistoryEntry<T>[] = [];

  constructor(
    readonly limit: number,
    private readonly equal: (a: T, b: T) => boolean = Object.is,
  ) {
    if (!Number.isInteger(limit) || limit < 1)
      throw new Error("History limit must be a positive integer.");
  }

  record(before: T, after: T, label: string) {
    if (this.equal(before, after)) return false;
    this.past.push({ state: before, label });
    this.trim(this.past);
    this.future.length = 0;
    return true;
  }

  undo(current: T) {
    const entry = this.past.pop();
    if (!entry) return undefined;
    this.future.push({ state: current, label: entry.label });
    this.trim(this.future);
    return entry.state;
  }

  redo(current: T) {
    const entry = this.future.pop();
    if (!entry) return undefined;
    this.past.push({ state: current, label: entry.label });
    this.trim(this.past);
    return entry.state;
  }

  private trim(entries: HistoryEntry<T>[]) {
    if (entries.length > this.limit)
      entries.splice(0, entries.length - this.limit);
  }
}
