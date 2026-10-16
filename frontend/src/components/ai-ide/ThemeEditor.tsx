import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Moon, RotateCcw, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  FONT_CHOICES,
  NEUTRAL_FAMILIES,
  TAILWIND_500,
  buildDesign,
  generateShades,
  parseDesign,
  scanArbitraryHex,
  scanPaletteUsage,
  serializeDesign,
  type DesignFile,
} from "@/lib/app-design";
import {
  DEFAULT_THEME,
  THEME_PRESETS,
  contrastRatio,
  normalizeTheme,
  readableOn,
  themeCss,
  themePreview,
  type SurfaceStyle,
  type ThemePreset,
  type ThemeSettings,
} from "@/lib/theme-engine";
import { designFileChanges } from "./DesignPanel";

const DESIGN_CSS_HEADER = "/* Theme overrides from the App Builder's Design tab. Empty means the Chronos defaults. */\n";
const ACCENT_SUGGESTIONS = ["#ff7b1c", "#2563eb", "#0891b2", "#15803d", "#6d28d9", "#db2777", "#b91c1c", "#111827"];
const STATUS_DEFAULTS = { success: "#2f9e5b", info: "#2c96db", warning: "#ff7b1c", error: "#e5484d" };

/**
 * index.css must load design.css after the kit's tokens and after a design pack's
 * overrides (./design/pack.css), never between the two: the Design tab's edits are
 * a delta over whichever pack the app was created with.
 */
export function withDesignImport(css: string): string {
  if (/@import\s+['"]\.\/design\.css['"]/.test(css)) return css;
  const pack = css.match(/@import\s+['"]\.\/design\/pack\.css['"]\s*;?[^\n]*\n?/);
  const tokens = css.match(/@import\s+['"]\.\/chronos\/tokens\.css['"]\s*;?[^\n]*\n?/);
  const after = pack ?? tokens;
  if (after && after.index !== undefined) {
    const at = after.index + after[0].length;
    return css.slice(0, at) + "@import './design.css';\n" + css.slice(at);
  }
  return "@import './design.css';\n" + css;
}

/** <html> carries the app's default colour mode (the kit's dark theme is [data-theme="dark"]). */
export function withHtmlMode(html: string, mode: "light" | "dark"): string {
  return html.replace(/<html\b([^>]*)>/i, (_m, attrs: string) => {
    const rest = attrs.replace(/\s+data-theme="[^"]*"/i, "");
    return mode === "dark" ? `<html${rest} data-theme="dark">` : `<html${rest}>`;
  });
}

/** Every file a theme change writes: design.json (with the theme), design.css, index.css/html, tailwind config. */
export function themeFileChanges(files: Record<string, string>, design: DesignFile, theme: ThemeSettings): Record<string, string> {
  const changes = designFileChanges(files, design);
  changes["design.json"] = JSON.stringify({ ...JSON.parse(serializeDesign(design)), theme }, null, 2) + "\n";
  changes["src/design.css"] = DESIGN_CSS_HEADER + themeCss(theme);
  const css = files["src/index.css"];
  if (css !== undefined && css.includes("chronos/tokens.css")) {
    const next = withDesignImport(css);
    if (next !== css) changes["src/index.css"] = next;
  }
  const html = changes["index.html"] ?? files["index.html"];
  if (html !== undefined) {
    const next = withHtmlMode(html, theme.mode);
    if (next !== files["index.html"]) changes["index.html"] = next;
  }
  for (const [path, content] of Object.entries(changes)) if (files[path] === content) delete changes[path];
  return changes;
}

function readTheme(raw: string | undefined): ThemeSettings {
  try {
    return normalizeTheme(raw ? JSON.parse(raw)?.theme : null);
  } catch {
    return DEFAULT_THEME;
  }
}

function Section({
  title,
  children,
  action,
  collapsible = false,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-stroke-muted px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        {collapsible ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-1 font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary hover:text-ink-secondary"
            aria-expanded={open}
          >
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {title}
          </button>
        ) : (
          <h3 className="font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary">{title}</h3>
        )}
        {action}
      </div>
      {(!collapsible || open) && children}
    </section>
  );
}

/** A miniature of the theme: page, card, text lines, primary button and chart bars. */
function PresetThumb({ preset, active, onPick }: { preset: ThemePreset; active: boolean; onPick: () => void }) {
  const p = themePreview(preset.theme, preset.theme.mode);
  return (
    <button
      type="button"
      onClick={onPick}
      title={preset.description}
      className={cn(
        "group overflow-hidden rounded-lg border text-left transition-colors",
        active ? "border-stroke ring-2 ring-stroke" : "border-stroke-muted hover:border-stroke",
      )}
    >
      <div className="p-2" style={{ background: p.page }}>
        <div className="rounded-md border p-2" style={{ background: p.container, borderColor: p.stroke, borderRadius: `${6 * preset.radius}px` }}>
          <div className="mb-1 h-1.5 w-10 rounded-full" style={{ background: p.text }} />
          <div className="mb-2 h-1 w-14 rounded-full" style={{ background: p.textMuted }} />
          <div className="flex items-end justify-between">
            <div className="flex h-5 items-end gap-0.5">
              {p.series.slice(0, 4).map((c, i) => (
                <span key={i} className="w-1.5 rounded-sm" style={{ background: c, height: `${8 + i * 3}px` }} />
              ))}
            </div>
            <span
              className="px-1.5 py-0.5 text-[8px] font-semibold"
              style={{ background: p.accent, color: p.accentContent, borderRadius: `${4 * preset.radius}px` }}
            >
              Save
            </span>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between bg-container px-2 py-1.5">
        <span className="text-xs font-medium text-ink">{preset.name}</span>
        {active ? <Check className="h-3 w-3 text-ink" /> : preset.theme.mode === "dark" ? <Moon className="h-3 w-3 text-ink-tertiary" /> : null}
      </div>
    </button>
  );
}

function ColorField({
  label,
  value,
  onChange,
  onReset,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
  onReset?: () => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-ink-secondary">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-9 cursor-pointer rounded border border-stroke-muted bg-transparent p-0.5"
        aria-label={label}
      />
      <span className="flex-1">{label}</span>
      <code className="font-mono text-[10px] text-ink-quaternary">{value}</code>
      {onReset && (
        <button type="button" onClick={onReset} className="text-ink-tertiary hover:text-ink" aria-label={`Reset ${label}`}>
          <RotateCcw className="h-3 w-3" />
        </button>
      )}
    </label>
  );
}

export function ThemeEditor({
  files,
  onApplyFiles,
}: {
  files: Record<string, string>;
  onApplyFiles: (changes: Record<string, string>) => void;
}) {
  const savedDesign = useMemo(() => parseDesign(files["design.json"]), [files]);
  const savedTheme = useMemo(() => readTheme(files["design.json"]), [files]);
  const [design, setDesign] = useState<DesignFile>(savedDesign);
  const [theme, setTheme] = useState<ThemeSettings>(savedTheme);
  const lastWritten = useRef(files["design.json"] ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A design.json changed elsewhere (undo, the AI, another tab) replaces the drafts.
  useEffect(() => {
    const raw = files["design.json"] ?? "";
    if (raw !== lastWritten.current) {
      lastWritten.current = raw;
      setDesign(savedDesign);
      setTheme(savedTheme);
    }
  }, [files, savedDesign, savedTheme]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const commit = (nextDesign: DesignFile, nextTheme: ThemeSettings) => {
    setDesign(nextDesign);
    setTheme(nextTheme);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const changes = themeFileChanges(files, nextDesign, nextTheme);
      if (changes["design.json"]) lastWritten.current = changes["design.json"];
      if (Object.keys(changes).length) onApplyFiles(changes);
    }, 200);
  };

  const updateDesign = (patch: Partial<{ preset: string; palette: Record<string, string>; fonts: { sans: string; display: string }; radius: number }>) =>
    buildDesign({
      preset: patch.preset ?? "custom",
      palette: patch.palette ?? design.palette,
      fonts: patch.fonts ?? design.fonts,
      radius: patch.radius ?? design.radius,
    });
  const updateTheme = (patch: Partial<ThemeSettings>) => normalizeTheme({ ...theme, ...patch });

  const used = useMemo(() => scanPaletteUsage(files), [files]);
  const hexes = useMemo(() => scanArbitraryHex(files).slice(0, 6), [files]);
  const preview = themePreview(theme, theme.mode);
  const accentContrast = theme.accent ? contrastRatio(theme.accent, readableOn(theme.accent)) : null;
  const fontNames = useMemo(() => {
    const names = FONT_CHOICES.map((f) => f.name);
    return names.includes("Michroma") ? names : [...names, "Michroma"];
  }, []);

  return (
    <div>
      <Section
        title="Theme"
        action={
          <button
            type="button"
            className="flex items-center gap-1 text-[11px] text-ink-tertiary hover:text-ink"
            onClick={() => commit(updateDesign({ preset: "chronos", palette: {}, fonts: { sans: "Geist", display: "Michroma" }, radius: 1 }), DEFAULT_THEME)}
          >
            <RotateCcw className="h-3 w-3" /> Reset
          </button>
        }
      >
        <div className="grid grid-cols-2 gap-2">
          {THEME_PRESETS.map((preset) => (
            <PresetThumb
              key={preset.id}
              preset={preset}
              active={design.preset === preset.id}
              onPick={() =>
                commit(
                  updateDesign({ preset: preset.id, palette: {}, fonts: preset.fonts, radius: preset.radius }),
                  normalizeTheme(preset.theme),
                )
              }
            />
          ))}
        </div>
      </Section>

      <Section title="Brand & surfaces">
        <div className="space-y-3">
          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs text-ink-secondary">
              <span>Brand colour</span>
              {accentContrast !== null && (
                <span
                  className={cn("rounded-full border border-stroke-muted px-1.5 text-[10px] tabular-nums", accentContrast < 4.5 ? "text-warning" : "text-ink-tertiary")}
                  title="Contrast between the brand colour and its button text (WCAG AA needs 4.5)"
                >
                  {accentContrast.toFixed(1)}:1
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                title="Kit default (graphite)"
                onClick={() => commit({ ...design, preset: "custom" }, updateTheme({ accent: null }))}
                className={cn("h-6 w-6 rounded-full border border-stroke-muted bg-[#101010]", theme.accent === null && "ring-2 ring-stroke ring-offset-1")}
              />
              {ACCENT_SUGGESTIONS.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  title={hex}
                  onClick={() => commit({ ...design, preset: "custom" }, updateTheme({ accent: hex }))}
                  className={cn("h-6 w-6 rounded-full border border-stroke-muted", theme.accent === hex && "ring-2 ring-stroke ring-offset-1")}
                  style={{ background: hex }}
                />
              ))}
              <input
                type="color"
                value={theme.accent ?? "#101010"}
                onChange={(e) => commit({ ...design, preset: "custom" }, updateTheme({ accent: e.target.value }))}
                className="h-6 w-8 cursor-pointer rounded border border-stroke-muted bg-transparent p-0.5"
                aria-label="Custom brand colour"
              />
            </div>
            <p className="mt-1 text-[10px] text-ink-quaternary">Buttons, active states and the first chart series.</p>
          </div>

          <div>
            <span className="mb-1.5 block text-xs text-ink-secondary">Surfaces</span>
            <div className="grid grid-cols-4 gap-1">
              {(["neutral", "warm", "cool", "tinted"] as SurfaceStyle[]).map((s) => {
                const p = themePreview({ ...theme, surface: s }, theme.mode);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => commit({ ...design, preset: "custom" }, updateTheme({ surface: s }))}
                    className={cn(
                      "rounded-md border p-1 text-[10px] capitalize text-ink-secondary",
                      theme.surface === s ? "border-stroke ring-1 ring-stroke" : "border-stroke-muted hover:border-stroke",
                    )}
                  >
                    <span className="mb-1 block h-5 rounded-sm border" style={{ background: p.page, borderColor: p.stroke }}>
                      <span className="m-1 block h-2.5 rounded-sm" style={{ background: p.container }} />
                    </span>
                    {s}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-ink-secondary">Default mode</span>
            <div className="inline-flex rounded-md border border-stroke-muted p-0.5">
              {(["light", "dark"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => commit({ ...design, preset: "custom" }, updateTheme({ mode: m }))}
                  aria-pressed={theme.mode === m}
                  className={cn(
                    "flex h-6 items-center gap-1 rounded px-2 text-[11px] capitalize",
                    theme.mode === m ? "bg-raised text-ink" : "text-ink-tertiary hover:text-ink",
                  )}
                >
                  {m === "light" ? <Sun className="h-3 w-3" /> : <Moon className="h-3 w-3" />}
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-md border border-stroke-muted p-2" style={{ background: preview.page }}>
            <div className="flex items-center justify-between rounded p-2" style={{ background: preview.container }}>
              <span className="text-xs font-medium" style={{ color: preview.text }}>
                Preview
              </span>
              <span className="rounded px-2 py-0.5 text-[10px] font-semibold" style={{ background: preview.accent, color: preview.accentContent }}>
                Primary
              </span>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Status colours" collapsible defaultOpen={false}>
        <div className="space-y-1.5">
          {(Object.keys(STATUS_DEFAULTS) as Array<keyof typeof STATUS_DEFAULTS>).map((k) => (
            <ColorField
              key={k}
              label={k[0].toUpperCase() + k.slice(1)}
              value={(theme.status ?? STATUS_DEFAULTS)[k]}
              onChange={(hex) => commit({ ...design, preset: "custom" }, updateTheme({ status: { ...(theme.status ?? STATUS_DEFAULTS), [k]: hex } }))}
            />
          ))}
          {theme.status && (
            <button type="button" className="text-[11px] text-ink-tertiary hover:text-ink" onClick={() => commit(design, updateTheme({ status: null }))}>
              Use the kit's status colours
            </button>
          )}
        </div>
      </Section>

      <Section title="Chart colours" collapsible defaultOpen={false}>
        <div className="space-y-1.5">
          <div className="flex h-3 overflow-hidden rounded-sm">
            {preview.series.map((c, i) => (
              <span key={i} className="flex-1" style={{ background: c }} />
            ))}
          </div>
          {preview.series.slice(0, 6).map((c, i) => (
            <ColorField
              key={i}
              label={`Series ${i + 1}`}
              value={c.startsWith("#") && c.length === 7 ? c : "#888888"}
              onChange={(hex) => {
                const next = [...(theme.chart ?? preview.series.slice(0, 6))];
                next[i] = hex;
                commit({ ...design, preset: "custom" }, updateTheme({ chart: next }));
              }}
            />
          ))}
          {theme.chart && (
            <button type="button" className="text-[11px] text-ink-tertiary hover:text-ink" onClick={() => commit(design, updateTheme({ chart: null }))}>
              Derive from the brand colour
            </button>
          )}
        </div>
      </Section>

      <Section title="Typography">
        <div className="space-y-2">
          {(
            [
              ["sans", "Body"],
              ["display", "Headings & figures"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center justify-between gap-2 text-xs text-ink-secondary">
              {label}
              <Select
                value={design.fonts[key]}
                onValueChange={(v) => commit(updateDesign({ fonts: { ...design.fonts, [key]: v } }), theme)}
              >
                <SelectTrigger
                  className="h-7 w-40 rounded-md border border-stroke-muted bg-container px-2 text-xs text-ink"
                  style={{ fontFamily: `"${design.fonts[key]}", ui-sans-serif, system-ui` }}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {fontNames.map((name) => (
                    <SelectItem key={name} value={name} className="text-xs" style={{ fontFamily: `"${name}", ui-sans-serif, system-ui` }}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          ))}
        </div>
      </Section>

      <Section title="Corner radius">
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={2}
            step={0.25}
            value={design.radius}
            onChange={(e) => commit(updateDesign({ radius: Number(e.target.value) }), theme)}
            className="flex-1"
            aria-label="Corner radius"
          />
          <span className="w-10 text-right text-xs tabular-nums text-ink-secondary">{design.radius}×</span>
        </div>
      </Section>

      <Section title="Advanced: palette colours" collapsible defaultOpen={false}>
        <p className="mb-2 text-[11px] leading-relaxed text-ink-tertiary">
          Recolour Tailwind palette families used directly in the code (the theme above covers the kit's components).
        </p>
        {used.length === 0 ? (
          <p className="text-xs text-ink-tertiary">No palette colours in this app.</p>
        ) : (
          <ul className="space-y-1.5">
            {used.map(({ family, count }) => {
              const value = design.palette[family] ?? TAILWIND_500[family] ?? "#888888";
              return (
                <li key={family} className="flex items-center gap-2">
                  <input
                    type="color"
                    value={value}
                    onChange={(e) => commit(updateDesign({ preset: "custom", palette: { ...design.palette, [family]: e.target.value } }), theme)}
                    className="h-7 w-9 cursor-pointer rounded border border-stroke-muted bg-transparent p-0.5"
                    aria-label={`Colour for ${family}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between">
                      <span className="text-xs font-medium capitalize text-ink">
                        {family}
                        {NEUTRAL_FAMILIES.includes(family) && <span className="ml-1 font-normal text-ink-tertiary">neutral</span>}
                      </span>
                      <span className="text-[10px] tabular-nums text-ink-quaternary">{count} uses</span>
                    </div>
                    <div className="mt-1 flex h-2 overflow-hidden rounded-sm">
                      {Object.values(generateShades(value)).map((hex, i) => (
                        <span key={i} className="flex-1" style={{ background: hex }} />
                      ))}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {hexes.length > 0 && (
          <p className="mt-2 text-[11px] leading-relaxed text-ink-tertiary">
            {hexes.length} fixed colour{hexes.length === 1 ? "" : "s"} in the code ({hexes.map((h) => h.hex).join(", ")}): select the element and
            use its colour controls, or ask the AI.
          </p>
        )}
      </Section>
    </div>
  );
}
