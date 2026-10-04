// Записи на играта: основният запис + записите на света (машината на времето).
// IndexedDB 'balkanski-legendi' (хранилища 'main' и 'snapshots'); ако IndexedDB липсва или е блокиран —
// пази всичко в паметта (никога не хвърля при отваряне).
import type { SnapshotMeta, SnapshotStore } from '../sim/types';

export interface MainSave { version: 1; savedAt: number; game: unknown; timeline: unknown }

export interface SaveExport {
  kind: 'balkanski-legendi-save';
  version: 1;
  exportedAt: number;
  main: MainSave | null;
  snapshots: { meta: SnapshotMeta; state: unknown }[];
}

const DB_NAME = 'balkanski-legendi';
const DB_VERSION = 1;
const MAIN_KEY = 'main';

/** Бекенд: или IndexedDB, или обикновени Map-ове в паметта. */
interface Backend {
  getMain(): Promise<MainSave | undefined>;
  setMain(v: MainSave | undefined): Promise<void>;
  getSnap(id: string): Promise<{ meta: SnapshotMeta; state: unknown } | undefined>;
  putSnap(rec: { meta: SnapshotMeta; state: unknown }): Promise<void>;
  delSnap(id: string): Promise<void>;
  allMetas(): Promise<SnapshotMeta[]>;
  allSnaps(): Promise<{ meta: SnapshotMeta; state: unknown }[]>;
  clear(): Promise<void>;
  /** Сменя всичко наведнъж (при внос). */
  replace(main: MainSave | undefined, snaps: { meta: SnapshotMeta; state: unknown }[]): Promise<void>;
}

function clone<T>(v: T): T {
  if (v === undefined) return v;
  try { return structuredClone(v); } catch { return JSON.parse(JSON.stringify(v)) as T; }
}

class MemoryBackend implements Backend {
  private main: MainSave | undefined;
  private snaps = new Map<string, { meta: SnapshotMeta; state: unknown }>();
  async getMain() { return clone(this.main); }
  async setMain(v: MainSave | undefined) { this.main = clone(v); }
  async getSnap(id: string) { return clone(this.snaps.get(id)); }
  async putSnap(rec: { meta: SnapshotMeta; state: unknown }) { this.snaps.set(rec.meta.id, clone(rec)); }
  async delSnap(id: string) { this.snaps.delete(id); }
  async allMetas() { return [...this.snaps.values()].map((r) => clone(r.meta)); }
  async allSnaps() { return [...this.snaps.values()].map((r) => clone(r)); }
  async clear() { this.main = undefined; this.snaps.clear(); }
  async replace(main: MainSave | undefined, snaps: { meta: SnapshotMeta; state: unknown }[]) {
    await this.clear();
    this.main = clone(main);
    for (const s of snaps) this.snaps.set(s.meta.id, clone(s));
  }
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Записът беше прекъснат.'));
  });
}

class IdbBackend implements Backend {
  constructor(private db: IDBDatabase) {}
  private store(name: 'main' | 'snapshots', mode: IDBTransactionMode) {
    return this.db.transaction(name, mode).objectStore(name);
  }
  async getMain() { return (await req(this.store('main', 'readonly').get(MAIN_KEY))) as MainSave | undefined; }
  async setMain(v: MainSave | undefined) {
    const tx = this.db.transaction('main', 'readwrite');
    if (v === undefined) tx.objectStore('main').delete(MAIN_KEY);
    else tx.objectStore('main').put(v, MAIN_KEY);
    await done(tx);
  }
  async getSnap(id: string) {
    return (await req(this.store('snapshots', 'readonly').get(id))) as { meta: SnapshotMeta; state: unknown } | undefined;
  }
  async putSnap(rec: { meta: SnapshotMeta; state: unknown }) {
    const tx = this.db.transaction('snapshots', 'readwrite');
    tx.objectStore('snapshots').put({ id: rec.meta.id, meta: rec.meta, state: rec.state });
    await done(tx);
  }
  async delSnap(id: string) {
    const tx = this.db.transaction('snapshots', 'readwrite');
    tx.objectStore('snapshots').delete(id);
    await done(tx);
  }
  async allSnaps() {
    const all = (await req(this.store('snapshots', 'readonly').getAll())) as { meta: SnapshotMeta; state: unknown }[];
    return all.map((r) => ({ meta: r.meta, state: r.state }));
  }
  async allMetas() {
    // курсор, за да не четем тежките state-ове в един голям масив, когато трябват само метаданните
    const out: SnapshotMeta[] = [];
    await new Promise<void>((resolve, reject) => {
      const r = this.store('snapshots', 'readonly').openCursor();
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        const c = r.result;
        if (!c) return resolve();
        out.push((c.value as { meta: SnapshotMeta }).meta);
        c.continue();
      };
    });
    return out;
  }
  async clear() {
    const tx = this.db.transaction(['main', 'snapshots'], 'readwrite');
    tx.objectStore('main').clear();
    tx.objectStore('snapshots').clear();
    await done(tx);
  }
  async replace(main: MainSave | undefined, snaps: { meta: SnapshotMeta; state: unknown }[]) {
    const tx = this.db.transaction(['main', 'snapshots'], 'readwrite');
    const m = tx.objectStore('main'), s = tx.objectStore('snapshots');
    m.clear(); s.clear();
    if (main) m.put(main, MAIN_KEY);
    for (const r of snaps) s.put({ id: r.meta.id, meta: r.meta, state: r.state });
    await done(tx);
  }
}

function openIdb(timeoutMs = 4000): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (db: IDBDatabase | null) => { if (!settled) { settled = true; resolve(db); } else db?.close(); };
    try {
      const idb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
      if (!idb) return finish(null);
      const r = idb.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('main')) db.createObjectStore('main');
        if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots', { keyPath: 'id' });
      };
      r.onsuccess = () => finish(r.result);
      r.onerror = () => finish(null);
      r.onblocked = () => finish(null);
      setTimeout(() => finish(null), timeoutMs);
    } catch {
      finish(null);
    }
  });
}

function isMeta(m: unknown): m is SnapshotMeta {
  const o = m as SnapshotMeta;
  return !!o && typeof o === 'object' && typeof o.id === 'string' && typeof o.branchId === 'string' && typeof o.time === 'number';
}

/** Проверява съдържанието на файл със запис. Хвърля Error с българско съобщение. */
export function parseSaveExport(data: unknown): SaveExport {
  const o = data as Partial<SaveExport> | null;
  if (!o || typeof o !== 'object') throw new Error('Файлът не е запис от „Балкански легенди“.');
  if (o.kind !== 'balkanski-legendi-save') throw new Error('Файлът не е запис от „Балкански легенди“.');
  if (o.version !== 1) throw new Error('Записът е от друга версия на играта и не може да се зареди.');
  const main = o.main ?? null;
  if (main !== null && (typeof main !== 'object' || (main as MainSave).version !== 1)) throw new Error('Основният запис във файла е повреден.');
  if (!Array.isArray(o.snapshots)) throw new Error('Записите на света във файла са повредени.');
  for (const s of o.snapshots) if (!s || !isMeta((s as { meta: unknown }).meta)) throw new Error('Записите на света във файла са повредени.');
  return { kind: 'balkanski-legendi-save', version: 1, exportedAt: Number(o.exportedAt) || 0, main, snapshots: o.snapshots };
}

async function blobText(b: Blob): Promise<string> {
  if (typeof b.text === 'function') return b.text();
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsText(b);
  });
}

export class SaveManager implements SnapshotStore {
  /** true, ако записите се пазят само в паметта (IndexedDB липсва/блокиран) — ще се загубят при затваряне. */
  readonly memoryOnly: boolean;

  private constructor(private backend: Backend, memoryOnly: boolean) { this.memoryOnly = memoryOnly; }

  static async open(): Promise<SaveManager> {
    const db = await openIdb();
    if (!db) return new SaveManager(new MemoryBackend(), true);
    return new SaveManager(new IdbBackend(db), false);
  }

  /** Само в паметта (за проби). */
  static inMemory(): SaveManager { return new SaveManager(new MemoryBackend(), true); }

  async hasSave(): Promise<boolean> {
    try { return !!(await this.backend.getMain()); } catch { return false; }
  }
  async loadMain(): Promise<MainSave | undefined> {
    try { return await this.backend.getMain(); } catch { return undefined; }
  }
  async saveMain(data: MainSave): Promise<void> { await this.backend.setMain(data); }

  async put(meta: SnapshotMeta, state: unknown): Promise<void> { await this.backend.putSnap({ meta, state }); }
  async get(id: string) { return this.backend.getSnap(id); }
  async delete(id: string): Promise<void> { await this.backend.delSnap(id); }
  async list(): Promise<SnapshotMeta[]> {
    const all = await this.backend.allMetas();
    return all.sort((a, b) => a.time - b.time || a.realTime - b.realTime);
  }

  async exportData(): Promise<SaveExport> {
    const snapshots = (await this.backend.allSnaps()).sort((a, b) => a.meta.time - b.meta.time);
    return { kind: 'balkanski-legendi-save', version: 1, exportedAt: Date.now(), main: (await this.backend.getMain()) ?? null, snapshots };
  }

  async exportBlob(): Promise<Blob> {
    return new Blob([JSON.stringify(await this.exportData())], { type: 'application/json' });
  }

  async downloadExport(): Promise<void> {
    const blob = await this.exportBlob();
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const name = `balkanski-legendi-zapis-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}.json`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async importFile(file: File | Blob): Promise<void> {
    let data: unknown;
    try {
      data = JSON.parse(await blobText(file));
    } catch {
      throw new Error('Файлът не може да се прочете — не е запис от „Балкански легенди“.');
    }
    const ex = parseSaveExport(data);
    await this.backend.replace(ex.main ?? undefined, ex.snapshots.map((s) => ({ meta: s.meta, state: s.state })));
  }

  async wipe(): Promise<void> { await this.backend.clear(); }
}
