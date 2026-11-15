"use client";

import { useEffect } from "react";
import { useAccount } from "@/lib/account/store";

/** Footer: the phone number for installing the games in a kindergarten (set in the admin panel). */
export function FooterContact() {
  const { config, load } = useAccount();
  useEffect(() => {
    void load();
  }, [load]);
  const phone = config.bogchaPhone;
  if (!phone) return null;
  return (
    <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="inline-flex min-h-10 items-center gap-1.5 font-bold text-fg hover:text-brand" data-testid="footer-bogcha-phone">
      <span aria-hidden="true">🐰</span> Bog‘chalar uchun o‘rnatib berish: {phone}
    </a>
  );
}
