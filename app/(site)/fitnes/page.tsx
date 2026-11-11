import type { Metadata } from "next";
import { FitnessHome } from "@/components/fitness/fitness-home";

export const metadata: Metadata = {
  title: "Fitnes",
  description: "Kunlik mashg‘ulot: kamera takrorlarni sanaydi, to‘g‘ri bajarilishini tekshiradi va kaloriyani hisoblaydi.",
  alternates: { canonical: "/fitnes" },
};

export default function FitnesPage() {
  return <FitnessHome />;
}
