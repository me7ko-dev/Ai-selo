// Малък типизиран излъчвател на събития.
export class Emitter<E extends Record<string, unknown>> {
  private map = new Map<keyof E, Set<(p: any) => void>>();
  on<K extends keyof E>(type: K, fn: (payload: E[K]) => void): () => void {
    let s = this.map.get(type); if (!s) this.map.set(type, (s = new Set()));
    s.add(fn); return () => s!.delete(fn);
  }
  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const s = this.map.get(type); if (!s) return;
    for (const fn of [...s]) { try { fn(payload); } catch (e) { console.error(e); } }
  }
  clear(): void { this.map.clear(); }
}
