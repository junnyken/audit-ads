# U1 dashboard — third-party licences (U1a)

Read from each package's `license` field (`npm view`, 2026-10-27) and, for the two font
packages, from the `LICENSE` file shipped in the package (SIL Open Font License 1.1). The
projects' own licence web pages were **not** opened; this is the package metadata.

| Package | Licence | Used for | Ships in bundle |
|---|---|---|---|
| `@fontsource/be-vietnam-pro` | OFL-1.1 | UI font, self-hosted woff2 (vietnamese + latin, 400/500/600/700) | yes (font files) |
| `@fontsource-variable/jetbrains-mono` | OFL-1.1 | ids and raw amounts, self-hosted woff2 | yes (font files) |
| `lucide-react` | ISC | icons (tree-shaken per icon) | yes |
| `@radix-ui/react-dialog`, `react-dropdown-menu` (2.1.16), `react-tooltip` (1.2.8), `react-slot` | MIT | Sheet, menus, tooltip primitives | yes |
| `class-variance-authority` | **Apache-2.0** (the U1 spec said MIT) | Button variants | yes |
| `clsx`, `tailwind-merge` | MIT | class merging | yes |
| `tailwindcss-animate` | MIT | Sheet / menu enter-exit animation | build-time CSS |
| `axe-core` | MPL-2.0 | accessibility checks in tests | dev only |
| `vitest-axe` | MIT | axe wrapper for vitest | dev only |

The shadcn/ui components in `frontend/src/components/primitives/` are copied in (MIT) and
re-pointed at the project's tokens.

`@radix-ui/react-dropdown-menu` and `react-tooltip` are pinned to the 2.1.x / 1.2.x lines. The
newer lines were tried first; the pin is not a proven fix for anything (the jsdom hang described
in `TEST_LOG.md` happened on both), so it may be relaxed.
