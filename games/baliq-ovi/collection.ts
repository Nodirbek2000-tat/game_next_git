// Fish encyclopedia / collection. Stored in localStorage for now (the backend arrives later: replace `load/save`).

import { SPECIES, type SpeciesDef } from "./species";

export const COLLECTION_KEY = "harakat.baliq-ovi.collection";

export interface CollectionEntry {
  count: number;
  /** record weight, kg */
  record: number;
  /** first time caught (ms since epoch) */
  first: number;
}
export type Collection = Record<string, CollectionEntry>;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function store(s?: StorageLike): StorageLike | null {
  if (s) return s;
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadCollection(s?: StorageLike): Collection {
  try {
    const raw = store(s)?.getItem(COLLECTION_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw) as Collection;
    const out: Collection = {};
    for (const sp of SPECIES) {
      const e = v[sp.id];
      if (e && typeof e.count === "number" && typeof e.record === "number") out[sp.id] = { count: e.count, record: e.record, first: e.first ?? 0 };
    }
    return out;
  } catch {
    return {};
  }
}

export function saveCollection(c: Collection, s?: StorageLike): void {
  try {
    store(s)?.setItem(COLLECTION_KEY, JSON.stringify(c));
  } catch {
    /* private mode / quota: the game still works */
  }
}

export interface CatchRecord {
  isNew: boolean;
  isRecord: boolean;
}

/** Adds one catch. Mutates `c`. */
export function recordCatch(c: Collection, sp: SpeciesDef, weight: number, now = Date.now()): CatchRecord {
  const e = c[sp.id];
  if (!e) {
    c[sp.id] = { count: 1, record: weight, first: now };
    return { isNew: true, isRecord: true };
  }
  e.count++;
  const isRecord = weight > e.record + 1e-9;
  if (isRecord) e.record = weight;
  return { isNew: false, isRecord };
}

export function collectionSize(c: Collection): number {
  return SPECIES.filter((s) => c[s.id]).length;
}
