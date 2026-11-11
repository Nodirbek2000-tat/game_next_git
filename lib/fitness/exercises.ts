// Fitnes: the exercise catalogue. Shared by the site (/fitnes) and the game (games/fitnes). Uzbek (Latin) texts only.
//
// kind "reps": the camera counts repetitions; "hold": the camera times how long the pose is held correctly.
// met: the MET value of the exercise at a moderate effort (Compendium of Physical Activities): calories = MET x kg x hours.

export type ExerciseId = "squat" | "lunge" | "jack" | "knees" | "boks" | "tepaga" | "tirsak" | "yonqadam" | "yonoyoq" | "plank" | "daraxt" | "jangchi" | "egilish";
export type ExerciseKind = "reps" | "hold";
export type ExerciseGroup = "kuch" | "kardio" | "yoga";

export interface Exercise {
  id: ExerciseId;
  title: string;
  icon: string;
  group: ExerciseGroup;
  kind: ExerciseKind;
  met: number;
  /** one line: how to do it */
  how: string;
  /** default target in a free session: reps or seconds */
  target: number;
  /** the camera needs to see the feet (stand further back) */
  fullBody: boolean;
}

export const EXERCISES: Record<ExerciseId, Exercise> = {
  squat: { id: "squat", title: "O‘tirib-turish", icon: "🏋️", group: "kuch", kind: "reps", met: 5, how: "Oyoqlar yelka kengligida, son polga parallel bo‘lguncha o‘tiring.", target: 15, fullBody: true },
  lunge: { id: "lunge", title: "Hamla", icon: "🤸", group: "kuch", kind: "reps", met: 4, how: "Bir oyoq bilan oldinga qadam, ikkala tizza 90° gacha bukiladi. Oyoqlar navbatma-navbat.", target: 12, fullBody: true },
  jack: { id: "jack", title: "Yulduzcha sakrash", icon: "⭐", group: "kardio", kind: "reps", met: 8, how: "Sakrab oyoqlarni keng oching, qo‘llar tepada; keyin yig‘iling.", target: 25, fullBody: true },
  knees: { id: "knees", title: "Tizza ko‘tarish", icon: "🏃", group: "kardio", kind: "reps", met: 8, how: "Joyida yuguring: tizza son balandligigacha ko‘tarilsin.", target: 30, fullBody: true },
  boks: { id: "boks", title: "Boks zarbasi", icon: "🥊", group: "kardio", kind: "reps", met: 7, how: "Mushtlar iyak oldida; navbatma-navbat yuz balandligida qarama-qarshi tomonga zarba bering.", target: 30, fullBody: false },
  tepaga: { id: "tepaga", title: "Qo‘lni tepaga cho‘zish", icon: "🙆", group: "kuch", kind: "reps", met: 4, how: "Mushtlar yelka oldida; ikki qo‘lni birga tepaga to‘liq ko‘taring va tushiring.", target: 15, fullBody: false },
  tirsak: { id: "tirsak", title: "Tizza–tirsak", icon: "🔄", group: "kardio", kind: "reps", met: 6, how: "Qo‘llar boshda; tizzani ko‘tarib qarama-qarshi tirsakka yaqinlashtiring, navbatma-navbat.", target: 20, fullBody: true },
  yonqadam: { id: "yonqadam", title: "Yon qadam", icon: "↔️", group: "kardio", kind: "reps", met: 6, how: "Sal o‘tirgan holda chapga va o‘ngga keng qadam tashlang.", target: 20, fullBody: true },
  yonoyoq: { id: "yonoyoq", title: "Oyoqni yonga ko‘tarish", icon: "🦵", group: "kuch", kind: "reps", met: 4, how: "Tik turing; oyoqni tekis holda yonga ko‘taring, navbatma-navbat.", target: 16, fullBody: true },
  plank: { id: "plank", title: "Taxta (plank)", icon: "🧱", group: "kuch", kind: "hold", met: 4, how: "Kameraga yon tomon bilan turing: yelka, bel va tovon bir chiziqda.", target: 30, fullBody: true },
  daraxt: { id: "daraxt", title: "Daraxt (yoga)", icon: "🌳", group: "yoga", kind: "hold", met: 2.5, how: "Bir oyoqda turing, ikkinchi tovon boshqa oyoq ichida, qo‘llar tepada.", target: 30, fullBody: true },
  jangchi: { id: "jangchi", title: "Jangchi (yoga)", icon: "🧘", group: "yoga", kind: "hold", met: 3, how: "Oyoqlar keng, oldingi tizza bukilgan, qo‘llar yon tomonga tekis cho‘zilgan.", target: 30, fullBody: true },
  egilish: { id: "egilish", title: "Yonga egilish", icon: "🌙", group: "yoga", kind: "reps", met: 2.5, how: "Qo‘llarni tepaga ko‘tarib, chapga va o‘ngga egiling.", target: 12, fullBody: false },
};

export const EXERCISE_LIST: Exercise[] = Object.values(EXERCISES);

export const GROUP_LABEL: Record<ExerciseGroup, string> = { kuch: "Kuch", kardio: "Kardio", yoga: "Yoga" };

export const isExerciseId = (s: string | null | undefined): s is ExerciseId => !!s && s in EXERCISES;

/** kcal burned: MET x weight (kg) x hours */
export function kcal(met: number, weightKg: number, seconds: number): number {
  return (met * weightKg * Math.max(0, seconds)) / 3600;
}

/** a rough time per repetition (s), for plans and estimates */
export const SEC_PER_REP: Record<ExerciseId, number> = { squat: 3, lunge: 3.5, jack: 1.2, knees: 0.7, boks: 0.6, tepaga: 2.5, tirsak: 1.5, yonqadam: 1.5, yonoyoq: 2, plank: 1, daraxt: 1, jangchi: 1, egilish: 3 };

/** seconds a step of `amount` reps / seconds takes */
export function stepSeconds(id: ExerciseId, amount: number): number {
  const ex = EXERCISES[id];
  return ex.kind === "hold" ? amount : amount * SEC_PER_REP[id];
}
