import './office-picker.css';
import type { OfficeId, OfficePreset } from './office-model.ts';
import { paint } from './canvas.ts';
import { Pixels } from './pixels.ts';

export type OfficeStage = 'office' | 'character' | 'room';

export interface OfficePickerActions {
  select: (id: OfficeId) => void;
  design: () => void;
  enter: () => void;
}
type FocusTarget = { kind: 'office'; id: OfficeId } | { kind: 'action'; id: 'design' | 'enter' };

/** Auswahl und erste Raumprobe für die drei lokalen Office-Entwürfe. */
export class OfficePicker {
  private selected!: OfficeId;

  constructor(
    private readonly parent: HTMLElement,
    private readonly presets: OfficePreset[],
    private readonly actions: OfficePickerActions,
  ) {}

  render(selected: OfficeId, preview: (office: OfficePreset) => Pixels, stage: OfficeStage): void {
    const focusTarget = this.focusTarget();
    this.selected = selected;
    const rendered = this.presets.map((office) => ({
      office,
      pixels: preview(office),
    }));
    this.parent.innerHTML = `<section class="office-picker" aria-labelledby="office-picker-title">
      <div class="office-picker__heading">
        <div>
          <p class="office-picker__eyebrow">DEIN ORT</p>
          <h2 id="office-picker-title">Ein Raum für gute Arbeit.</h2>
          <p class="office-picker__intro">Drei Grundrisse, drei Atmosphären. Wähle den Ort, der zu eurem Team passt.</p>
        </div>
        <div class="office-picker__actions" role="group" aria-label="Nächster Schritt">
          <button type="button" class="office-picker__button office-picker__button--secondary" data-office-action="design">Figur gestalten</button>
          <button type="button" class="office-picker__button office-picker__button--primary" data-office-action="enter">Büro betreten <span aria-hidden="true">→</span></button>
        </div>
      </div>
      <div class="office-picker__steps" aria-label="Arbeitsablauf">
        ${this.step('office', '01', 'Büro wählen', stage)}
        <span aria-hidden="true">—</span>
        ${this.step('character', '02', 'Figur gestalten', stage)}
        <span aria-hidden="true">—</span>
        ${this.step('room', '03', 'Raum betreten', stage)}
      </div>
      <div class="office-picker__cards" role="radiogroup" aria-label="Büro auswählen">
        ${rendered.map(({ office }) => this.card(office)).join('')}
      </div>
    </section>`;

    for (const { office, pixels } of rendered)
      paint(this.parent.querySelector<HTMLCanvasElement>(`[data-office-id="${office.id}"] canvas`)!, pixels);

    const cards = [...this.parent.querySelectorAll<HTMLButtonElement>('[data-office-id]')];
    if (!cards.some((card) => card.tabIndex === 0) && cards[0]) cards[0].tabIndex = 0;
    for (const card of cards) {
      card.onclick = () => this.choose(card.dataset.officeId as OfficeId);
      card.onkeydown = (event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const index = cards.indexOf(card);
        const delta = event.key === 'ArrowRight' ? 1 : -1;
        const next = cards[(index + delta + cards.length) % cards.length];
        this.choose(next.dataset.officeId as OfficeId);
      };
    }
    this.parent.querySelector<HTMLButtonElement>('[data-office-action="design"]')!.onclick = () =>
      this.actions.design();
    this.parent.querySelector<HTMLButtonElement>('[data-office-action="enter"]')!.onclick = () => this.actions.enter();
    this.restoreFocus(focusTarget);
  }

  private step(id: OfficeStage, number: string, label: string, stage: OfficeStage): string {
    const active = id === stage;
    return `<span class="office-picker__step" data-stage="${id}" aria-current="${active ? 'step' : 'false'}"><b>${number}</b>${label}</span>`;
  }

  private card(office: OfficePreset): string {
    const active = office.id === this.selected;
    return `<button type="button" class="office-picker__card" data-office-id="${office.id}" role="radio" aria-checked="${active}" tabindex="${active ? '0' : '-1'}" aria-label="${office.name}, ${office.capacity} Arbeitsplätze"${active ? ' data-active="true"' : ''}>
      <span class="office-picker__image"><canvas aria-hidden="true"></canvas></span>
      <span class="office-picker__card-copy"><strong>${office.name}</strong><span class="office-picker__capacity">${office.capacity} Arbeitsplätze</span><span class="office-picker__subtitle">${office.subtitle}</span></span>
      <span class="office-picker__check" aria-hidden="true">✓</span>
    </button>`;
  }

  private choose(id: OfficeId): void {
    if (!this.presets.some((office) => office.id === id)) return;
    this.selected = id;
    for (const card of this.parent.querySelectorAll<HTMLButtonElement>('[data-office-id]')) {
      const active = card.dataset.officeId === id;
      card.setAttribute('aria-checked', String(active));
      card.tabIndex = active ? 0 : -1;
      if (active) card.dataset.active = 'true';
      else delete card.dataset.active;
    }
    this.actions.select(id);
    this.parent.querySelector<HTMLButtonElement>(`[data-office-id="${id}"]`)?.focus({ preventScroll: true });
  }

  private focusTarget(): FocusTarget | undefined {
    if (!this.parent.contains(document.activeElement)) return undefined;
    const active = document.activeElement as HTMLElement;
    const office = active.dataset.officeId as OfficeId | undefined;
    if (office) return { kind: 'office', id: office };
    const action = active.dataset.officeAction;
    if (action === 'design' || action === 'enter') return { kind: 'action', id: action };
    return undefined;
  }

  private restoreFocus(target: FocusTarget | undefined): void {
    if (!target) return;
    const selector =
      target.kind === 'office' ? `[data-office-id="${target.id}"]` : `[data-office-action="${target.id}"]`;
    this.parent.querySelector<HTMLButtonElement>(selector)?.focus({ preventScroll: true });
  }
}
