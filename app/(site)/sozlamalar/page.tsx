import type { Metadata } from "next";
import SettingsForm from "./SettingsForm";

export const metadata: Metadata = {
  title: "Sozlamalar",
  description: "Kamera, ovoz, grafika sifati, chapaqay va bolalar rejimi, sezgirlik.",
};

export default function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-8 sm:px-8 sm:py-14">
      <h1 className="font-display text-[clamp(2.2rem,6vw,3.5rem)] font-extrabold leading-tight tracking-tight">Sozlamalar</h1>
      <SettingsForm />
    </div>
  );
}
