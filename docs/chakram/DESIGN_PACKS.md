# Design packs

A design pack is how a client's visual system is installed into Chakram's App Studio so every generated app follows it. The default pack, `chronos`, is the look that ships today, extracted into the same format. Packs are uploaded per organization in Settings → Connectors → Design System, one can be marked the default, and App Studio offers the choice when an app is created.

## Format

A zip containing these files (at the root or inside one folder):

```
pack.json          metadata (required)
pack.css           custom-property overrides (required; may be empty)
README.md          notes the planner reads: voice, what to call things (optional)
brand/logo.svg     logo for the app shell, SVG only (optional)
```

### pack.json

```json
{
  "id": "mahindra",
  "name": "Mahindra",
  "version": "1.0.0",
  "mode": "light",
  "fonts": {
    "sans":    { "family": "Inter", "stack": ["Inter", "system-ui", "sans-serif"], "source": "google",
                 "url": "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" },
    "display": { "family": "Space Grotesk", "stack": ["Space Grotesk", "Inter", "sans-serif"], "source": "google",
                 "url": "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&display=swap" }
  },
  "radius": { "lg": "4px" },
  "brand": { "logo": "brand/logo.svg" }
}
```

- `id`: 2–40 characters, `a-z 0-9 -`. Builtin ids (`chronos`) cannot be reused.
- `mode`: the app's default colour mode.
- `fonts.sans` is required; `display` is optional (page titles and metric figures). `source` is `google` (then `url` must be a fonts.googleapis.com link) or `system` (no url). Self-hosted fonts: put `@font-face` rules with `url(data:…)` in `pack.css` and set `source` to `self`.
- `radius.lg`: the card radius (`px` or `rem`).
- `brand.logo`: an SVG inside the pack. Scripts and event handlers are rejected.

### pack.css

Override the kit's semantic custom properties. Light values go on `:root`, dark values on `[data-theme="dark"]`. The names are the kit's (`backend/app/templates/chronos_kit/src/chronos/tokens.css`, "TIER 2"): `--surface-*`, `--text-*`, `--icon-*`, `--stroke-*`, `--action-{primary,secondary,tertiary}-*`, `--feedback-{success,info,neutral,warning,error}-*`, `--feedback-badge-content`, `--analytics-series-1..6`. Values can be hex, `rgb()`/`rgba()`, or `var(--ref-…)` references to the kit's reference palette.

You do not have to override everything. Tokens you leave out keep the Chronos value, and the upload reports which ones. `--font-sans`, `--font-display` and `--radius-lg` are generated from `pack.json`; do not set them by hand.

### What the validator checks

- `pack.json` parses and has `id`, `name`, `version`, `fonts.sans.family`; `mode` is `light` or `dark`.
- The logo exists, is SVG, and contains no script.
- Contrast in light mode: `--text-primary` on the page and on containers, `--text-secondary` on containers, and `--action-primary-content` on `--action-primary-default` must be at least 3:1 (rejected below that) and are reported when below 4.5:1.
- Which semantic tokens are left at Chronos defaults, and whether a dark block exists (warnings).

## How a pack lands in an app

```
src/design/pack.json          the metadata
src/design/pack.css           generated --font-*/--radius-lg lines, then your pack.css
src/design/README.md          read by the planner
src/design/brand/logo.svg     shown in the AppShell logo tile (logoSrc)
src/index.css                 @import tokens.css → design/pack.css → design.css
index.html                    font <link>s between the DESIGN_FONTS markers; data-theme="dark" when mode is dark
```

The kit upgrade (`kit.outdated_kit_files`) replaces only `src/chronos/*`, so a pack survives every kit release. The Design tab's theme editor writes `src/design.css`, which loads last: it is a per-app delta over the pack, and the pack itself is never edited inside an app. Downloads and GitHub pushes carry `src/design/` like any other source.

## Chakram wears the pack too

The org's default pack styles Chakram's own UI, not only the apps it builds, so a client
sees one visual system from the first login to the deployed app.

- Chakram's tokens (`frontend/src/styles/imcc-tokens.css`) use the kit's names: light values
  on `:root`, dark on `.dark` (next-themes), the same `--surface-*`, `--text-*`, `--action-*`,
  `--feedback-*`, `--analytics-series-*`, `--font-*` and `--radius-lg` a pack sets.
  `backend/tests/test_design_packs.py::test_chakrams_own_tokens_consume_every_name_a_pack_can_set`
  fails when a name a pack can set is neither defined nor read by Chakram.
- Tailwind's colours (`tailwind.config.ts`) read those tokens through `color-mix`, so
  `bg-page`, `text-ink`, `bg-primary`, `border-border/60` and the shadcn names all follow the
  pack; nothing in a page has to change.
- `GET /api/orgs/current/design-pack` returns the default pack as `{ id, name, mode, fonts,
  light, dark }` (custom properties by mode, plus the fonts and radius from `pack.json`).
  `components/OrgDesignPack.tsx` applies it after sign-in (`lib/design-pack.ts`: one `<style
  id="org-design-pack">` and the Google Fonts links) and removes it on sign-out, so the login
  page is always Chronos. Changing the default in Settings → Design System restyles Chakram
  at once.
- Not covered: Chakram's own logo and product name stay Chakram's (white-labelling is a
  separate decision), and the dark toggle uses the pack's `[data-theme="dark"]` block, which
  a pack may leave empty (Chronos dark values then apply).

## Making the Mahindra pack

1. Start from `backend/app/templates/design_packs/chronos/` and the test fixture in `backend/tests/test_design_packs.py` (`ACME_CSS` lists every semantic token with concrete values).
2. Fill `pack.css` from the brand guide: surfaces and text first, then the primary action colour and its content colour, then feedback tones. Keep status colours distinguishable from the brand accent.
3. Add the logo as SVG and the two fonts.
4. Write `README.md` in one or two sentences: tone of voice, the words the client uses (for example "Dealer", "Plant", "Work order"), what to avoid. The planner uses it for app and page names.
5. Zip the folder and upload it in Settings. Fix anything the validator rejects; read the warnings.
6. Mark it the default. New apps use it; existing apps keep theirs.

## API

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| GET | `/api/ai-ide/design-packs` | — | `{ packs: [{ id, name, version, source, is_default, mode, fonts, swatches }], default_id }` |
| POST | `/api/ai-ide/design-packs` | multipart `file` (zip ≤ 1 MB) | `{ pack, warnings }`; 422 `Design pack rejected: …` |
| POST | `/api/ai-ide/design-packs/{id}/default` | — | `{ ok, default_id }` |
| DELETE | `/api/ai-ide/design-packs/{id}` | — | `{ ok }` (org packs only) |
| POST | `/api/ai-ide/workspace/create` | `{ pack_id? }` | `{ workspace_id, file_paths, pack_id }` |
| GET | `/api/orgs/current/design-pack` | — | `{ id, name, mode, fonts, light, dark }` for Chakram's own UI |

Org packs are stored in the `design_packs` collection (one document per org and id, files inline, text only). The org's default lives on its `organizations` document (`design_pack_default`).
