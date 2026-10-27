import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost";
type Size = "md" | "lg";

const base =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl font-bold transition-[transform,filter,background-color] duration-200 active:scale-[0.97] select-none whitespace-nowrap";
const variants: Record<Variant, string> = {
  primary: "glow-btn text-white hover:-translate-y-0.5",
  secondary: "glass text-fg hover:-translate-y-0.5 hover:bg-solid",
  ghost: "text-fg hover:bg-brand/10",
};
const sizes: Record<Size, string> = {
  md: "px-5 py-2.5 text-base",
  lg: "min-h-14 px-7 py-3.5 text-lg",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cn(base, variants[variant], sizes[size], className);
}

export function ButtonLink({
  variant,
  size,
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

export function Button({
  variant,
  size,
  className,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}
