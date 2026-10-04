// Обща основа за модалните прозорци: отваряне/затваряне, клавиши само докато е отворен, Esc → onClose.
import { h, onKeys } from './dom';

export abstract class ModalView {
  readonly el: HTMLElement;
  isOpen = false;
  /** Вика се, когато прозорецът се затвори от потребителя (Esc, бутон ×, собственият клавиш). Прозорецът вече е скрит. */
  onClose: () => void = () => {};
  /** Клавиши (KeyboardEvent.code), които също затварят прозореца (освен Escape), напр. ['KeyM']. */
  protected closeKeys: string[] = [];
  private offKeys: (() => void) | null = null;

  constructor(protected root: HTMLElement, cls: string) {
    this.el = h(`div.modal-back.${cls}.hidden`);
    root.append(this.el);
  }

  protected openBase(): void {
    this.el.classList.remove('hidden');
    if (this.isOpen) return;
    this.isOpen = true;
    this.offKeys = onKeys((e) => {
      if (!this.isOpen) return;
      if (e.code === 'Escape' || this.closeKeys.includes(e.code)) {
        if (e.code !== 'Escape' && isTyping(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        this.dismiss();
        return;
      }
      this.onKey(e);
    });
  }

  /** Затваря от потребителя: скрива + onClose(). */
  dismiss(): void {
    if (!this.isOpen) return;
    this.hide();
    this.onClose();
  }

  /** Скрива без да вика onClose (за играта). */
  hide(): void {
    this.isOpen = false;
    this.el.classList.add('hidden');
    this.offKeys?.();
    this.offKeys = null;
  }

  close(): void { this.hide(); }

  /** Клавиши, докато е отворен (без Escape и closeKeys). */
  protected onKey(_e: KeyboardEvent): void {}
}

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
}

/** 4 ъглови шевици за панел (родителят трябва да е position:relative). */
export function cornersHtml(): string {
  return '<i class="orn-c tl"></i><i class="orn-c tr"></i><i class="orn-c bl"></i><i class="orn-c br"></i>';
}
