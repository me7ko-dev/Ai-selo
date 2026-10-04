// Малки помощници за DOM — без зависимости.

type Attrs = Record<string, string | number | boolean | null | undefined>;
type Child = Node | string | null | undefined | false;

/** Създава елемент: h('div.panel.hud', { title: 'x' }, child, 'текст'). Специални атрибути: html, text. */
export function h(sel: string, attrs?: Attrs | null, ...children: Child[]): HTMLElement {
  const [tagRaw, ...classes] = sel.split('.');
  const el = document.createElement(tagRaw || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'html') el.innerHTML = String(v);
    else if (k === 'text') el.textContent = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

/** HTML escaping за текст, който влиза в innerHTML. */
export function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

/** Слуша клавиатурата; връща функция за откачане. Когато се пише в поле, минава само Escape. */
export function onKeys(handler: (e: KeyboardEvent) => void): () => void {
  const fn = (e: KeyboardEvent) => {
    if (isTyping(e.target) && e.code !== 'Escape' && e.code !== 'Enter') return;
    handler(e);
  };
  window.addEventListener('keydown', fn);
  return () => window.removeEventListener('keydown', fn);
}

/** Спира клавишите в полето да стигат до играта (WASD и т.н.). Escape минава. */
export function isolateInput(el: HTMLElement): void {
  el.addEventListener('keydown', (e) => { if (e.code !== 'Escape') e.stopPropagation(); });
  el.addEventListener('keyup', (e) => e.stopPropagation());
}

export function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }

/** Задава текст само ако е различен (евтино при чести обновявания). */
export function setText(el: HTMLElement, text: string): void { if (el.textContent !== text) el.textContent = text; }

/** Задава стил само ако е различен. */
export function setStyle(el: HTMLElement, prop: string, value: string): void {
  if (el.style.getPropertyValue(prop) !== value) el.style.setProperty(prop, value);
}
