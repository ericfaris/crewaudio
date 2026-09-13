# study — design system

_"Reading room"_ — a light, violet-and-sky-blue study desk for an audiobook
player. Written 2026-09-13, first design pass (the app previously had no
identity beyond a default dark UI).

Live showcase: **`/design-system.html`** (open the app, then visit that path).
Every token and component on that page is pulled from the real `public/styles.css`.

## Direction narrative

The app (branded **study**) plays imported audiobooks/lecture playlists and
quizzes the listener on each chapter. It had no identity — a generic dark
`#14161a` shell with one blue accent (`#2f5ad6`).

Three references anchored this pass:

1. **DocuVault** (file-manager dashboard) — light, airy white-on-lavender
   surfaces, a violet+blue accent pair, rounded cards, soft shadows, and a
   **circular usage gauge** as its signature data widget.
2. **A minimal audio-player widget** — restrained monochrome transport icons,
   a glowing blue scrub thumb, generous whitespace, rounded card chrome.
3. **Huthy** (an analytics/call-review dashboard) — pill-shaped active nav,
   tinted icon badges, circular percentage rings, a waveform-style audio
   player with a dark circular play button, and small colored status pills.

The common thread across all three — light surfaces, violet-dominant with a
blue secondary, rounded cards with soft tinted shadows, and **circular
progress rings as the recurring data motif** — became the direction, and maps
onto this app almost literally: a chapter's listening position becomes a ring
around the play button, and a book's completion becomes a ring next to its
name in the sidebar.

**Key moments this was designed around:**
- Opening the app / selecting a track (`#now-playing` load-in)
- Pressing play — the signature ring control
- A quiz question resolving right/wrong with an explanation
- Finishing a quiz and seeing the score + best-score badge
- The import log streaming while a playlist downloads
- Collapsing into the compact PWA widget

## Color

| Token | Value | Role |
|---|---|---|
| `--bg` | `#f3f1fb` | Page background (paired with `--bg-grad`) |
| `--surface` | `#ffffff` | Cards: now-playing, quiz panel, import box |
| `--surface-2` | `#f8f6fd` | Nested surfaces: list rows, quiz choices, inputs |
| `--surface-3` | `#f1eefa` | Track fill (seek, book-gauge, hover states) |
| `--border` | `#e5e1f5` | Default hairline border |
| `--border-strong` | `#d6cff0` | Emphasis border (reserved) |
| `--text` | `#201c34` | Primary text — 13.8:1 on `--surface` |
| `--text-2` | `#625d80` | Secondary text — 6.3:1 on `--surface` |
| `--text-3` | `#948fb0` | Tertiary/meta text — 3.3:1 on `--surface` (large text/icons only) |
| `--accent` | `#6d5ef8` | Brand violet — primary buttons, active nav, ring fill |
| `--accent-strong` | `#5541f0` | Hover/pressed state for accent |
| `--accent-soft` | `#ece8ff` | Tinted backgrounds: badges, install button, quiz-note |
| `--accent-2` | `#2f9dff` | Sky blue — reserved for playback/progress (seek thumb, play-ring) |
| `--accent-2-soft` | `#e4f3ff` | Quiz-badge background |
| `--good` | `#17a869` | Correct quiz answer |
| `--good-soft` | `#e2f8ee` | Correct answer background |
| `--bad` | `#e5484d` | Wrong quiz answer / destructive hover (quiz-close) |
| `--bad-soft` | `#fdeaea` | Wrong answer background |
| `--warn` | `#f2a30f` | Reserved (not yet used — future streak/warning state) |
| `--warn-soft` | `#fef3e0` | Reserved |

Text-on-surface pairs were kept ≥4.5:1 for body copy; `--text-3` (3.3:1) is
used only for large/secondary meta text (file sizes, timestamps), never body
copy or button labels. White text on `--accent` is 4.6:1.

## Type

- **Display** — [Lexend](https://fonts.google.com/specimen/Lexend), a
  self-hosted variable font (weight axis 400–800). Chosen deliberately: Lexend
  is designed and tested to improve reading fluency, a direct thematic fit
  for a study/audiobook app rather than a decorative pick. Used for the
  brand wordmark, section headings, and the now-playing title.
- **Body** — [Plus Jakarta Sans](https://fonts.google.com/specimen/Plus+Jakarta+Sans),
  self-hosted variable (weight axis 300–800). Used for everything else: list
  rows, buttons, quiz copy, meta text.
- Both load from `/fonts/lexend-variable.woff2` and
  `/fonts/jakarta-variable.woff2` (single variable-font files, ~40KB/27KB),
  `font-display: swap`, fallback stack `system-ui, -apple-system, 'Segoe UI', sans-serif`.
  Self-hosted (not a Google Fonts CDN link) so the PWA app-shell cache in
  `sw.js` covers them and the fonts still render offline.

| Token | Weight/size/line-height | Face | Use |
|---|---|---|---|
| `--text-3xl` | 700 · 36px/1.1 | Lexend | Showcase hero only |
| `--text-2xl` | 700 · 26px/1.2 | Lexend | Brand wordmark ("study") |
| `--text-xl` | 600 · 20px/1.3 | Lexend | Section headings |
| `--text-lg` | 600 · 17px/1.35 | Lexend | Now-playing track title |
| `--text-md` | 600 · 15px/1.4 | Jakarta | Buttons, quiz question stems |
| `--text-base-md` | 500 · 14px/1.55 | Jakarta | List rows (track/book names) |
| `--text-base` | 400 · 14px/1.55 | Jakarta | Body copy, quiz explanations |
| `--text-sm` | 500 · 13px/1.5 | Jakarta | Secondary UI, quiz score |
| `--text-xs` | 500 · 12px/1.5 | Jakarta | Meta text: file size, clock, badges |
| `--text-2xs` | 600 · 11px/1.4, +.06em tracking | Jakarta | Eyebrow labels ("BOOK ONE") |

## Spacing, radius, shadow, motion

**Spacing** — 4px base scale: `--sp-1` 4px … `--sp-8` 32px (see showcase for
every step). Cards use `--sp-5`/`--sp-6` padding; list rows use `--sp-2`/`--sp-3`.

**Radius** — rounder at higher elevation: `--r-sm` 8px (small chips, close
button) · `--r-md` 14px (inputs, list rows, buttons) · `--r-lg` 20px (quiz
choice cards) · `--r-xl` 26px (now-playing, quiz panel) · `--r-pill` 999px
(all primary/secondary buttons, active nav, badges).

**Shadow** — tinted violet rather than neutral gray, so elevation reads as
part of the same light:
- `--shadow-sm` `0 1px 2px rgba(38,20,90,.06)` — resting cards, buttons
- `--shadow-md` `0 8px 24px -6px rgba(64,40,170,.16)` — now-playing, quiz panel, button hover
- `--shadow-lg` `0 20px 48px -14px rgba(56,32,160,.26)` — showcase motion-card hover
- `--shadow-glow` `0 0 0 6px var(--accent-soft)` — paired with `--shadow-md` on the primary play button, a soft halo marking it as the signature control

**Motion**:
- `--dur-fast` 120ms `--ease-out` — hover/press micro-interactions (buttons, list rows)
- `--dur-med` 220ms `--ease-out` — reveals (`rise` keyframe on quiz panel, book groups)
- `--dur-slow` 420ms `--ease-out` — page load-in (`#now-playing`)
- `--ease-spring` `cubic-bezier(.34,1.56,.64,1)` — press/hover overshoot on buttons and the showcase motion cards
- All animation/transition durations collapse to ~0 under `prefers-reduced-motion: reduce` (global rule at the top of `styles.css`)

## Components

- **Header brand mark** — `#library h1::before` masks `/favicon.svg` (alpha
  only) over a violet→blue gradient square, so the pencil mark and the
  gradient stay in sync with the token file automatically.
- **Buttons** — pill radius, three treatments: primary (solid `--accent`,
  white text, `--shadow-sm`, lifts + darkens on hover), secondary
  (`--surface-2` + border, tints violet on hover), disabled (50% opacity, no
  lift). Transport buttons are circular, not pill, to read as a control
  cluster.
- **Play/pause ring** (`.ring`, signature control) — a `conic-gradient` ring
  in `--accent-2` traces the current chapter's playback position around the
  primary transport button, updated every `timeupdate` tick
  (`app.js:updateClock`). Outsized (60px, 52px inner button) versus the other
  transport buttons (40px) per the "give the signature control an outsized
  treatment" principle.
- **Book gauge** (`.book-gauge`) — same `conic-gradient` technique, 20px, next
  to each book's name in the sidebar; shows chapters-finished as a ring
  instead of only the existing `N/M` count text.
- **List rows** (`#groups li`) — default state is transparent/`--text-2`;
  hover tints `--surface-2`; active state is a solid `--accent` pill with
  white text and `--shadow-sm` — mirrors the reference dashboards' active-nav
  treatment.
- **Quiz choice** (`.q-choice`) — default: white card with hairline border;
  hover: violet tint + border; **right**: `--good`/`--good-soft`; **wrong**:
  `--bad`/`--bad-soft`. Disabled radio state dims to 90% opacity rather than
  the browser default gray.
- **Badges** — quiz-score badge (`.quiz-badge`) uses `--accent-2-soft`/`--accent-2`
  (blue, not violet) to visually separate "quiz result" from "active/selected".
- **Type tabs** (`.type-tab`, `#type-tabs`) — equal-width flat tab row atop
  the sidebar list, one per library type (Books/Music/Other) that actually
  has content; auto-hidden when only one type exists. Default/hover mirror
  the button language (transparent → `--surface-2` tint); active state uses
  `--accent-soft`/`--accent-strong` (a *tint*, not the solid `--accent` fill
  list rows use) so the active tab reads as "selected filter" rather than
  "selected track".

## Backgrounds & texture

No generated imagery in this pass (references were UI screenshots, not
texture/art sources) — atmosphere comes from `--bg-grad`
(`linear-gradient(180deg, #f6f4fd, #eeeafa)`, fixed) under elevated white
cards with tinted shadows, matching the flat-color, soft-shadow language of
all three references. Revisit with generated texture/art if the direction
later wants more visual richness (e.g. a subtle paper-grain background).

## Sound

Out of scope for this pass (visual + motion only was not selected, but no
sound design was requested either — full identity here means color/type/
components/motion).

## Accessibility notes

- Text-on-surface contrast: `--text` 13.8:1, `--text-2` 6.3:1 on `--surface`
  (AAA/AA respectively); `--text-3` (3.3:1) reserved for meta text at 12px+,
  never body copy.
- White-on-`--accent` button text: 4.6:1 (AA).
- All interactive elements keep native focus; `:focus-visible` adds a 2px
  `--accent` outline with 2px offset (`styles.css` base rules) since several
  controls (transport buttons, quiz choices) have low default focus contrast
  in browser UA styles.
- `prefers-reduced-motion: reduce` zeroes all animation/transition durations
  globally — no separate opt-out needed per component.
- No mute control exists (no sound design in this pass).

## Asset inventory

| File | Role |
|---|---|
| `public/styles.css` | All design tokens + component styles |
| `public/fonts/lexend-variable.woff2` | Display face (self-hosted, Google Fonts Lexend, weight axis 400–800) |
| `public/fonts/jakarta-variable.woff2` | Body face (self-hosted, Google Fonts Plus Jakarta Sans, weight axis 300–800) |
| `public/favicon.svg` | Pencil mark, recolored violet→blue gradient; also used as the header brand-badge mask |
| `public/icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | PWA icons, regenerated via `tools/gen-icons.mjs` with the new `#6d5ef8` fill |
| `public/manifest.webmanifest` | `theme_color`/`background_color` updated to `#6d5ef8`/`#f3f1fb` |
| `public/design-system.html` | Static showcase page — every token/component rendered live from the real CSS |
| `DESIGN.md` | This document |

## Changelog

- **2026-09-13** — First design pass ("reading room"). Replaced the
  unstyled dark shell with the full light violet/blue system above: tokens,
  self-hosted type, restyled components, the play-ring + book-gauge signature
  motif, and this document + the showcase page. No prior `DESIGN.md` existed.
- **2026-09-13** — Library types moved from stacked section headers
  (`.type-head`) to a `.type-tab` row atop the sidebar; added the tab
  component here and to the showcase page.
