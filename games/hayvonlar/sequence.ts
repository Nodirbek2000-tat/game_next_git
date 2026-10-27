// Which animal comes next: a shuffle bag (all six before any repeats, never the same animal twice in a row).
// `?seq=quyon,pingvin` forces the first animals (tests / teachers), then the bag takes over.

import { ANIMAL_IDS, animalById, type AnimalId } from "./animals";

export function parseSeq(s: string | null | undefined): AnimalId[] {
  if (!s) return [];
  const out: AnimalId[] = [];
  for (const part of s.split(",")) {
    const a = animalById(part.trim().toLowerCase());
    if (a) out.push(a.id);
  }
  return out;
}

export class Deck {
  private bag: AnimalId[] = [];
  private forcedAt = 0;
  private last: AnimalId | "" = "";

  constructor(
    private rng: () => number = Math.random,
    private forced: readonly AnimalId[] = [],
  ) {}

  next(): AnimalId {
    let id: AnimalId;
    if (this.forcedAt < this.forced.length) {
      id = this.forced[this.forcedAt++];
    } else {
      if (this.bag.length === 0) this.refill();
      id = this.bag.pop() as AnimalId;
    }
    this.last = id;
    return id;
  }

  private refill(): void {
    const b = this.bag;
    for (const id of ANIMAL_IDS) b.push(id);
    for (let i = b.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      const t = b[i];
      b[i] = b[j];
      b[j] = t;
    }
    // the next one is taken from the end: it must not repeat the animal that was just shown
    const n = b.length;
    if (b[n - 1] === this.last) {
      const t = b[n - 1];
      b[n - 1] = b[0];
      b[0] = t;
    }
  }
}
