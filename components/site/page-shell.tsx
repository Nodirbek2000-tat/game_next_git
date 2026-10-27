import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui/button";

export function PageHeader({ title, lead }: { title: string; lead?: string }) {
  return (
    <header className="mx-auto max-w-[72rem] px-5 pb-2 pt-8 text-center sm:px-8 sm:pt-14">
      <h1 className="font-display text-[clamp(2.2rem,6vw,4rem)] font-extrabold leading-tight tracking-tight">{title}</h1>
      {lead && <p className="mt-3 text-lg text-muted">{lead}</p>}
    </header>
  );
}

export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto max-w-[72rem] px-5 py-8 sm:px-8 ${className}`}>{children}</div>;
}

/** Honest "coming soon" placeholder: one icon, one line, one way out. */
export function ComingSoon({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <Container>
      <div className="rise mx-auto flex max-w-md flex-col items-center py-10 text-center">
        <div className="flex size-28 items-center justify-center rounded-[2rem] bg-brand/10 text-6xl" aria-hidden="true">
          {icon}
        </div>
        <h2 className="mt-6 font-display text-2xl font-bold">{title}</h2>
        {children && <div className="mt-2 text-lg text-muted">{children}</div>}
        <ButtonLink href="/" size="lg" className="mt-8">
          O‘ynash
        </ButtonLink>
      </div>
    </Container>
  );
}
