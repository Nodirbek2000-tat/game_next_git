import { DEFAULT_CONFIG } from "../config";
import { buildPeople, colorHist, computeFit, type SmallFrame } from "../tracking/people";
import type { Person } from "../types";
import { makeSkeleton, makeSmallFrame, type SkeletonOpts } from "./skeleton";

export const FIT = computeFit(1280, 720, 1280, 720);
export const CFG = DEFAULT_CONFIG;

export type Spec = SkeletonOpts & { rgb?: [number, number, number] };

export function mkPeople(specs: Spec[]): Person[] {
  return buildPeople({ landmarks: specs.map((s) => makeSkeleton(s)) }, FIT);
}

export function mkSmall(specs: Spec[]): SmallFrame {
  return { data: makeSmallFrame(specs.map((s) => ({ cx: s.cx ?? 0.5, top: s.top ?? 0.12, h: s.h ?? 0.8, rgb: s.rgb ?? [128, 128, 128] }))) };
}

/** Hist provider reading colours from a synthetic frame. */
export const histFrom = (small: SmallFrame) => (p: Person) => colorHist(p.norm, small);
