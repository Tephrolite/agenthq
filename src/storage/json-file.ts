import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

/** Single-process local storage. Corrupt files stop startup; never silently reset accounting. */
export class JsonFile<T> {
  constructor(private readonly path: string) {}
  read(fallback: T): T {
    return existsSync(this.path) ? JSON.parse(readFileSync(this.path, 'utf8')) as T : fallback;
  }
  write(value: T): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(`${this.path}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 });
    renameSync(`${this.path}.tmp`, this.path);
  }
}
