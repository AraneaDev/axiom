# Design Overhaul: "Soft Depth" Redesign

**Date:** 2026-03-22
**Status:** Approved
**Goal:** Drastically improve the visual design of Axiom to feel modern, warm, approachable, and highly readable -- inspired by Notion/Raycast aesthetics but with an elegant, refined personality.

---

## 1. Design Philosophy

- **Warm & approachable** -- not cold/corporate, not playful/childish
- **Readability is king** -- generous line-heights, clear hierarchy, excellent contrast
- **Soft depth** -- layered elevation with warm shadows, not flat or overly material
- **Unified** -- every surface, color, and component follows the same visual language
- **Dark mode as a first-class citizen** -- soft warm dark, not harsh true-black

---

## 2. Color System

### 2.1 Light Mode Tokens

```
--color-primary:          #6d5dca    (warm violet -- actions, links, active states)
--color-primary-hover:    #5a4cb5    (hover states)
--color-primary-light:    #f0edf9    (soft backgrounds for selected items)
--color-primary-muted:    #c4bce8    (badges, subtle fills)
--color-accent:           #0d9488    (teal -- secondary accent)
--color-accent-light:     #e6f7f5    (teal wash for stat cards, badges)
--color-danger:           #ef4444
--color-danger-light:     #fef2f2
--color-warning:          #f59e0b
--color-warning-light:    #fffbeb
--color-success:          #10b981
--color-success-light:    #ecfdf5

--color-surface:          #fefefe    (main background)
--color-surface-secondary:#fafaf8    (page background -- warm off-white)
--color-surface-tertiary: #f3f2ef    (nested/inset areas -- warm stone)
--color-surface-elevated: #ffffff    (cards, modals -- with shadow)
--color-surface-overlay:  rgba(255, 255, 255, 0.8)
--color-surface-inverse:  #1a1a1a

--color-border:           #e8e6e1    (warm default border)
--color-border-light:     #f0eeea    (subtle dividers)
--color-border-focus:     #6d5dca    (primary on focus)

--color-text:             #1a1a1a    (warm black)
--color-text-secondary:   #6b6b6b    (neutral gray)
--color-text-tertiary:    #9a9a9a    (hints, timestamps)
--color-text-inverse:     #ffffff
```

### 2.2 Dark Mode Tokens (Soft Warm)

```
--color-primary:          #9b8ade    (lighter violet for dark bg)
--color-primary-hover:    #b0a3e8
--color-primary-light:    #2a2540    (subtle violet wash)
--color-primary-muted:    #3d3566
--color-accent:           #2dd4bf    (bright teal pops on dark)
--color-accent-light:     #1a2f2d    (teal wash for stat cards, badges)
--color-danger:           #f87171
--color-danger-light:     #2a1215
--color-warning:          #fbbf24
--color-warning-light:    #2a2510
--color-success:          #34d399
--color-success-light:    #0d2a1f

--color-surface:          #1c1c1e    (warm near-black)
--color-surface-secondary:#161618    (page background)
--color-surface-tertiary: #252528    (inset areas)
--color-surface-elevated: #222225    (cards -- slightly lighter)
--color-surface-overlay:  rgba(28, 28, 30, 0.85)
--color-surface-inverse:  #ececec

--color-border:           #2e2e32    (warm dark border)
--color-border-light:     #252528    (subtle dividers)
--color-border-focus:     #9b8ade

--color-text:             #ececec    (warm white -- not pure #fff)
--color-text-secondary:   #a0a0a0
--color-text-tertiary:    #6b6b6b
--color-text-inverse:     #1a1a1a
```

### 2.3 Shadows

**Light mode:**
```
--shadow-sm:   0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02)
--shadow-md:   0 4px 12px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04)
--shadow-lg:   0 12px 24px rgba(0,0,0,0.08), 0 4px 8px rgba(0,0,0,0.04)
--shadow-glow: 0 0 0 3px rgba(109, 93, 202, 0.15)
```

**Dark mode:**
```
--shadow-sm:   0 1px 3px rgba(0,0,0,0.2), 0 1px 2px rgba(0,0,0,0.15)
--shadow-md:   0 4px 12px rgba(0,0,0,0.3), 0 1px 3px rgba(0,0,0,0.2)
--shadow-lg:   0 12px 24px rgba(0,0,0,0.4), 0 4px 8px rgba(0,0,0,0.25)
--shadow-glow: 0 0 0 3px rgba(155, 138, 222, 0.2)
```

---

## 3. Typography

### 3.1 Font Stack

- **Sans:** `'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
- **Mono:** `'Geist Mono', 'JetBrains Mono', 'Fira Code', monospace`

Install via npm: `@fontsource-variable/geist` and `@fontsource-variable/geist-mono`

### 3.2 Type Scale

| Element | Size | Weight | Tracking | Line-height |
|---------|------|--------|----------|-------------|
| Page title (h1) | 28px | 650 (variable font; use Tailwind `font-[650]`) | -0.02em | 1.2 |
| Section head (h2) | 22px | 600 | -0.015em | 1.3 |
| Card title (h3) | 17px | 600 | normal | 1.4 |
| Body text | 14px | 400 | normal | 1.6 |
| Section labels | 13px | 500 | 0.04em (uppercase) | 1.0 |
| Small / timestamps | 12px | 400 | normal | 1.4 |
| Code elements (issue keys, branch names) | inherit | 400 | normal | inherit (uses Geist Mono) |

---

## 4. Component Design Language

### 4.1 Cards
- Border radius: 12px
- Border: 1px solid `border-light`
- Background: `surface-elevated` with `shadow-sm`
- Hover (clickable cards): lift to `shadow-md`, border transitions to `border`. 150ms ease
- No double borders -- shadow for clickable, border for static

### 4.2 Stat Cards (Dashboard)
- Icon gets a soft tinted circle background:
  - Issues icon: `primary-light` background, `primary` icon color
  - PRs / Review icon: `accent-light` background, `accent` icon color
  - Due dates icon: `warning-light` background, `warning` icon color
  - Activity icon: `success-light` background, `success` icon color
- Number: 24px / 650 weight
- Label: 13px / `text-tertiary`

### 4.3 Sidebar
- Background: `surface` (not a separate color band)
- Active item: `primary-light` fill, `primary` text, rounded 8px
- Hover: `surface-tertiary` background, 150ms ease
- Section labels: 11px / 500 / uppercase / tracked / `text-tertiary`
- 24px gap between sections

### 4.4 Buttons
- Primary: `primary` bg, white text, `shadow-sm`, rounded 8px. Hover darkens + lifts
- Secondary/Ghost: transparent bg, `text-secondary`, hover gets `surface-tertiary` fill
- All: 36px height, 13px/500 text, 16px icons
- Danger: red bg only on final destructive action, not the trigger

### 4.5 Inputs
- Border: `border` color, rounded 8px
- Focus: `border-focus` + `shadow-glow`
- Background: `surface` (not transparent)
- Height: 36px

### 4.6 Badges / Labels
- Pill shape (radius-full)
- Soft colors: `-light` background + corresponding text color
- Status dots: 8px, subtle pulse animation for "In Progress"

### 4.7 Tables / Issue Lists
- Row hover: `surface-tertiary` background
- Row separator: 1px `border-light`
- Selected row: `primary-light` wash
- Status conveyed by badge color, not left border bar

---

## 5. Layout & Spacing

### 5.1 Spacing Scale
4px base grid: 4, 8, 12, 16, 20, 24, 32, 40, 48

### 5.2 Page Layout
- Max content width: none (full-width). Content padding provides breathing room. Revisit if specific pages look too stretched
- Content padding: 32px horizontal, 24px vertical
- Card grid gaps: 16px

### 5.3 Dashboard
- Stat cards: equal-width 4-column grid, 16px gap
- Content grid: 2-column 60/40 split
- Organizations/Teams: full-width below, 32px top margin

### 5.4 Sidebar
- Width: 240px
- Item padding: 12px horizontal, 8px vertical
- Section gap: 24px
- Bottom-pinned items: 16px from bottom

### 5.5 Header
- Height: 52px
- Search bar: centered, 400px max-width, `surface-tertiary` bg, pill shape (rounded-full)
- Right icons: 32px touch targets, `text-secondary`, hover to `text`

---

## 6. Dark Mode Fix

### 6.1 Core Fix
1. Verify toggle applies `.dark` class on `<html>` and persists to `localStorage`
2. Audit all components for hardcoded Tailwind colors -- replace with design tokens
3. Every `bg-white`, `text-gray-*`, `border-slate-*` must become `bg-surface`, `text-secondary`, `border` etc.

### 6.2 Dark Mode Polish
- Elevation through surface lightness, not shadow (shadows barely visible on dark)
- Borders: barely perceptible dividers
- Primary: lighter violet for contrast (WCAG AA)
- Syntax highlighting: warm-tinted dark theme
- Smooth theme transition: apply `transition: background-color 150ms ease, color 150ms ease, border-color 150ms ease` to `body, .sidebar, .header, [class*="surface"], [class*="card"], button, input, a` (targeted selectors, not `*` which causes performance issues)

---

## 7. Login Page

- Split layout: info left, form right
- Left panel: warm gradient background `linear-gradient(135deg, #4a3d8f 0%, #0d9488 100%)`, white text
- Right panel: `surface` background, centered form with 40px padding
- Inputs: 36px height, 8px radius, warm borders
- Sign in button: full-width, `primary` bg, 40px height
- Feel: calm, confident, premium

---

## 8. Scope & Constraints

- All icons remain Lucide -- no change
- No emojis anywhere
- Every button keeps an icon
- All existing CSS variable names stay the same -- only values change. New tokens added: `accent-light` (both light and dark variants)
- Tokens not in CLAUDE.md's "Available tokens" list but present in `index.css` and used by this spec: `primary-muted`, `surface-overlay`, `surface-inverse`, `text-inverse`. Update CLAUDE.md token list during implementation
- Component structure stays the same -- this is a visual reskin, not a structural rewrite
- Geist fonts loaded via npm (self-hosted), no external CDN
- Font weight `650` requires Geist as a variable font (`@fontsource-variable/geist`). Use Tailwind arbitrary value `font-[650]`
