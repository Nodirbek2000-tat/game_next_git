import type { Env } from "./env";

export type CameraProblem = "denied" | "nocam" | "busy" | "noapi" | "viewer" | "inapp" | "insecure" | "unknown";

export interface Guide {
  title: string;
  steps: string[];
}

/** Device specific, step by step help (Uzbek, Latin). */
export function permissionGuide(kind: CameraProblem, env: Env): Guide {
  switch (kind) {
    case "viewer":
      return {
        title: "Fayl «Yuklanmalar»dan ochilgan — bu oynada kamera ishlamaydi",
        steps: [
          "Android va iPhone bunday ochilgan faylga kamera ruxsatini bermaydi.",
          "Saytni Chrome yoki Safari’da https manzil orqali oching.",
          "Kompyuterda esa saytni to‘g‘ridan-to‘g‘ri brauzerda ochsangiz bo‘ladi.",
        ],
      };
    case "inapp":
      return {
        title: "Sahifa Telegram yoki Instagram ichida ochilgan",
        steps: ["Yuqoridagi «⋮» yoki «…» tugmasini bosing → «Brauzerda ochish».", "Ochilgan brauzerda kameraga ruxsat bering."],
      };
    case "busy":
      return {
        title: "Kamera boshqa dasturda band",
        steps: ["Zoom, Telegram qo‘ng‘irog‘i, Meet kabi kamerani ishlatayotgan dasturni yoping.", "«Qayta urinish» tugmasini bosing."],
      };
    case "nocam":
      return { title: "Kamera topilmadi", steps: ["Kamera ulanganini tekshiring.", "Boshqa kamerani /sozlamalar sahifasidan tanlab ko‘ring.", "«Qayta urinish» tugmasini bosing."] };
    case "noapi":
    case "insecure":
      return {
        title: "Bu oynada kamera ishlamaydi",
        steps: ["Kamera faqat xavfsiz (https) manzilda ishlaydi.", "Saytni Chrome yoki Safari’da https orqali oching."],
      };
    case "denied": {
      const b = env.browser;
      if (env.ios)
        return {
          title: `Kameraga ruxsat yopiq (${b})`,
          steps: [
            "Manzil satridagi «aA» → «Sayt sozlamalari» → Kamera → Ruxsat berish.",
            "Yoki: Sozlamalar → Safari → Kamera → Ruxsat berish.",
            "Sahifani yangilang.",
          ],
        };
      if (env.android)
        return {
          title: `Kameraga ruxsat yopiq (${b})`,
          steps: [
            "Manzil satridagi 🔒 belgisi → Ruxsatlar → Kamera → Ruxsat berish.",
            `Yoki: telefon Sozlamalari → Ilovalar → ${b} → Ruxsatlar → Kamera.`,
            "Sahifani yangilang.",
          ],
        };
      if (env.mac)
        return {
          title: `Kameraga ruxsat yopiq (${b})`,
          steps: [
            "Manzil satri chap tomonidagi belgi → Kamera → Ruxsat berish.",
            `Tizim sozlamalari → Maxfiylik va xavfsizlik → Kamera → «${b}» yoqilgan bo‘lsin.`,
            "Sahifani yangilang.",
          ],
        };
      return {
        title: `Kameraga ruxsat yopiq (${b})`,
        steps: [
          "Manzil satri chap tomonidagi belgi (🔒) → Kamera → Ruxsat berish.",
          ...(env.win ? ["Windows: Sozlamalar → Maxfiylik va xavfsizlik → Kamera → ilovalarga ruxsat yoqilgan bo‘lsin."] : []),
          "Sahifani yangilang (F5).",
        ],
      };
    }
    default:
      return { title: "Kamerani yoqib bo‘lmadi", steps: ["Sahifani yangilab, qayta urinib ko‘ring.", "Muammo davom etsa, boshqa brauzerda sinab ko‘ring."] };
  }
}

/** Short status line shown above the guide. */
export function problemStatus(kind: CameraProblem): string {
  switch (kind) {
    case "denied":
      return "Kameraga ruxsat berilmadi.";
    case "nocam":
      return "Kamera topilmadi.";
    case "busy":
      return "Kamera band.";
    case "noapi":
    case "insecure":
    case "viewer":
    case "inapp":
      return "Bu oynada kamera ishlamaydi.";
    default:
      return "Kamerani yoqib bo‘lmadi.";
  }
}
