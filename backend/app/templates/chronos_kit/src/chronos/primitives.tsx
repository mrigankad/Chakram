/**
 * Shared surface primitives. Everything consumes semantic tokens only:
 * no hex, no raw palette classes.
 *
 * Props can come from generated code, so every enum is looked up with a
 * fallback (see safe.ts) and every array prop is treated as [] when it is not
 * an array. Panel and KpiTile contents sit inside a SectionBoundary.
 */

import { Children, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { ChevronRight } from "lucide-react";

import { SectionBoundary } from "./boundary";
import { count } from "./format";
import { cx } from "./cx";
import { asArray, isRecord, pick, toNum, toText } from "./safe";

export type Severity = "critical" | "high" | "medium" | "low";

/** Same chevron used for flow labels, status changes, and column moves. */
export function InlineArrow({ className }: { className?: string }) {
  return (
    <ChevronRight
      size={12}
      strokeWidth={1.75}
      aria-hidden
      className={cx("inline-block shrink-0", className)}
    />
  );
}

// Select (custom dropdown) lives in ./select.tsx.
export { Select } from "./select";
export type { SelectOption, SelectProps } from "./select";

// --- split row -------------------------------------------------------------

type SplitFrom = "md" | "lg" | "xl" | "2xl";
type SplitRatio = "1.4/1" | "1/1.4" | "1.6/1" | "1/2";

// Full class names are spelled out so Tailwind's content scan can see them.
const SPLIT_DIR: Record<SplitFrom, string> = {
  md: "md:flex-row",
  lg: "lg:flex-row",
  xl: "xl:flex-row",
  "2xl": "2xl:flex-row",
};

const SPLIT_GROW: Record<SplitFrom, Record<SplitRatio, [string, string]>> = {
  md: {
    "1.4/1": ["md:flex-[1.4]", "md:flex-1"],
    "1/1.4": ["md:flex-1", "md:flex-[1.4]"],
    "1.6/1": ["md:flex-[1.6]", "md:flex-1"],
    "1/2": ["md:flex-1", "md:flex-[2]"],
  },
  lg: {
    "1.4/1": ["lg:flex-[1.4]", "lg:flex-1"],
    "1/1.4": ["lg:flex-1", "lg:flex-[1.4]"],
    "1.6/1": ["lg:flex-[1.6]", "lg:flex-1"],
    "1/2": ["lg:flex-1", "lg:flex-[2]"],
  },
  xl: {
    "1.4/1": ["xl:flex-[1.4]", "xl:flex-1"],
    "1/1.4": ["xl:flex-1", "xl:flex-[1.4]"],
    "1.6/1": ["xl:flex-[1.6]", "xl:flex-1"],
    "1/2": ["xl:flex-1", "xl:flex-[2]"],
  },
  "2xl": {
    "1.4/1": ["2xl:flex-[1.4]", "2xl:flex-1"],
    "1/1.4": ["2xl:flex-1", "2xl:flex-[1.4]"],
    "1.6/1": ["2xl:flex-[1.6]", "2xl:flex-1"],
    "1/2": ["2xl:flex-1", "2xl:flex-[2]"],
  },
};

/**
 * Two-up layout that stacks below `from`, then sits side by side.
 * Equal height comes from flex stretch, not height:100% on an auto row.
 * Unknown `from` or `ratio` values fall back to "lg" and "1.4/1".
 */
export function SplitRow({
  children,
  from = "lg",
  ratio = "1.4/1",
  className,
}: {
  children: ReactNode;
  from?: SplitFrom;
  ratio?: SplitRatio;
  className?: string;
}) {
  const direction = pick(SPLIT_DIR, from, SPLIT_DIR.lg);
  const table = pick(SPLIT_GROW, from, SPLIT_GROW.lg);
  const grow = pick(table, ratio, table["1.4/1"]);
  return (
    <div className={cx("isolate flex flex-col items-stretch gap-4", direction, className)}>
      {Children.map(children, (child, index) => (
        <div className={`flex min-h-0 min-w-0 flex-col overflow-hidden ${grow[index] ?? "lg:flex-1"}`}>
          {child}
        </div>
      ))}
    </div>
  );
}

// --- grids -----------------------------------------------------------------

/** Accepts a plain CSS length (e.g. "18rem", "240px", "1.5em"); anything else is rejected. */
const CSS_LENGTH = /^(0|(\d+(\.\d+)?|\.\d+)(px|rem|em|%|vw|vh|ch|ex))$/;

function cssLength(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return CSS_LENGTH.test(trimmed) ? trimmed : fallback;
}

/**
 * Row of KpiTiles. Columns come from the available width, not a fixed count,
 * so tiles stay readable on phones. Set via inline style so no arbitrary class
 * needs to match Tailwind's scan.
 */
export function KpiGrid({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <div
      className={cx(className)}
      style={{
        display: "grid",
        gap: "1rem",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 13.5rem), 1fr))",
      }}
    >
      {children}
    </div>
  );
}

/**
 * Collection of cards or panels that wraps to as many columns as fit.
 * `min` is the smallest column width (a CSS length; invalid values use 18rem).
 * `gap` is a CSS length (invalid values use 1rem).
 */
export function Grid({
  children,
  min = "18rem",
  gap = "1rem",
  className,
}: {
  children?: ReactNode;
  min?: string;
  gap?: string;
  className?: string;
}) {
  const track = cssLength(min, "18rem");
  return (
    <div
      className={cx(className)}
      style={{
        display: "grid",
        gap: cssLength(gap, "1rem"),
        gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${track}), 1fr))`,
      }}
    >
      {children}
    </div>
  );
}

// --- panel -----------------------------------------------------------------

export function Panel({
  title,
  action,
  children,
  className,
  padded = true,
}: {
  title?: string;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  const heading = toText(title);
  return (
    <section
      className={cx(
        "isolate flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-muted bg-container",
        className,
      )}
    >
      {heading || action ? (
        <header className="flex min-h-[2.75rem] min-w-0 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-muted px-4 py-2">
          {heading ? (
            <h2
              title={heading}
              className="min-w-0 max-w-full truncate text-caption uppercase tracking-[0.08em] text-quaternary"
            >
              {heading}
            </h2>
          ) : (
            <span />
          )}
          {action ? <div className="min-w-0 max-w-full shrink-0">{action}</div> : null}
        </header>
      ) : null}
      <div
        className={`flex min-h-0 min-w-0 flex-1 flex-col [overflow-wrap:anywhere] ${padded ? "overflow-auto p-4" : "overflow-hidden"}`}
      >
        <SectionBoundary label={heading || "Panel"}>{children}</SectionBoundary>
      </div>
    </section>
  );
}

// --- KPI -------------------------------------------------------------------

/**
 * Font size for a KPI figure of `length` characters. Michroma glyphs are about
 * 0.9em wide, so the figure fits 92% of the tile width at k = 92 / (0.9 * L)
 * container-width units, clamped to [6, 40] cqi. The rem cap steps down with
 * length so short figures stay large.
 */
function kpiFigureSize(length: number): string {
  const n = Math.max(1, length);
  const maxRem = n <= 4 ? 2.5 : n <= 7 ? 2.25 : n <= 10 ? 1.875 : n <= 14 ? 1.5 : 1.25;
  const k = Math.min(40, Math.max(6, 92 / (0.9 * n)));
  return `min(${maxRem}rem, ${k.toFixed(2)}cqi)`;
}

const DELTA_TONE: Record<"neutral" | "success" | "info" | "warning" | "error", string> = {
  neutral: "text-tertiary",
  success: "text-success",
  info: "text-info",
  warning: "text-warning",
  error: "text-error",
};

export function KpiTile({
  label,
  value,
  delta,
  hint,
  mark,
  tone = "neutral",
  className,
}: {
  label: string;
  /** Pre-formatted string, or a number (formatted with count()). */
  value: string | number;
  /** Signed percentage, pre-formatted, e.g. "+4.2%". */
  delta?: string | number;
  hint?: string;
  mark?: ReactNode;
  tone?: "neutral" | "success" | "info" | "warning" | "error";
  className?: string;
}) {
  const deltaTone = pick(DELTA_TONE, tone, DELTA_TONE.neutral);
  const figure = typeof value === "number" ? count(value) : typeof value === "string" ? value : "—";
  const deltaNumber = toNum(delta);
  const deltaText =
    typeof delta === "string" ? delta : Number.isNaN(deltaNumber) ? "" : String(deltaNumber);
  const heading = toText(label);

  return (
    <div
      className={cx(
        "flex min-w-0 flex-col gap-1.5 rounded-lg border border-muted bg-container px-4 py-3.5",
        className,
      )}
      style={{ containerType: "inline-size" }}
    >
      <SectionBoundary label={heading || "KPI"}>
        <div className="flex items-start justify-between gap-2">
          <span className="line-clamp-2 min-w-0 flex-1 break-words text-caption uppercase tracking-[0.08em] text-quaternary">
            {heading}
          </span>
          {mark ? <span className="shrink-0">{mark}</span> : null}
        </div>
        <span
          className="block max-w-full overflow-hidden text-ellipsis whitespace-nowrap font-display leading-none tabular text-primary"
          style={{ fontSize: kpiFigureSize(figure.length) }}
          title={figure}
        >
          {figure}
        </span>
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {deltaText ? <span className={`text-body-sm tabular ${deltaTone}`}>{deltaText}</span> : null}
          {hint ? (
            <span className="line-clamp-2 min-w-0 break-words text-caption text-quaternary">{toText(hint)}</span>
          ) : null}
        </div>
      </SectionBoundary>
    </div>
  );
}

// --- status --------------------------------------------------------------

export type StatusTone = "success" | "info" | "neutral" | "warning" | "error";

const TONE_CLASS: Record<StatusTone, string> = {
  success: "bg-success-badge",
  info: "bg-info-badge",
  neutral: "bg-neutral-badge",
  warning: "bg-warning-badge",
  error: "bg-error-badge",
};

/** Unknown tones render as "neutral". */
export function StatusBadge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: StatusTone;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex max-w-full items-center truncate rounded-full px-2.5 py-0.5 text-caption font-medium text-badge",
        pick(TONE_CLASS, tone, TONE_CLASS.neutral),
        className,
      )}
    >
      {children}
    </span>
  );
}

const SEVERITY_TONE: Record<Severity, StatusTone> = {
  critical: "error",
  high: "warning",
  medium: "info",
  low: "neutral",
};

/** Unknown priorities show their text in the neutral tone. */
export function PriorityBadge({ priority, className }: { priority: Severity; className?: string }) {
  const tone = pick<StatusTone>(SEVERITY_TONE, priority, "neutral");
  return (
    <StatusBadge tone={tone} className={className}>
      {toText(priority)}
    </StatusBadge>
  );
}

const DOT_CLASS: Record<StatusTone, string> = {
  success: "bg-success",
  info: "bg-info",
  neutral: "bg-neutral",
  warning: "bg-warning",
  error: "bg-error",
};

/** Small dot for dense rows where a full badge is too heavy. Unknown tones are neutral. */
export function StatusDot({ tone = "neutral", className }: { tone?: StatusTone; className?: string }) {
  return (
    <span
      className={cx("inline-block size-1.5 rounded-full", pick(DOT_CLASS, tone, DOT_CLASS.neutral), className)}
      aria-hidden
    />
  );
}

// --- empty state -----------------------------------------------------------

export function EmptyState({
  title,
  detail,
  mark,
  className,
}: {
  title: string;
  detail?: string;
  mark?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex h-full min-h-[160px] flex-col items-center justify-center gap-1.5 px-6 text-center",
        className,
      )}
    >
      {mark}
      <p className="text-body-md text-tertiary">{toText(title)}</p>
      {toText(detail) ? <p className="text-body-sm text-quaternary">{toText(detail)}</p> : null}
    </div>
  );
}

// --- breakdown -------------------------------------------------------------

/**
 * Horizontal bar breakdown. Deliberately monochrome: the categories carry no
 * status meaning. The selected row's bar is the action colour.
 * Rows that are not objects are skipped; a non-numeric value counts as 0.
 */
export function BarList({
  rows,
  onSelect,
  selectedId,
  formatValue = count,
  className,
}: {
  rows: { id: string; label: string; value: number }[];
  onSelect?: (id: string) => void;
  selectedId?: string;
  formatValue?: (value: number) => string;
  className?: string;
}) {
  const items = asArray<unknown>(rows)
    .filter(isRecord)
    .map((row, index) => ({
      id: toText(row.id) || `row-${index}`,
      label: toText(row.label),
      value: toNum(row.value) || 0,
    }));
  const max = Math.max(1, ...items.map((item) => item.value));
  const format = (value: number) => {
    try {
      return typeof formatValue === "function" ? String(formatValue(value)) : count(value);
    } catch {
      return count(value);
    }
  };

  return (
    <ul className={cx("flex flex-col gap-1.5", className)}>
      {items.map((row, index) => {
        const selected = row.id === selectedId;
        const content = (
          <>
            <span className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-body-sm text-secondary" title={row.label}>
                {row.label}
              </span>
              <span className="shrink-0 text-body-sm tabular text-primary">{format(row.value)}</span>
            </span>
            <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-raised-2">
              <span
                className={`block h-full rounded-full ${selected ? "bg-action-primary" : "bg-quaternary"}`}
                style={{ width: `${(row.value / max) * 100}%` }}
              />
            </span>
          </>
        );

        return (
          <li key={`${row.id}:${index}`}>
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(row.id)}
                aria-pressed={selected}
                className="block w-full rounded-md px-1.5 py-1 text-left transition-colors duration-[150ms] hover:bg-raised"
              >
                {content}
              </button>
            ) : (
              <div className="px-1.5 py-1">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// --- controls --------------------------------------------------------------

type ButtonVariant = "primary" | "secondary" | "ghost";
type ButtonSize = "md" | "sm";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-action-primary text-on-color hover:bg-action-primary-hover",
  secondary: "border border-default bg-container text-primary hover:bg-raised",
  ghost: "text-secondary hover:bg-raised hover:text-primary",
};
const BUTTON_SIZE: Record<ButtonSize, string> = {
  md: "h-9 px-4 text-label-md",
  sm: "h-7 px-3 text-label-sm",
};

/**
 * The kit's button: pill shape, three variants, one focus ring. `type` defaults to
 * "button" so a button inside a form never submits by accident.
 */
export function Button({
  variant = "primary",
  size = "md",
  type = "button",
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  const v = pick(BUTTON_VARIANT, variant, BUTTON_VARIANT.primary);
  const s = pick(BUTTON_SIZE, size, BUTTON_SIZE.md);
  return (
    <button
      type={type}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-active disabled:cursor-not-allowed disabled:opacity-60",
        v,
        s,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

const FIELD_CLASS =
  "w-full rounded-lg border border-muted bg-container px-3 py-2 text-body-md text-primary placeholder:text-quaternary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-active disabled:opacity-60";

/** A text, number, date, email or url input in the kit's field style. */
export function TextField({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(FIELD_CLASS, className)} {...rest} />;
}

/** A multi-line input in the kit's field style; `rows` defaults to 3. */
export function TextArea({ className, rows = 3, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={rows} className={cx(FIELD_CLASS, className)} {...rest} />;
}

/** A checkbox with its label on the right. */
export function Checkbox({
  label,
  className,
  id,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label?: ReactNode }) {
  return (
    <label htmlFor={id} className={cx("inline-flex items-center gap-2 text-body-md text-primary", className)}>
      <input id={id} type="checkbox" className="size-4 rounded border-muted accent-[var(--action-primary-default)]" {...rest} />
      {label}
    </label>
  );
}

/**
 * Label above a control, with an optional required mark, hint and error line.
 * Pass `htmlFor` matching the control's `id` so the label is clickable.
 */
export function FormRow({
  label,
  htmlFor,
  required,
  hint,
  error,
  className,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  required?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cx("block", className)}>
      <label htmlFor={htmlFor} className="mb-1 block text-label-sm text-secondary">
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {children}
      {error ? (
        <p className="mt-1 text-caption text-error" role="alert">{toText(error)}</p>
      ) : hint ? (
        <p className="mt-1 text-caption text-tertiary">{hint}</p>
      ) : null}
    </div>
  );
}
