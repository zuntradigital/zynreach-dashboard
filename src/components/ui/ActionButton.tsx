"use client";

import type { ComponentProps, ReactNode } from "react";
import { Link } from "@/i18n/navigation";

type Tone = "primary" | "danger" | "neutral" | "neutral-bordered";

const TONE_CLASS: Record<Tone, string> = {
  primary: "text-primary-600 hover:bg-primary-50",
  danger: "text-error hover:bg-error-bg",
  neutral: "text-neutral-600 hover:bg-neutral-100",
  "neutral-bordered": "border border-neutral-300 bg-surface text-neutral-700 hover:bg-neutral-50",
};

interface ActionButtonSharedProps {
  tone?: Tone;
  size?: "sm" | "xs";
  disabled?: boolean;
  title?: string;
  children: ReactNode;
}

interface ActionButtonAsButton extends ActionButtonSharedProps, Omit<ComponentProps<"button">, "className" | "children" | "disabled" | "title"> {
  href?: undefined;
}

interface ActionButtonAsLink extends ActionButtonSharedProps, Omit<ComponentProps<typeof Link>, "className" | "children"> {
  href: string;
}

type ActionButtonProps = ActionButtonAsButton | ActionButtonAsLink;

/**
 * The single text-style action control used for every "Edit"/"Delete"/
 * "Rollback"/etc. pair across Dashboard tables and detail pages. Renders
 * as either a <button> or a <Link> (an `href` makes it a link), but both
 * are forced into the exact same `inline-flex items-center justify-center`
 * box — necessary because a plain `<a>` stays `display: inline` by
 * default, so `min-height`/vertical-centering utilities applied to it
 * alone are silently no-ops, while a `<button>` is UA-styled as a real
 * box. Two actions built from raw `<Link>`+`<button>` markup with the same
 * className (the previous pattern) therefore end up different heights and
 * sit on visibly different baselines next to each other — that mismatch,
 * not a padding/margin typo, is what made paired action buttons look
 * unaligned. Centralizing the box model here is what actually fixes it,
 * and keeps every table's actions visually identical going forward
 * instead of each page hand-rolling its own class string.
 */
export function ActionButton({ tone = "primary", size = "sm", disabled, title, children, ...rest }: ActionButtonProps) {
  const sizeClass = size === "xs" ? "text-xs" : "text-sm";
  const className = `inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-md px-2.5 font-medium leading-none transition-colors disabled:cursor-not-allowed disabled:text-neutral-300 disabled:hover:bg-transparent ${sizeClass} ${TONE_CLASS[tone]}`;

  if ("href" in rest && rest.href !== undefined) {
    const { href, ...linkRest } = rest as ActionButtonAsLink;
    return (
      <Link href={href} title={title} className={className} {...linkRest}>
        {children}
      </Link>
    );
  }

  const buttonRest = rest as Omit<ActionButtonAsButton, "href" | "tone" | "size" | "disabled" | "title" | "children">;
  return (
    <button type="button" disabled={disabled} title={title} className={className} {...buttonRest}>
      {children}
    </button>
  );
}
