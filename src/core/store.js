import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Flat-file persistence. Writes go to a temp file and get renamed over the real
 * one, so a crash mid-write leaves the previous race intact instead of half a
 * race. Saves are debounced because a busy hour is a lot of submissions.
 */
export class Store {
  constructor(file, { debounceMs = 400 } = {}) {
    this.file = file;
    this.debounceMs = debounceMs;
    this.timer = null;
    this.pending = null;
    mkdirSync(dirname(file), { recursive: true });
  }

  load() {
    if (!existsSync(this.file)) return null;
    try {
      return JSON.parse(readFileSync(this.file, 'utf8'));
    } catch (err) {
      const broken = `${this.file}.broken-${Date.now()}`;
      renameSync(this.file, broken);
      console.error(`[store] ${this.file} was unreadable (${err.message}); moved to ${broken}`);
      return null;
    }
  }

  save(race) {
    this.pending = race;
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
    this.timer.unref?.();
  }

  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.pending) return;
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.pending, null, 2));
    renameSync(tmp, this.file);
    this.pending = null;
  }

  archive(race) {
    const dir = join(dirname(this.file), 'archive');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${race.id}.json`), JSON.stringify(race, null, 2));
  }
}
