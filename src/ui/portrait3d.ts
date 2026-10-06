// Истинските портрети (снимки на 3D хората, виж src/models/gltf/portrait.ts) — ако ги има, portrait() ги слага
// в рамката-медальон вместо рисуваните. На „Ниско“ (без реалистичните хора) остават рисуваните.
const images = new Map<string, string>();
const listeners = new Set<() => void>();

/** id ('hero', 'gena'…) → data URL. */
export function setPortraitImages(map: Map<string, string>): void {
  for (const [k, v] of map) images.set(k, v);
  for (const f of listeners) f();
}

export function portraitImage(id: string): string | undefined {
  return images.get(id === 'player' ? 'hero' : id);
}

/** Известие, когато портретите се сменят (напр. HUD да се прерисува). Връща функция за отписване. */
export function onPortraitsChanged(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}
