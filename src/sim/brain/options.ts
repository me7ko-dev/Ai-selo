// ВРЕМЕННО (агентът „мозък“ ще го направи истински): 3-те готови отговора на играча в разговор.
import type { DialogueOption } from '../types';
import type { Partner, Persona } from './Brain';

export interface OptionsRequest { speaker: Persona; partner: Partner; turn: number; lastOptionId?: string; seed: number }

export function dialogueOptions(req: OptionsRequest): DialogueOption[] {
  return [
    { id: 'news', text: 'Какво ново в селото?' },
    { id: 'self', text: 'Разкажи ми за себе си.' },
    { id: 'help', text: 'Мога ли да помогна с нещо?' },
  ];
}
