# Theme & Design System Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modernize Axiom's visual identity with an electric purple, dark-first palette and fix consistency issues across all pages.

**Architecture:** Phase 1 swaps all CSS variable tokens in `index.css` — every component and page updates automatically since the codebase uses tokens exclusively. Phase 2 extracts shared components (StatCard, MetricRow), enforces PageHeader everywhere, and standardizes spacing/typography across pages.

**Tech Stack:** Tailwind CSS 4 with CSS variable design tokens, React 19, Lucide React icons.

**Spec:** `docs/superpowers/specs/2026-04-10-theme-design-system-design.md`

---

## Task 1: Token Swap — Core Palette & Surfaces

**Files:**
- Modify: `frontend/src/index.css:4-82` (light theme tokens)

- [ ] **Step 1: Replace light mode @theme tokens**

Replace lines 4-82 of `frontend/src/index.css` with:

```css
@theme {
  /* Core palette */
  --color-primary: #7c3aed;
  --color-primary-hover: #6d28d9;
  --color-primary-light: #ede9fe;
  --color-primary-muted: #a78bfa;
  --color-accent: #06b6d4;
  --color-accent-light: #ecfeff;
  --color-danger: #ef4444;
  --color-danger-light: #fef2f2;
  --color-warning: #f59e0b;
  --color-warning-light: #fffbeb;
  --color-success: #10b981;
  --color-success-light: #ecfdf5;

  /* Surfaces */
  --color-surface: #fafafa;
  --color-surface-secondary: #f4f4f6;
  --color-surface-tertiary: #e8e8ec;
  --color-surface-elevated: #ffffff;
  --color-surface-overlay: rgba(250, 250, 250, 0.8);
  --color-backdrop: rgba(0, 0, 0, 0.5);
  --color-surface-inverse: #18181b;

  /* Borders */
  --color-border: #e4e4e7;
  --color-border-light: #f0f0f2;
  --color-border-focus: #7c3aed;

  /* Text */
  --color-text: #18181b;
  --color-text-secondary: #52525b;
  --color-text-tertiary: #a1a1aa;
  --color-text-inverse: #ffffff;

  /* Fonts */
  --font-sans: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-mono: 'Geist Mono', 'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, monospace;

  /* Shadows — cool-tinted */
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.03);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.05);
  --shadow-lg: 0 12px 24px rgba(0, 0, 0, 0.10), 0 4px 8px rgba(0, 0, 0, 0.06);
  --shadow-glow: 0 0 0 3px rgba(124, 58, 237, 0.15);

  /* Card color coding */
  --card-color-critical: var(--color-danger);
  --card-color-high: oklch(0.65 0.18 25);
  --card-color-medium: oklch(0.75 0.15 85);
  --card-color-low: oklch(0.7 0.12 145);
  --card-color-bug: var(--color-danger);
  --card-color-story: oklch(0.65 0.15 250);
  --card-color-task: oklch(0.7 0.12 145);
  --card-color-epic: oklch(0.6 0.2 300);

  /* Radii */
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-full: 9999px;

  /* Chart palette — categorical */
  --color-chart-1: #7c3aed;
  --color-chart-2: #06b6d4;
  --color-chart-3: #e87b35;
  --color-chart-4: #3b82f6;
  --color-chart-5: #ec4899;
  --color-chart-6: #84cc16;
  --color-chart-7: #f59e0b;
  --color-chart-8: #8b5cf6;

  /* Chart palette — sequential */
  --color-chart-seq-1: rgba(124, 58, 237, 0.2);
  --color-chart-seq-2: rgba(124, 58, 237, 0.4);
  --color-chart-seq-3: rgba(124, 58, 237, 0.6);
  --color-chart-seq-4: rgba(124, 58, 237, 0.8);
  --color-chart-seq-5: #7c3aed;
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd /root/axiom/frontend && npx tsc --noEmit`
Expected: PASS (no type errors — CSS-only change)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/index.css
git commit -m "style: swap light mode tokens to electric purple + cool zinc palette"
```

---

## Task 2: Token Swap — Dark Mode

**Files:**
- Modify: `frontend/src/index.css:84-137` (dark mode overrides)

- [ ] **Step 1: Replace dark mode tokens**

Replace lines 85-137 (the `.dark { ... }` block contents) with:

```css
.dark {
  --color-primary: #a78bfa;
  --color-primary-hover: #c4b5fd;
  --color-primary-light: #1e1637;
  --color-primary-muted: #4c1d95;
  --color-accent: #22d3ee;
  --color-accent-light: #0c2a30;
  --color-danger: #f87171;
  --color-danger-light: #2a1215;
  --color-warning: #fbbf24;
  --color-warning-light: #2a2510;
  --color-success: #34d399;
  --color-success-light: #0d2a1f;

  --color-surface: #0c0d10;
  --color-surface-secondary: #0a0a0c;
  --color-surface-tertiary: #16171c;
  --color-surface-elevated: #1a1b22;
  --color-surface-overlay: rgba(12, 13, 16, 0.85);
  --color-backdrop: rgba(0, 0, 0, 0.7);
  --color-surface-inverse: #ececef;

  --color-border: #27272a;
  --color-border-light: #1e1e22;
  --color-border-focus: #a78bfa;

  --color-text: #ececef;
  --color-text-secondary: #a1a1aa;
  --color-text-tertiary: #52525b;
  --color-text-inverse: #18181b;

  /* Chart palette — categorical (brighter for dark backgrounds) */
  --color-chart-1: #a78bfa;
  --color-chart-2: #22d3ee;
  --color-chart-3: #f5a060;
  --color-chart-4: #60a5fa;
  --color-chart-5: #f472b6;
  --color-chart-6: #a3e635;
  --color-chart-7: #fbbf24;
  --color-chart-8: #c4b5fd;

  /* Chart palette — sequential */
  --color-chart-seq-1: rgba(167, 139, 250, 0.2);
  --color-chart-seq-2: rgba(167, 139, 250, 0.4);
  --color-chart-seq-3: rgba(167, 139, 250, 0.6);
  --color-chart-seq-4: rgba(167, 139, 250, 0.8);
  --color-chart-seq-5: #a78bfa;

  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.3), 0 1px 2px rgba(0, 0, 0, 0.2);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4), 0 1px 3px rgba(0, 0, 0, 0.3);
  --shadow-lg: 0 12px 24px rgba(0, 0, 0, 0.5), 0 4px 8px rgba(0, 0, 0, 0.3);
  --shadow-glow: 0 0 0 3px rgba(167, 139, 250, 0.2);
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd /root/axiom/frontend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/index.css
git commit -m "style: swap dark mode tokens to deep dark + bright violet palette"
```

---

## Task 3: Update Card Component — Use `bg-surface-elevated`

**Files:**
- Modify: `frontend/src/components/ui/Card.tsx`

The Card component currently uses `bg-surface`. Per the spec, cards should use `bg-surface-elevated` to lift off the page background.

- [ ] **Step 1: Update Card base class**

In `Card.tsx`, change the Card component's className from:
```tsx
'rounded-lg border border-border bg-surface'
```
to:
```tsx
'rounded-lg border border-border bg-surface-elevated'
```

- [ ] **Step 2: Verify compilation**

Run: `cd /root/axiom/frontend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ui/Card.tsx
git commit -m "style: update Card to use bg-surface-elevated for depth"
```

---

## Task 4: Update PageHeader — Use `.h2` Typography

**Files:**
- Modify: `frontend/src/components/ui/PageHeader.tsx`

PageHeader currently uses `text-2xl font-bold`. Per the typography spec, page titles use `.h2` class (1.375rem / 600 / -0.015em).

- [ ] **Step 1: Update PageHeader title class**

In `PageHeader.tsx`, change the title element's className from:
```tsx
'text-2xl font-bold'
```
to:
```tsx
'h2'
```

- [ ] **Step 2: Verify compilation**

Run: `cd /root/axiom/frontend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ui/PageHeader.tsx
git commit -m "style: update PageHeader title to use .h2 typography class"
```

---

## Task 5: Update PageLayout — Standardize Padding

**Files:**
- Modify: `frontend/src/components/layout/PageLayout.tsx`

PageLayout currently uses `px-6 py-4`. Spec says `px-6 py-5`.

- [ ] **Step 1: Update padding in both layout branches**

In `PageLayout.tsx`, replace all instances of `py-4` with `py-5`:
- The no-sidebar branch: `px-6 py-4` → `px-6 py-5`
- The sidebar branch: `px-6 py-4` → `px-6 py-5`

- [ ] **Step 2: Verify compilation**

Run: `cd /root/axiom/frontend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/layout/PageLayout.tsx
git commit -m "style: standardize PageLayout padding to px-6 py-5"
```

---

## Task 6: Create StatCard Component

**Files:**
- Create: `frontend/src/components/ui/StatCard.tsx`

- [ ] **Step 1: Create StatCard component**

```tsx
import { forwardRef } from 'react';
import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const variantStyles = {
  default: {
    icon: 'text-text-secondary bg-surface-tertiary',
  },
  primary: {
    icon: 'text-primary bg-primary-light',
  },
  success: {
    icon: 'text-success bg-success-light',
  },
  warning: {
    icon: 'text-warning bg-warning-light',
  },
  danger: {
    icon: 'text-danger bg-danger-light',
  },
};

interface StatCardProps {
  label: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
  icon: LucideIcon;
  variant?: keyof typeof variantStyles;
  className?: string;
}

export const StatCard = forwardRef<HTMLDivElement, StatCardProps>(
  ({ label, value, change, changeLabel, icon: Icon, variant = 'default', className }, ref) => {
    const styles = variantStyles[variant];

    return (
      <div
        ref={ref}
        className={cn(
          'rounded-lg border border-border bg-surface-elevated p-5',
          className
        )}
      >
        <div className="flex items-center gap-4">
          <div className={cn('rounded-lg p-2.5', styles.icon)}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-text-tertiary">{label}</p>
            <p className="text-2xl font-semibold tabular-nums leading-tight mt-0.5">{value}</p>
          </div>
        </div>
        {change !== undefined && (
          <div className="mt-3 flex items-center gap-1.5 text-xs">
            <span
              className={cn(
                'font-medium',
                change > 0 && 'text-success',
                change < 0 && 'text-danger',
                change === 0 && 'text-text-tertiary'
              )}
            >
              {change > 0 ? '+' : ''}{change}%
            </span>
            {changeLabel && <span className="text-text-tertiary">{changeLabel}</span>}
          </div>
        )}
      </div>
    );
  }
);

StatCard.displayName = 'StatCard';
```

- [ ] **Step 2: Verify compilation**

Run: `cd /root/axiom/frontend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ui/StatCard.tsx
git commit -m "feat: add shared StatCard component for metric displays"
```

---

## Task 7: Create MetricRow Component

**Files:**
- Create: `frontend/src/components/ui/MetricRow.tsx`

- [ ] **Step 1: Create MetricRow component**

```tsx
import { forwardRef, type ReactNode } from 'react';
import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MetricRowProps {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  className?: string;
}

export const MetricRow = forwardRef<HTMLDivElement, MetricRowProps>(
  ({ label, value, icon: Icon, className }, ref) => {
    return (
      <div ref={ref} className={cn('flex items-center justify-between py-1.5', className)}>
        <span className="flex items-center gap-2 text-sm text-text-secondary">
          {Icon && <Icon className="h-3.5 w-3.5" />}
          {label}
        </span>
        <span className="text-sm font-medium">{value}</span>
      </div>
    );
  }
);

MetricRow.displayName = 'MetricRow';
```

- [ ] **Step 2: Verify compilation**

Run: `cd /root/axiom/frontend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ui/MetricRow.tsx
git commit -m "feat: add shared MetricRow component for label/value pairs"
```

---

## Task 8: Refactor Dashboard — StatCard + PageHeader + Spacing

**Files:**
- Modify: `frontend/src/pages/dashboard/Dashboard.tsx`

This is the biggest page cleanup. The Dashboard currently:
- Builds custom stat cards inline with `rounded-xl border-border-light bg-surface-elevated p-4`
- Builds a custom title bar instead of using `PageHeader`
- Uses `space-y-8` for section spacing

Changes:
1. Import and use `PageHeader` for the title
2. Import and use `StatCard` for the 4 quick stats
3. Change section spacing from `space-y-8` to `flex flex-col gap-6`
4. Standardize widget cards to consistent styling

- [ ] **Step 1: Read Dashboard.tsx current contents**

Read the full file to get exact line numbers for edits.

- [ ] **Step 2: Add imports for PageHeader and StatCard**

Add to the imports section:
```tsx
import { PageHeader } from '@/components/ui/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
```

- [ ] **Step 3: Replace custom title bar with PageHeader**

Find the custom title section (the `text-2xl font-bold` title div) and replace it with:
```tsx
<PageHeader title="Dashboard">
  {/* existing action buttons */}
</PageHeader>
```

- [ ] **Step 4: Replace inline stat cards with StatCard component**

Find the stats grid section and replace the 4 inline stat card `<div>` elements with `<StatCard>` components using the appropriate `icon`, `label`, `value`, and `variant` props.

- [ ] **Step 5: Standardize section spacing**

Replace the outer container's `space-y-8` with `flex flex-col gap-6`.

- [ ] **Step 6: Standardize card padding**

Ensure all card/widget containers use `p-5` padding and `rounded-lg border border-border bg-surface-elevated`.

- [ ] **Step 7: Verify compilation**

Run: `cd /root/axiom/frontend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/dashboard/Dashboard.tsx
git commit -m "refactor: Dashboard to use PageHeader, StatCard, standardized spacing"
```

---

## Task 9: Refactor TeamAnalytics — PageHeader + Spacing

**Files:**
- Modify: `frontend/src/pages/analytics/TeamAnalytics.tsx`

TeamAnalytics currently:
- Builds a custom title bar with icon + `text-2xl font-semibold`
- Uses sidebar stat cards with `Card className="p-4"` (should be `p-5`)
- Uses `space-y-6` and `space-y-4` (should be `gap-6` and `gap-5`)

- [ ] **Step 1: Read TeamAnalytics.tsx current contents**

Read the full file to get exact line numbers.

- [ ] **Step 2: Replace custom title with PageHeader**

Find the custom title section and replace with:
```tsx
<PageHeader title="Team Analytics">
  {/* existing period selector / action buttons */}
</PageHeader>
```

Import `PageHeader` from `@/components/ui/PageHeader`.

- [ ] **Step 3: Standardize sidebar stat card padding**

Change all sidebar `Card className="p-4"` to `Card className="p-5"`.

- [ ] **Step 4: Replace space-y-* with gap-***

- `space-y-6` → `flex flex-col gap-6`
- `space-y-4` → `flex flex-col gap-5`

- [ ] **Step 5: Standardize card title typography**

Change card titles from `text-lg font-medium` to `h3` class.

- [ ] **Step 6: Verify compilation**

Run: `cd /root/axiom/frontend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/analytics/TeamAnalytics.tsx
git commit -m "refactor: TeamAnalytics to use PageHeader, standardized spacing/typography"
```

---

## Task 10: Refactor OrgAnalytics — PageHeader + Spacing

**Files:**
- Modify: `frontend/src/pages/analytics/OrgAnalytics.tsx`

Same patterns as TeamAnalytics — nearly identical structure.

- [ ] **Step 1: Read OrgAnalytics.tsx current contents**

Read the full file to get exact line numbers.

- [ ] **Step 2: Replace custom title with PageHeader**

Import and use `PageHeader`. Same pattern as Task 9.

- [ ] **Step 3: Standardize sidebar stat card padding**

Change all sidebar `Card className="p-4"` to `Card className="p-5"`.

- [ ] **Step 4: Replace space-y-* with gap-***

Same conversions as Task 9.

- [ ] **Step 5: Standardize card title typography**

Change card titles from `text-lg font-medium` to `h3` class.

- [ ] **Step 6: Verify compilation**

Run: `cd /root/axiom/frontend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/analytics/OrgAnalytics.tsx
git commit -m "refactor: OrgAnalytics to use PageHeader, standardized spacing/typography"
```

---

## Task 11: Audit Remaining Pages for Consistency

**Files:**
- Scan: `frontend/src/pages/**/*.tsx`

- [ ] **Step 1: Search for remaining inconsistencies**

Grep across all page files for:
- `text-2xl font-bold` or `text-lg font-semibold` not inside a `.h2`/`.h3` class (ad-hoc typography)
- `space-y-` usage (should be `gap-`)
- `p-4` or `p-6` on cards (should be `p-5`)
- `rounded-xl` (should be `rounded-lg`)
- `border-border-light` on cards (should be `border-border`)

- [ ] **Step 2: Fix any violations found**

Apply the same patterns used in Tasks 8-10.

- [ ] **Step 3: Verify compilation**

Run: `cd /root/axiom/frontend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "style: standardize remaining pages to consistent spacing/typography"
```

---

## Task 12: Full Verification

- [ ] **Step 1: Run TypeScript check (backend)**

Run: `cd /root/axiom && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 2: Run TypeScript check (frontend)**

Run: `cd /root/axiom/frontend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Run full check suite**

Run: `cd /root/axiom && npm run check`
Expected: PASS (typecheck + lint + format + test)

- [ ] **Step 4: Fix any issues found**

If any checks fail, fix the issues and re-run.

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: resolve lint/type issues from theme overhaul"
```
