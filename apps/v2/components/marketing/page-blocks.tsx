import type { ButtonHTMLAttributes, ReactNode } from "react";
import Link from "next/link";

export function PageTitle({
  children,
  quiet = false,
}: {
  children: ReactNode;
  quiet?: boolean;
}) {
  return (
    <h1
      className={`${quiet ? "text-[30px] sm:text-[38px]" : "text-[44px] sm:text-[60px]"} font-semibold leading-[1.02] tracking-tight text-neutral-900 dark:text-neutral-50`}
    >
      {children}
    </h1>
  );
}

export function Lede({ children }: { children: ReactNode }) {
  return (
    <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-neutral-600 sm:text-[17px] dark:text-neutral-400">
      {children}
    </p>
  );
}

export function SplitSection({
  title,
  body,
  visual,
  reverse = false,
}: {
  title: string;
  body: string;
  visual: ReactNode;
  reverse?: boolean;
}) {
  return (
    <section className="mt-16 grid items-center gap-8 sm:grid-cols-2 sm:gap-12">
      <div className={reverse ? "sm:order-2 sm:text-right" : ""}>
        <h2 className="text-[24px] font-semibold leading-[1.1] tracking-tight sm:text-[28px]">
          {title}
        </h2>
        <p
          className={`mt-4 max-w-md text-[15px] leading-relaxed text-neutral-600 dark:text-neutral-400 ${reverse ? "sm:ml-auto" : ""}`}
        >
          {body}
        </p>
      </div>
      <div className={reverse ? "sm:order-1" : ""}>{visual}</div>
    </section>
  );
}

/* One pill for every call to action on the marketing pages, whether it
   navigates (CtaLink) or acts in place (CtaButton). */
function ctaClasses(primary: boolean, extra = ""): string {
  return `inline-flex h-10 w-fit cursor-pointer items-center gap-1.5 rounded-full px-5 text-sm font-medium transition active:scale-[0.97] disabled:pointer-events-none disabled:opacity-60 ${
    primary
      ? "bg-[#0c82f2] text-white hover:bg-[#0b76dc]"
      : "text-neutral-700 ring-1 ring-black/10 hover:bg-black/5 dark:text-neutral-200 dark:ring-white/12 dark:hover:bg-white/7"
  } ${extra}`;
}

export function CtaButton({
  primary = false,
  className = "",
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return (
    <button type={type} className={ctaClasses(primary, className)} {...rest} />
  );
}

export function CtaLink({
  href,
  primary = false,
  children,
}: {
  href: string;
  primary?: boolean;
  children: ReactNode;
}) {
  const classes = ctaClasses(primary);
  return href.startsWith("http") ? (
    <a href={href} target="_blank" rel="noreferrer" className={classes}>
      {children}
    </a>
  ) : (
    <Link href={href} className={classes}>
      {children}
    </Link>
  );
}
