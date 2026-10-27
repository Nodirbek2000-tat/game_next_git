import type { Pose } from "@/components/site/pictogram";

export interface GestureInfo {
  title: string;
  text: string;
  pose: Pose;
}

// Illustrative pictograms (not tracking data). Screen-right = player's right hand, as in the mirrored webcam view.
export const GESTURES: Record<string, GestureInfo[]> = {
  "baliq-ovi": [
    { title: "Qarmoqni tashlash", text: "O‘ng qo‘lni yelkadan yuqori ko‘tarib oldinga silting.", pose: { handL: [38, 62], handR: [76, 14], elbowR: [70, 32], arrow: "M80 30q8-8 6-20" } },
    { title: "Ilintirish", text: "Poplavok cho‘kkanda qo‘lni keskin tepaga torting.", pose: { handL: [38, 62], handR: [66, 8], elbowR: [66, 24], arrow: "M80 54V16" } },
    { title: "G‘altak", text: "Chap qo‘l bilan havoda doira chizing.", pose: { handL: [20, 56], handR: [62, 62], elbowL: [28, 46], arrow: "M10 46a12 12 0 1 1 6 20" } },
    { title: "Sachok (juftlikda)", text: "Ikki qo‘lni pastga tushirib, tepaga ko‘taring.", pose: { handL: [28, 30], handR: [72, 30], elbowL: [30, 56], elbowR: [70, 56], arrow: "M50 100V60" } },
  ],
  mashina: [
    { title: "Gaz", text: "O‘ng tizzani ko‘taring — qanchalik baland, shuncha tez.", pose: { handL: [36, 60], handR: [64, 60], kneeR: [70, 64], footR: [66, 90], arrow: "M84 90V64" } },
    { title: "Tormoz", text: "Chap tizzani ko‘taring.", pose: { handL: [36, 60], handR: [64, 60], kneeL: [30, 64], footL: [34, 90], arrow: "M16 90V64" } },
    { title: "Rul", text: "Ikki qo‘l bilan xayoliy rulni buring.", pose: { handL: [30, 52], handR: [70, 52], elbowL: [34, 48], elbowR: [66, 48], arrow: "M22 36a30 30 0 0 1 56 0" } },
  ],
  "meva-ninja": [
    { title: "Kesish", text: "Qo‘lni tez silkitib mevani kesing.", pose: { handL: [38, 62], handR: [86, 20], elbowR: [72, 44], arrow: "M92 8L60 40" } },
    { title: "Ikki qo‘llab", text: "Ikki qo‘l ham qilich — kombo to‘plang.", pose: { handL: [14, 24], handR: [86, 24], elbowL: [24, 44], elbowR: [76, 44], arrow: "M6 12l16 16M94 12L78 28" } },
  ],
  boks: [
    { title: "Chap zarba", text: "Qizil lapaga chap qo‘l bilan uring.", pose: { handL: [10, 38], handR: [58, 52], elbowL: [28, 44], arrow: "M26 30L6 30" } },
    { title: "O‘ng zarba", text: "Ko‘k lapaga o‘ng qo‘l bilan uring.", pose: { handL: [42, 52], handR: [90, 38], elbowR: [72, 44], arrow: "M74 30h20" } },
    { title: "Blok", text: "Ikki qo‘lni yuzga qo‘ying.", pose: { handL: [44, 22], handR: [56, 22], elbowL: [38, 40], elbowR: [62, 40] } },
    { title: "Qochish", text: "Raqib zarbasida boshni egib qoching.", pose: { handL: [40, 56], handR: [60, 56], lean: -14, arrow: "M70 14q-14 0-20 10" } },
  ],
  fitnes: [
    { title: "Qo‘llar tepada", text: "Qo‘llarni to‘liq yuqoriga cho‘zing.", pose: { handL: [30, 4], handR: [70, 4], elbowL: [34, 20], elbowR: [66, 20]} },
    { title: "Cho‘kish", text: "Tizzalarni bukib pastga cho‘ming.", pose: { handL: [28, 44], handR: [72, 44], crouch: 1, kneeL: [30, 84], kneeR: [70, 84], arrow: "M90 36v30" } },
    { title: "Yon tomonga egilish", text: "Qo‘llar tepada, tanani yonga eging.", pose: { handL: [38, 6], handR: [74, 10], lean: 12, arrow: "M30 16q-10 10-8 26" } },
  ],
  meteor: [
    { title: "Chapga qochish", text: "Tanani chap tomonga olib qoching.", pose: { handL: [30, 62], handR: [56, 62], lean: -14, arrow: "M60 100H20" } },
    { title: "O‘ngga qochish", text: "Tanani o‘ng tomonga olib qoching.", pose: { handL: [44, 62], handR: [70, 62], lean: 14, arrow: "M40 100h40" } },
    { title: "Egilish", text: "Past uchayotgan meteordan egilib qoching.", pose: { handL: [32, 56], handR: [68, 56], crouch: 1, arrow: "M88 30v30" } },
    { title: "Tanga yig‘ish", text: "Qo‘l bilan tangaga uzating.", pose: { handL: [38, 62], handR: [84, 28], elbowR: [70, 40] } },
  ],
  devor: [
    { title: "Yulduz poza", text: "Qo‘l va oyoqlarni keng yoying.", pose: { handL: [8, 14], handR: [92, 14], footL: [30, 112], footR: [70, 112], kneeL: [38, 92], kneeR: [62, 92] } },
    { title: "Qo‘llar tepada", text: "Ikki qo‘lni boshdan yuqori ko‘taring.", pose: { handL: [38, 2], handR: [62, 2], elbowL: [38, 18], elbowR: [62, 18] } },
    { title: "Yon poza", text: "Devordagi shaklga qarab yon tomonga egiling.", pose: { handL: [8, 36], handR: [86, 6], lean: -8, elbowL: [24, 40] } },
  ],
};
