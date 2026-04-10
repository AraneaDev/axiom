# Theme & Design System Overhaul

**Date:** 2026-04-10
**Status:** Approved

## Overview

Modernize the Axiom UI with an electric purple, dark-first aesthetic with hacker undertones. Fix consistency issues across pages by standardizing spacing, typography, and extracting shared components.

Two phases, each independently shippable:
- **Phase 1:** Token swap in `index.css` (instant visual upgrade)
- **Phase 2:** Component consolidation + page consistency pass

## Design Direction

- Electric purple primary, cyan accent
- Cool zinc-based grays (no warm tones)
- Dark mode is the "hero" experience (Linear-depth, not OLED)
- Crisp 6-8px radii, clean borders, smooth 150ms transitions
- Hacker aesthetic through color and sharpness, not gimmicks

---

## Phase 1: Token Swap

All changes in `frontend/src/index.css`. Every component and page updates automatically since the codebase uses CSS variable tokens with zero hardcoded colors.

### Primary & Semantic Colors

| Token | Light | Dark |
|---|---|---|
| `primary` | `#7c3aed` | `#a78bfa` |
| `primary-hover` | `#6d28d9` | `#c4b5fd` |
| `primary-light` | `#ede9fe` | `#1e1637` |
| `primary-muted` | `#a78bfa` | `#4c1d95` |
| `accent` | `#06b6d4` | `#22d3ee` |
| `accent-light` | `#ecfeff` | `#0c2a30` |
| `danger` | `#ef4444` | `#f87171` |
| `danger-light` | `#fef2f2` | `#2a1215` |
| `warning` | `#f59e0b` | `#fbbf24` |
| `warning-light` | `#fffbeb` | `#2a2510` |
| `success` | `#10b981` | `#34d399` |
| `success-light` | `#ecfdf5` | `#0d2a1f` |

### Surfaces

| Token | Light | Dark |
|---|---|---|
| `surface` | `#fafafa` | `#0c0d10` |
| `surface-secondary` | `#f4f4f6` | `#0a0a0c` |
| `surface-tertiary` | `#e8e8ec` | `#16171c` |
| `surface-elevated` | `#ffffff` | `#1a1b22` |
| `surface-overlay` | `rgba(250,250,250,0.8)` | `rgba(12,13,16,0.85)` |
| `backdrop` | `rgba(0,0,0,0.5)` | `rgba(0,0,0,0.7)` |
| `surface-inverse` | `#18181b` | `#ececef` |

### Text

| Token | Light | Dark |
|---|---|---|
| `text` | `#18181b` | `#ececef` |
| `text-secondary` | `#52525b` | `#a1a1aa` |
| `text-tertiary` | `#a1a1aa` | `#52525b` |
| `text-inverse` | `#ffffff` | `#18181b` |

### Borders

| Token | Light | Dark |
|---|---|---|
| `border` | `#e4e4e7` | `#27272a` |
| `border-light` | `#f0f0f2` | `#1e1e22` |
| `border-focus` | `#7c3aed` | `#a78bfa` |

### Shadows (Cool-Tinted)

**Light mode:**
- `shadow-sm`: `0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.03)`
- `shadow-md`: `0 4px 12px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.05)`
- `shadow-lg`: `0 12px 24px rgba(0,0,0,0.10), 0 4px 8px rgba(0,0,0,0.06)`
- `shadow-glow`: `0 0 0 3px rgba(124, 58, 237, 0.15)`

**Dark mode:**
- `shadow-sm`: `0 1px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.2)`
- `shadow-md`: `0 4px 12px rgba(0,0,0,0.4), 0 1px 3px rgba(0,0,0,0.3)`
- `shadow-lg`: `0 12px 24px rgba(0,0,0,0.5), 0 4px 8px rgba(0,0,0,0.3)`
- `shadow-glow`: `0 0 0 3px rgba(167, 139, 250, 0.2)`

### Chart Palette

**Light:**
`#7c3aed`, `#06b6d4`, `#e87b35`, `#3b82f6`, `#ec4899`, `#84cc16`, `#f59e0b`, `#8b5cf6`

**Dark (brighter):**
`#a78bfa`, `#22d3ee`, `#f5a060`, `#60a5fa`, `#f472b6`, `#a3e635`, `#fbbf24`, `#c4b5fd`

**Sequential (primary shades):**
Light: `rgba(124,58,237, 0.2/0.4/0.6/0.8/1.0)`
Dark: `rgba(167,139,250, 0.2/0.4/0.6/0.8/1.0)`

### Card Color Coding

| Token | Value |
|---|---|
| `card-color-critical` | `var(--color-danger)` |
| `card-color-high` | `oklch(0.65 0.18 25)` |
| `card-color-medium` | `oklch(0.75 0.15 85)` |
| `card-color-low` | `oklch(0.7 0.12 145)` |
| `card-color-bug` | `var(--color-danger)` |
| `card-color-story` | `oklch(0.65 0.15 250)` |
| `card-color-task` | `oklch(0.7 0.12 145)` |
| `card-color-epic` | `oklch(0.6 0.2 300)` |

*(Card color coding unchanged — these are semantic and work with both palettes.)*

---

## Phase 2: Consistency & Component Consolidation

### Typography Rules

| Context | Class | Spec |
|---|---|---|
| Page title | `.h2` | 1.375rem / 600 / -0.015em |
| Section title | `.h3` | 1.0625rem / 600 |
| Label/caption | `.h4` | 0.875rem / 600 |
| Body | default | 0.875rem / 400 / 1.6 |
| Small/meta | `text-xs` | 0.75rem |

**Rule:** Pages never use raw `text-2xl font-bold` or `text-lg font-semibold`. Always use `.h2`/`.h3`/`.h4` or `PageHeader`.

### Spacing Standards

| Context | Value |
|---|---|
| Page padding | `px-6 py-5` (PageLayout only) |
| Section gap | `gap-6` |
| Card internal padding | `p-5` |
| Card header-to-content | `gap-4` |
| Dense list items | `px-4 py-2.5` |
| Sidebar sections | `gap-5` |

**Rule:** Use `gap-*` (flexbox/grid) over `space-y-*` everywhere.

### Transition Standards

| Context | Value |
|---|---|
| Color/bg changes | `transition-colors duration-150` |
| Layout shifts | `transition-all duration-200` |
| Modal/overlay | `duration-150 ease-out` |

### New Shared Components

#### StatCard
Location: `frontend/src/components/ui/StatCard.tsx`

```
Props: {
  label: string
  value: string | number
  change?: number        // percentage change, shows +/- indicator
  changeLabel?: string   // e.g. "vs last week"
  icon: LucideIcon
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'danger'
}
```

Styling: `Card` with `p-5`, icon top-left, value prominent, change indicator bottom.

Replaces: Dashboard inline stat cards, analytics summary cards.

#### MetricRow
Location: `frontend/src/components/ui/MetricRow.tsx`

```
Props: {
  label: string
  value: ReactNode
  icon?: LucideIcon
}
```

Styling: Horizontal flex, label `text-text-secondary text-sm`, value `text-sm font-medium`.

Replaces: Repeated label/value pairs in issue detail sidebar, PR sidebar, repo overview.

### Card Standardization

All cards must use:
- `rounded-lg border border-border bg-surface-elevated p-5`
- Clickable: add `hover:border-primary/40 hover:shadow-sm transition-colors duration-150`
- No `rounded-xl`, no `border-border-light`, no `p-4`/`p-6` variance

### PageHeader Enforcement

Pages that must switch to `<PageHeader>`:
- `Dashboard.tsx` — currently builds custom title with flex layout
- `TeamAnalytics.tsx` — currently builds custom title with icon + text
- `OrgAnalytics.tsx` — if applicable

### Pages Requiring Consistency Updates

1. **Dashboard** — StatCard extraction, PageHeader, card padding `p-5`, section `gap-6`
2. **TeamAnalytics / OrgAnalytics** — PageHeader, consistent Card usage
3. **IssueList** — Card styling alignment
4. **IssueDetail** — MetricRow in sidebar, section spacing

### Pages That Need No Changes
- Settings/Profile (already use Card + PageHeader)
- Wiki pages
- Auth pages

### What We Don't Touch
- Component internals (Button, Badge, Modal, etc.) — tokens handle it
- Routing, data fetching, business logic — zero functional changes
- Layout structure (AppShell, Sidebar, PageLayout) — structure is sound

---

## Success Criteria

1. All pages use the new palette via tokens — no hardcoded colors
2. Dark mode is visually cohesive and feels like the primary experience
3. Every page uses `PageHeader` for titles
4. All cards use standardized Card styling with `p-5`
5. Stat displays use shared `StatCard` component
6. Sidebar metrics use shared `MetricRow` component
7. Spacing uses `gap-*` consistently, matches the defined scale
8. Typography uses `.h2`/`.h3`/`.h4` hierarchy, no ad-hoc sizing
9. All transitions follow the standardized durations
10. `npx tsc --noEmit` passes, `npm run check` passes
