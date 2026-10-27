import type { ReactNode } from "react";

/** Points are in a 100x120 box. Screen-right = player's right hand (mirror view, like the webcam). */
export type Pt = [number, number];
export interface Pose {
  /** Hands (required); elbows optional (default: slightly bent midpoint). */
  handL: Pt;
  handR: Pt;
  elbowL?: Pt;
  elbowR?: Pt;
  /** Feet / knees. */
  footL?: Pt;
  footR?: Pt;
  kneeL?: Pt;
  kneeR?: Pt;
  /** Torso lean (px offset of the head, + = to screen-right) and crouch (0..1). */
  lean?: number;
  crouch?: number;
  /** Motion hint drawn on top. */
  arrow?: string;
}

const SHOULDER_L: Pt = [41, 36];
const SHOULDER_R: Pt = [59, 36];

function mid(a: Pt, b: Pt, bend = 4): Pt {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + bend];
}

export function Pictogram({ pose, label, color = "var(--brand)" }: { pose: Pose; label: string; color?: string }) {
  const lean = pose.lean ?? 0;
  const crouch = (pose.crouch ?? 0) * 14;
  const head: Pt = [50 + lean, 20 + crouch];
  const neck: Pt = [50 + lean * 0.6, 30 + crouch];
  const sL: Pt = [SHOULDER_L[0] + lean * 0.6, SHOULDER_L[1] + crouch];
  const sR: Pt = [SHOULDER_R[0] + lean * 0.6, SHOULDER_R[1] + crouch];
  const hip: Pt = [50, 70 + crouch * 0.6];
  const footL = pose.footL ?? [42, 112];
  const footR = pose.footR ?? [58, 112];
  const kneeL = pose.kneeL ?? mid(hip, footL, crouch ? -2 : 0);
  const kneeR = pose.kneeR ?? mid(hip, footR, crouch ? -2 : 0);
  const eL = pose.elbowL ?? mid(sL, pose.handL);
  const eR = pose.elbowR ?? mid(sR, pose.handR);
  const line = (pts: Pt[]) => pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const parts: ReactNode[] = [
    <path key="torso" d={line([neck, hip])} />,
    <path key="armL" d={line([sL, eL, pose.handL])} />,
    <path key="armR" d={line([sR, eR, pose.handR])} />,
    <path key="legL" d={line([hip, kneeL, footL])} />,
    <path key="legR" d={line([hip, kneeR, footR])} />,
  ];
  return (
    <svg viewBox="0 0 100 120" role="img" aria-label={label} className="size-full">
      <defs>
        <marker id="pg-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
          <path d="M1 1l8 4-8 4z" fill="var(--hot)" />
        </marker>
      </defs>
      <g fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" className="text-fg">
        {parts}
        <circle cx={head[0]} cy={head[1]} r="9" fill="currentColor" stroke="none" />
      </g>
      <circle cx={pose.handL[0]} cy={pose.handL[1]} r="4.5" fill={color} />
      <circle cx={pose.handR[0]} cy={pose.handR[1]} r="4.5" fill={color} />
      {pose.arrow && (
        <path d={pose.arrow} fill="none" stroke="var(--hot)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" markerEnd="url(#pg-arrow)" />
      )}
    </svg>
  );
}
