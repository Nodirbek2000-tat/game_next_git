import { CAR_IDS, CARS, MODES, type CarId, type ModeId } from "../config";

export type PickerStep = "mode" | "car" | "color" | "body";
export const PICKER_STEPS: PickerStep[] = ["mode", "car", "color", "body"];

export interface Choice {
  mode: ModeId;
  car: CarId;
  /** index into CARS[car].colors */
  color: number;
  seated: boolean;
}

export const STEP_TITLE: Record<PickerStep, string> = {
  mode: "Rejimni tanlang",
  car: "Mashinani tanlang",
  color: "Rangni tanlang",
  body: "Boshqaruv usuli",
};

/**
 * The pre-game menu (mode, car, colour, standing / seated). Body controls: left knee = next option,
 * right knee held for a moment = confirm. Keyboard: Arrow/Tab = next, Enter = confirm, 1-4 = mode.
 */
export class Picker {
  step = 0;
  done = false;
  readonly choice: Choice;
  private lPrev = false;
  private rHold = 0;
  private rArmed = true;

  constructor(initial: Partial<Choice> = {}) {
    this.choice = { mode: "erkin", car: "sedan", color: 0, seated: false, ...initial };
  }

  get stepId(): PickerStep {
    return PICKER_STEPS[Math.min(this.step, PICKER_STEPS.length - 1)];
  }

  /** Options of the current step as labels, and the selected index. */
  options(): { labels: string[]; subs: string[]; selected: number } {
    const c = this.choice;
    switch (this.stepId) {
      case "mode":
        return { labels: MODES.map((m) => m.name), subs: MODES.map((m) => m.sub), selected: MODES.findIndex((m) => m.id === c.mode) };
      case "car":
        return { labels: CAR_IDS.map((id) => CARS[id].name), subs: CAR_IDS.map((id) => (id === "sport" ? "Tez, drift qiladi" : id === "krossover" ? "Barqaror, og‘ir" : "Muvozanatli")), selected: CAR_IDS.indexOf(c.car) };
      case "color":
        return { labels: CARS[c.car].colors, subs: CARS[c.car].colors.map(() => ""), selected: c.color };
      case "body":
        return { labels: ["Tik turib", "O‘tirib"], subs: ["Oyoq ko‘rinadi, tizza ko‘tarish", "Stulda o‘tirib tizza ko‘tarish"], selected: c.seated ? 1 : 0 };
    }
  }

  cycle(): void {
    const c = this.choice;
    switch (this.stepId) {
      case "mode": {
        const i = MODES.findIndex((m) => m.id === c.mode);
        c.mode = MODES[(i + 1) % MODES.length].id;
        break;
      }
      case "car":
        c.car = CAR_IDS[(CAR_IDS.indexOf(c.car) + 1) % CAR_IDS.length];
        c.color = 0;
        break;
      case "color":
        c.color = (c.color + 1) % CARS[c.car].colors.length;
        break;
      case "body":
        c.seated = !c.seated;
        break;
    }
  }

  selectMode(i: number): void {
    if (this.stepId === "mode" && MODES[i]) this.choice.mode = MODES[i].id;
  }

  confirm(): void {
    if (this.done) return;
    this.step++;
    if (this.step >= PICKER_STEPS.length) this.done = true;
  }

  /** Feed the pedals (0..1) and the keys of one frame. */
  update(dt: number, gas: number, brake: number, keys: ReadonlySet<string>, keyEdges: { next: boolean; confirm: boolean }): void {
    if (this.done) return;
    const l = brake > 0.55;
    if (l && !this.lPrev) this.cycle();
    this.lPrev = l;
    if (gas > 0.55 && this.rArmed) {
      this.rHold += dt;
      if (this.rHold >= 0.6) {
        this.rHold = 0;
        this.rArmed = false;
        this.confirm();
      }
    } else {
      this.rHold = 0;
      if (gas < 0.25) this.rArmed = true;
    }
    if (keyEdges.next) this.cycle();
    if (keyEdges.confirm) this.confirm();
    for (let i = 0; i < MODES.length; i++) if (keys.has(String(i + 1))) this.selectMode(i);
  }
}
