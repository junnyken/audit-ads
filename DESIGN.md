# AdsOps Pro — Design System v5.0 ("Impeccable Studio")

**Architecture:** Synchronized Visual Language across Windows Desktop App (`desktop/DesktopUi`) and Commercial Web Console (`frontend/src`).
**Aesthetic Direction:** **Obsidian Dark & Alabaster Light + Precision Cobalt** — inspired by Linear, Raycast, and Mercury Studio.

---

## 1. Core Impeccable Principles (Anti-Slop Rules)

1. **Zero Cards-Within-Cards:** Never nest bordered boxes inside bordered boxes. Group related items using a single `1px` outer container with `divide-x` / `divide-y` hairlines, generous whitespace, and clear typographic hierarchy.
2. **Maximum One Primary CTA per Screen / Toolbar:** Reserve solid `Precision Cobalt` (`bg-primary` / `bg-brand`) strictly for the single primary action in a toolbar or view (e.g., `Auto-Pilot`, `+ Thêm hồ sơ`, `Chạy Kịch Bản Ngay`). All secondary and row-level actions use quiet ghost, subtle outline, hover-reveal, or `⋯` overflow menus.
3. **Progressive Disclosure First:** Filter bars stay on **one clean line**. Secondary filters, engine/proxy selectors, and multi-option switches live inside a `+ Bộ lọc` Popover or Drawer rather than 2–3 rows of chip walls.
4. **StatusDots Over Neon Badges:** Replace heavy colored rectangle pills (`LIVE`, `ACTIVE`, `Sẵn sàng Ads`) with clean `6px` luminous `StatusDot` indicators + muted typographic tags. Keep `TrustRing` circular gauges instead of thick warning progress bars.
5. **Mute Zeros, Illuminate Signal:** Right-aligned monetary columns use `JetBrains Mono` (`tabular-nums`). Zero and placeholder values (`0 VND`, `0 USD`, `0`, `—`, `HN: —`) are muted (`35–45%` opacity) so real balances, spend spikes, and critical risks stand out effortlessly.
6. **Zero Decorative Emojis:** Never place Unicode emojis in commercial SaaS controls, headings, cards, or tables. Use crisp `14px–16px` `lucide-react` strokes (`strokeWidth={1.75}`) consistently.

---

## 2. Surface & Color Tokens

### Web (`frontend/src/tokens.css`) — RGB Channel Tokens
| Token | Alabaster Light (`:root`) | Obsidian Dark (`.dark`) | Role |
| :--- | :--- | :--- | :--- |
| `--bg` | `248 250 252` (`#F8FAFC`) | `10 12 16` (`#0A0C10`) | Canvas background |
| `--surface` | `255 255 255` (`#FFFFFF`) | `17 20 26` (`#11141A`) | Primary panels & cards |
| `--surface-2` | `241 245 249` (`#F1F5F9`) | `23 27 35` (`#171B23`) | Sunken containers & table heads |
| `--border` | `226 232 240` (`#E2E8F0`) | `36 41 51` (`#242933`) | Subtle `1px` hairlines |
| `--border-strong` | `203 213 225` (`#CBD5E1`) | `55 62 77` (`#373E4D`) | Interactive inputs & active outlines |
| `--fg` | `15 23 42` (`#0F172A`) | `244 246 250` (`#F4F6FA`) | Primary ink |
| `--fg-muted` | `71 85 105` (`#475569`) | `164 172 186` (`#A4ACBA`) | Secondary labels |
| `--fg-faint` | `82 94 112` (`#525E70`) | `134 142 158` (`#868E9E`) | Metadata (WCAG AA >= 4.5:1 on `--surface-2`) |
| `--brand` | `37 99 235` (`#2563EB`) | `59 130 246` (`#3B82F6`) | Primary CTA accent (Cobalt) |

### Desktop App (`desktop/DesktopUi/src/index.css`) — HSL Tokens
- Preserves `--primary: 221.2 83.2% 53.3%` in `.light` and `--primary: 217.2 91.2% 59.8%` in `.dark` for automated `--self-test` parity.
- Calibrated Obsidian depth: `--background: 222 24% 5%; --card: 222 22% 8%; --popover: 222 22% 10%; --border: 220 18% 14.5%;`.
- Supports user-selectable **Density Mode** (`airy` / `compact`) via `data-density` on `<html>`.

---

## 3. Shared Studio Primitives

- **`StatusDot`**: `6px` status indicator dot + single-line semantic label (`live`, `warning`, `critical`, `info`, `muted`).
- **`TrustRing`**: Compact `28px` SVG radial gauge (`>=70` emerald, `>=45` amber, `<45` rose) paired with 3 micro signal dots (`CK · 2FA · Mail`).
- **`SegmentedTabs`**: Tonal segmented tab switcher inside a `1px` sunken track.
- **`FilterPopover`**: Single `+ Bộ lọc` trigger opening an anchored popover containing secondary filter chips, dropdown selects, and reset action.
- **`FinancialValue`**: `font-mono tabular-nums` formatter that automatically softens zero/empty strings (`0 VND`, `0 USD`, `—`).
- **`InspectorDrawer`**: Right-hand slide-over detail sheet keeping main tables calm and single-click inspectable.

---

## 4. Automated Guardrails

- **Website:** Every modified page must pass `frontend/src/test/tone-classes.test.ts` (WCAG AA >= 4.5:1 contrast across light/dark), zero-emoji checks, `i18n.parity.test.ts`, and `axe` zero accessibility violations (`u1b`, `appshell`, etc.). Zero raw Tailwind color classes (`bg-emerald-*`, `text-slate-*`, etc.) may be introduced in new or edited files.
- **Desktop:** `DesktopUi` must build cleanly (`npm run build`), maintain `MISSING_IN_CS = 0` IPC command parity, preserve all `.light`/`.dark` HSL primary assertions in `Program.cs` Section 47, and pass `AdsOpsDesktop.exe --self-test` (`ADSOPS_DESKTOP_V260_SELFTEST_100_PASS`).
