# Design Overhaul ("Soft Depth") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Axiom's visual design from a flat, cold indigo theme to a warm, elegant "Soft Depth" aesthetic with working dark mode, Geist typography, and refined component styling.

**Architecture:** Pure CSS token + Tailwind class changes. No structural rewrites. The existing design token system (`index.css` CSS variables consumed by Tailwind) means most changes are token value swaps. Component files need class adjustments for spacing, radius, shadows, and typography. Font packages installed via npm.

**Tech Stack:** React 19, Tailwind CSS v4 (via `@tailwindcss/vite`), CSS custom properties, `@fontsource-variable/geist`, `@fontsource-variable/geist-mono`

**Spec:** `docs/superpowers/specs/2026-03-22-design-overhaul-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `frontend/package.json` | Modify | Add Geist font packages |
| `frontend/src/main.tsx` | Modify | Import Geist font CSS |
| `frontend/src/index.css` | Modify | All design tokens (colors, shadows, fonts, radii), typography scale, animations |
| `frontend/src/components/layout/Header.tsx` | Modify | Search bar pill shape, spacing, height |
| `frontend/src/components/layout/Sidebar.tsx` | Modify | Active item style (remove border-l, add rounded fill), section labels, spacing |
| `frontend/src/components/ui/Button.tsx` | Modify | Height, font size, radius adjustments |
| `frontend/src/components/ui/Input.tsx` | Modify | Height, radius, background |
| `frontend/src/pages/dashboard/Dashboard.tsx` | Modify | Stat card icon tints, typography, spacing |
| `frontend/src/pages/auth/Login.tsx` | Modify | Left panel gradient, form padding |
| `frontend/src/components/layout/AppShell.tsx` | Modify | Content padding, header height offset |
| `CLAUDE.md` | Modify | Update available design tokens list |

---

### Task 1: Install Geist Fonts and Update CSS Token Foundation

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/src/index.css` (lines 1-89, the @theme block and .dark block)

- [ ] **Step 1: Install Geist font packages**

```bash
cd /root/axiom/frontend && npm install @fontsource-variable/geist @fontsource-variable/geist-mono
```

- [ ] **Step 2: Import fonts in main.tsx**

Add these two imports at the top of `frontend/src/main.tsx`, before the `./index.css` import:

```tsx
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
```

- [ ] **Step 3: Replace the @theme block in index.css**

Replace lines 4-53 of `frontend/src/index.css` (the entire `@theme { ... }` block) with:

```css
@theme {
  /* Core palette */
  --color-primary: #6d5dca;
  --color-primary-hover: #5a4cb5;
  --color-primary-light: #f0edf9;
  --color-primary-muted: #c4bce8;
  --color-accent: #0d9488;
  --color-accent-light: #e6f7f5;
  --color-danger: #ef4444;
  --color-danger-light: #fef2f2;
  --color-warning: #f59e0b;
  --color-warning-light: #fffbeb;
  --color-success: #10b981;
  --color-success-light: #ecfdf5;

  /* Surfaces */
  --color-surface: #fefefe;
  --color-surface-secondary: #fafaf8;
  --color-surface-tertiary: #f3f2ef;
  --color-surface-elevated: #ffffff;
  --color-surface-overlay: rgba(255, 255, 255, 0.8);
  --color-surface-inverse: #1a1a1a;

  /* Borders */
  --color-border: #e8e6e1;
  --color-border-light: #f0eeea;
  --color-border-focus: #6d5dca;

  /* Text */
  --color-text: #1a1a1a;
  --color-text-secondary: #6b6b6b;
  --color-text-tertiary: #9a9a9a;
  --color-text-inverse: #ffffff;

  /* Fonts */
  --font-sans: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-mono: 'Geist Mono', 'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, monospace;

  /* Shadows — warm-tinted */
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.06), 0 1px 3px rgba(0, 0, 0, 0.04);
  --shadow-lg: 0 12px 24px rgba(0, 0, 0, 0.08), 0 4px 8px rgba(0, 0, 0, 0.04);
  --shadow-glow: 0 0 0 3px rgba(109, 93, 202, 0.15);

  /* Radii */
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-full: 9999px;
}
```

- [ ] **Step 4: Replace the .dark block in index.css**

Replace lines 55-89 (the `.dark { ... }` block) with:

```css
/* Dark mode — soft warm */
.dark {
  --color-primary: #9b8ade;
  --color-primary-hover: #b0a3e8;
  --color-primary-light: #2a2540;
  --color-primary-muted: #3d3566;
  --color-accent: #2dd4bf;
  --color-accent-light: #1a2f2d;
  --color-danger: #f87171;
  --color-danger-light: #2a1215;
  --color-warning: #fbbf24;
  --color-warning-light: #2a2510;
  --color-success: #34d399;
  --color-success-light: #0d2a1f;

  --color-surface: #1c1c1e;
  --color-surface-secondary: #161618;
  --color-surface-tertiary: #252528;
  --color-surface-elevated: #222225;
  --color-surface-overlay: rgba(28, 28, 30, 0.85);
  --color-surface-inverse: #ececec;

  --color-border: #2e2e32;
  --color-border-light: #252528;
  --color-border-focus: #9b8ade;

  --color-text: #ececec;
  --color-text-secondary: #a0a0a0;
  --color-text-tertiary: #6b6b6b;
  --color-text-inverse: #1a1a1a;

  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.2), 0 1px 2px rgba(0, 0, 0, 0.15);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.3), 0 1px 3px rgba(0, 0, 0, 0.2);
  --shadow-lg: 0 12px 24px rgba(0, 0, 0, 0.4), 0 4px 8px rgba(0, 0, 0, 0.25);
  --shadow-glow: 0 0 0 3px rgba(155, 138, 222, 0.2);
}
```

- [ ] **Step 5: Verify the app loads with new tokens**

```bash
cd /root/axiom/frontend && npx tsc --noEmit
```

Open `http://localhost:7000` in the browser and verify:
- Light mode shows warm violet primary, warm off-white backgrounds
- Dark mode toggle works and shows warm dark surfaces
- Text is readable in both modes

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/main.tsx frontend/src/index.css
git commit -m "feat: install Geist fonts and update design tokens to Soft Depth palette"
```

---

### Task 2: Update Typography Scale in index.css

**Files:**
- Modify: `frontend/src/index.css` (typography section, roughly lines 234-280)

- [ ] **Step 1: Update the heading styles**

Find the heading class selectors in `index.css` (lines 234-260). The codebase uses `.h1`-`.h4` class selectors, not bare element selectors. Replace the existing `.h1`-`.h4` rules with:

```css
.h1 {
  font-size: 1.75rem;
  font-weight: 650;
  letter-spacing: -0.02em;
  line-height: 1.2;
  color: var(--color-text);
}

.h2 {
  font-size: 1.375rem;
  font-weight: 600;
  letter-spacing: -0.015em;
  line-height: 1.3;
  color: var(--color-text);
}

.h3 {
  font-size: 1.0625rem;
  font-weight: 600;
  line-height: 1.4;
  color: var(--color-text);
}

.h4 {
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1.4;
  color: var(--color-text);
}
```

Note: Font weight `650` requires Geist as a variable font. Tailwind uses `font-[650]` arbitrary value syntax.

- [ ] **Step 2: Increase base body line-height**

In the `body` rule (around line 97), change the existing styles or add:

```css
body {
  font-family: var(--font-sans);
  color: var(--color-text);
  background-color: var(--color-surface-secondary);
  line-height: 1.6;
}
```

- [ ] **Step 3: Verify typography changes render correctly**

Open the dashboard and an issue detail page. Confirm:
- h1 ("Good morning, Tim") is 28px, slightly tighter tracking
- Body text in issue descriptions has generous line spacing
- Font is Geist (check in browser DevTools > Computed > font-family)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/index.css
git commit -m "feat: update typography scale with Geist font hierarchy"
```

---

### Task 3: Update Sidebar Component

**Files:**
- Modify: `frontend/src/components/layout/Sidebar.tsx` (NavItem around line 36-54, SectionHeader around line 57+)

- [ ] **Step 1: Update NavItem active/hover styles**

In the `NavItem` component, find the `className` function (around line 38-45). Replace:

```tsx
          isActive
            ? 'bg-primary-light text-primary font-medium border-l-2 border-primary'
            : 'text-text-secondary hover:text-text hover:bg-surface-tertiary border-l-2 border-transparent',
```

with:

```tsx
          isActive
            ? 'bg-primary-light text-primary font-medium'
            : 'text-text-secondary hover:text-text hover:bg-surface-tertiary',
```

This removes the left border stripe in favor of the rounded fill alone.

- [ ] **Step 2: Update NavItem base classes for spacing**

In the same `cn()` call, update the base classes from:

```tsx
          'flex items-center gap-2 rounded-md px-3 py-1.5 h-8 text-[13px] transition-all duration-150',
```

to:

```tsx
          'flex items-center gap-2 rounded-lg px-3 py-2 h-9 text-[13px] transition-all duration-150',
```

Changes: `rounded-md` -> `rounded-lg`, `py-1.5` -> `py-2`, `h-8` -> `h-9` for more generous touch targets.

- [ ] **Step 3: Update SectionHeader label styling**

Find the SectionHeader component. Update the label text classes to use uppercase tracked style. The label element should have classes:

```tsx
className="text-[11px] font-medium uppercase tracking-widest text-text-tertiary"
```

- [ ] **Step 4: Update sidebar width**

Find the sidebar container (line 132 in Sidebar.tsx). Change `w-56` (224px) to `w-60` (240px):

```tsx
          'w-60 border-r border-border bg-surface flex flex-col shrink-0 overflow-y-auto scrollbar-none',
```

- [ ] **Step 5: Add more section spacing**

In the Sidebar's main container, ensure sections have `gap-6` (24px) between them instead of the current smaller gap.

- [ ] **Step 6: Verify sidebar**

Open the app and check:
- Active item has rounded violet fill, no left border
- Section labels are small-caps ("ORGANIZATION", "TEAMS")
- Hover states are smooth 150ms transitions
- Spacing between sections is generous

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/layout/Sidebar.tsx
git commit -m "feat: update sidebar with rounded active states and tracked section labels"
```

---

### Task 4: Update Header Component

**Files:**
- Modify: `frontend/src/components/layout/Header.tsx`
- Modify: `frontend/src/components/layout/AppShell.tsx` (if header height is referenced)

- [ ] **Step 1: Update header height and search bar**

In `Header.tsx`, change the header element's classes. Find (line 22):

```tsx
    <header className="h-14 border-b border-border bg-surface/80 backdrop-blur-md flex items-center justify-between px-4 shrink-0 sticky top-0 z-30">
```

Replace with:

```tsx
    <header className="h-[52px] border-b border-border bg-surface/80 backdrop-blur-md flex items-center justify-between px-4 shrink-0 sticky top-0 z-30">
```

- [ ] **Step 2: Update search bar to pill shape**

Find the search button (around line 41-52). Update its classes from:

```tsx
        className="flex items-center gap-2 rounded-lg bg-surface-secondary px-3 py-1.5 text-text-secondary hover:text-text w-72"
```

to:

```tsx
        className="flex items-center gap-2 rounded-full bg-surface-tertiary px-4 py-1.5 text-text-secondary hover:text-text w-80"
```

Changes: `rounded-lg` -> `rounded-full` (pill), `bg-surface-secondary` -> `bg-surface-tertiary` (slightly more visible), `px-3` -> `px-4`, `w-72` -> `w-80`.

- [ ] **Step 3: Update AppShell content padding**

In `frontend/src/components/layout/AppShell.tsx`, line 20, update the content padding from `p-4 lg:p-6` to `p-4 lg:px-8 lg:py-6` for 32px horizontal padding on large screens:

```tsx
          <div className="p-4 lg:px-8 lg:py-6">
```

AppShell does not reference `h-14` directly (header height is self-contained), so no height offset change needed.

- [ ] **Step 4: Verify header**

- Search bar is pill-shaped, slightly wider, warm tertiary background
- Header height is 52px
- Theme toggle and notifications icons work properly

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/layout/Header.tsx frontend/src/components/layout/AppShell.tsx
git commit -m "feat: update header with pill search bar and refined height"
```

---

### Task 5: Update Button and Input Components

**Files:**
- Modify: `frontend/src/components/ui/Button.tsx`
- Modify: `frontend/src/components/ui/Input.tsx`

Note: Badge already uses `rounded-full` (pill shape) -- no changes needed there.

- [ ] **Step 1: Update Button sizing**

In `Button.tsx` (line 24), keep `rounded-md` (already maps to 8px via `--radius-md`). Update the `md` size variant to enforce consistent 36px height and 13px text:

```tsx
  md: 'px-4 py-2 h-9 text-[13px] gap-2',
```

- [ ] **Step 2: Update Input sizing**

In `Input.tsx` (line 33), the input already uses `bg-surface` and `rounded-md`. Add `h-9` for consistent 36px height. Change the base classes from:

```tsx
          'w-full rounded-md border bg-surface px-3 py-2 text-sm transition-all duration-150',
```

to:

```tsx
          'w-full rounded-md border bg-surface px-3 py-2 h-9 text-sm transition-all duration-150',
```

- [ ] **Step 3: Verify components**

- Buttons: 36px height, 8px radius, correct hover states in both themes
- Inputs: 36px height, solid surface background, violet focus glow on focus

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ui/Button.tsx frontend/src/components/ui/Input.tsx
git commit -m "feat: update Button and Input with consistent 36px height"
```

---

### Task 6: Update Dashboard Stat Cards and Layout

**Files:**
- Modify: `frontend/src/pages/dashboard/Dashboard.tsx` (lines 87-220)

- [ ] **Step 1: Update stat card icon tint colors**

Find the stat cards array (around line 121-155). Replace the mapping so each card type uses its own tint. Change the array to include a `color` property:

```tsx
              {[
                {
                  icon: ListChecks,
                  label: 'Open Issues',
                  value: dashboardData.assignedIssues?.length ?? 0,
                  bg: 'bg-primary-light',
                  fg: 'text-primary',
                },
                {
                  icon: GitPullRequest,
                  label: 'Review Requests',
                  value: dashboardData.reviewRequests?.length ?? 0,
                  bg: 'bg-accent-light',
                  fg: 'text-accent',
                },
                {
                  icon: CalendarClock,
                  label: 'Due Soon',
                  value: dashboardData.upcomingDueDates?.length ?? 0,
                  bg: 'bg-warning-light',
                  fg: 'text-warning',
                },
                {
                  icon: Activity,
                  label: 'Recent Events',
                  value: dashboardData.recentActivity?.length ?? 0,
                  bg: 'bg-success-light',
                  fg: 'text-success',
                },
              ].map(({ icon: StatIcon, label, value, bg, fg }) => (
```

And update the icon container from:

```tsx
                  <div className="h-9 w-9 rounded-lg bg-primary-light flex items-center justify-center shrink-0">
                    <StatIcon className="h-4 w-4 text-primary" />
                  </div>
```

to:

```tsx
                  <div className={cn('h-10 w-10 rounded-xl flex items-center justify-center shrink-0', bg)}>
                    <StatIcon className={cn('h-[18px] w-[18px]', fg)} />
                  </div>
```

Note: `cn` is not currently imported in Dashboard.tsx. Add this import at the top of the file:

```tsx
import { cn } from '@/lib/utils';
```

- [ ] **Step 2: Update stat card number typography**

Change the value display from:

```tsx
                    <p className="text-xl font-bold text-text leading-none">{value}</p>
```

to:

```tsx
                    <p className="text-2xl font-[650] text-text leading-none">{value}</p>
```

- [ ] **Step 3: Update stat card container styling**

Change the stat card container from:

```tsx
                  className="rounded-lg border border-border bg-surface p-4 flex items-center gap-3 hover:border-primary/40 hover:shadow-sm transition-all"
```

to:

```tsx
                  className="rounded-xl border border-border-light bg-surface-elevated p-4 flex items-center gap-4 shadow-sm hover:shadow-md transition-all duration-150"
```

- [ ] **Step 4: Update widget grid to 60/40 split**

Change the widget grid (around line 160) from:

```tsx
            <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
```

to:

```tsx
            <div className="grid gap-4 grid-cols-1 lg:grid-cols-[3fr_2fr]">
```

- [ ] **Step 5: Add section spacing**

Change the outer container from `space-y-6` to `space-y-8` (line 88) for more breathing room. On line 168, add `mt-4` to the Organizations wrapper `<div>` to add extra separation from the widget grid:

```tsx
            <div className="mt-4">
              <h2 className="text-lg font-semibold text-text mb-3">Organizations</h2>
```

- [ ] **Step 6: Update org and team card styling**

Update the org card link element (line 175) from:

```tsx
                  className="group rounded-lg border border-border bg-surface overflow-hidden hover:border-primary/40 hover:shadow-md transition-all duration-150"
```

to:

```tsx
                  className="group rounded-xl border border-border-light bg-surface-elevated overflow-hidden shadow-sm hover:shadow-md transition-all duration-150"
```

This applies the spec's card design language (12px radius, `border-light`, `surface-elevated`, `shadow-sm`, hover to `shadow-md`).

- [ ] **Step 7: Verify dashboard**

- Stat cards have distinct colored icons (violet, teal, amber, green)
- Numbers are larger and bolder
- Cards have soft elevation
- Widget grid is 60/40
- Generous spacing throughout

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/dashboard/Dashboard.tsx
git commit -m "feat: update dashboard with colored stat cards and refined layout"
```

---

### Task 7: Update Login Page

**Files:**
- Modify: `frontend/src/pages/auth/Login.tsx`

- [ ] **Step 1: Update left panel gradient**

Find the left panel div (line 49). Change:

```tsx
      <div className="hidden lg:flex lg:w-1/2 bg-primary items-center justify-center p-12 relative overflow-hidden">
```

to:

```tsx
      <div className="hidden lg:flex lg:w-1/2 items-center justify-center p-12 relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #4a3d8f 0%, #0d9488 100%)' }}>
```

- [ ] **Step 2: Update tagline text color**

Find the tagline paragraph (line 63). Change:

```tsx
          <p className="text-lg text-primary-light leading-relaxed">
```

to:

```tsx
          <p className="text-lg text-white/70 leading-relaxed">
```

The `text-primary-light` token is now a light violet which won't work on the gradient background. Use `text-white/70` for a semi-transparent white that works on any background.

- [ ] **Step 3: Update form padding**

Find the form container (line 71). Change `p-8` to `p-10` for more generous padding:

```tsx
      <div className="flex-1 flex items-center justify-center p-10 bg-surface min-h-screen">
```

- [ ] **Step 4: Verify sign-in button height**

The submit button (line 124) already uses `size="lg"` which provides `py-2.5` yielding ~40px. No height change needed -- the `lg` size is already prominent enough.

- [ ] **Step 5: Verify login page**

Log out and check:
- Left panel has a violet-to-teal diagonal gradient
- Right panel is warm off-white
- Form inputs have the new styling
- Sign in button is prominent

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/auth/Login.tsx
git commit -m "feat: update login page with gradient panel and refined form"
```

---

### Task 8: Add Theme Transition Smoothing

**Files:**
- Modify: `frontend/src/index.css` (base styles section)

- [ ] **Step 1: Replace existing transition rule**

In `index.css`, find the existing transition rule at lines 132-139:

```css
/* Smooth transitions */
a,
button,
input,
select,
textarea {
  transition: all 0.15s ease;
}
```

Replace it with an expanded version that covers layout elements for theme toggling:

```css
/* Smooth transitions (covers theme toggle + interactive elements) */
body,
header,
nav,
main,
aside,
a,
button,
input,
select,
textarea {
  transition: background-color 150ms ease, color 150ms ease, border-color 150ms ease;
}
```

Note: Changed from `all` to specific properties to avoid interfering with transform/opacity animations.

- [ ] **Step 2: Test theme toggle**

Toggle between light and dark mode. Confirm:
- Colors transition smoothly (no jarring flash)
- No performance issues or jank
- Other animations (hovers, dropdowns) are not affected

- [ ] **Step 3: Commit**

```bash
git add frontend/src/index.css
git commit -m "feat: add smooth theme transition for light/dark toggle"
```

---

### Task 9: Update CLAUDE.md Token List and Final Verification

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the available tokens list in CLAUDE.md**

Find the "Available tokens" line in CLAUDE.md and replace with:

```
Available tokens: `text`, `text-secondary`, `text-tertiary`, `text-inverse`, `primary`, `primary-hover`, `primary-light`, `primary-muted`, `accent`, `accent-light`, `surface`, `surface-secondary`, `surface-tertiary`, `surface-elevated`, `surface-overlay`, `surface-inverse`, `border`, `border-light`, `border-focus`, `danger`, `danger-light`, `warning`, `warning-light`, `success`, `success-light`.
```

- [ ] **Step 2: Run full typecheck**

```bash
cd /root/axiom/frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Dark mode audit**

The codebase exploration confirmed no hardcoded Tailwind palette colors (e.g., `bg-white`, `text-gray-600`) -- all components use design tokens. However, verify by spot-checking these high-traffic pages in dark mode:
- Dashboard, Issue list, Issue detail, Repo file browser, Wiki, Settings
- Look for any white/light elements that don't respect the dark theme
- Check dropdown menus, modals, tooltips, and toast notifications

If any hardcoded colors are found, replace them with the appropriate design token class.

- [ ] **Step 4: Visual verification checklist**

Open the app and verify each page:

1. **Login page**: gradient left panel, warm form, prominent button
2. **Dashboard (light)**: warm off-white bg, colored stat cards, readable typography
3. **Dashboard (dark)**: warm charcoal bg, elevated cards, no white flashes
4. **Issue list**: clean rows, pill badges, hover states
5. **Issue detail**: readable body text (line-height 1.6), warm sidebar
6. **Repository page**: file tree readable, warm surfaces
7. **Wiki page**: warm surfaces, clear headings
8. **Settings page**: clean form, warm borders
9. **Toggle between light/dark**: smooth transition, no broken colors

- [ ] **Step 5: Commit CLAUDE.md**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with complete design token list"
```

---

## Task Dependency Order

```
Task 1 (tokens + fonts) → Task 2 (typography) ─┐
                                                 ├→ Task 3 (sidebar)         ─┐
                                                 ├→ Task 4 (header+appshell)  ├→ Task 8 (transitions) → Task 9 (docs + audit + verify)
                                                 ├→ Task 5 (button/input)     │
                                                 ├→ Task 6 (dashboard)       ─┤
                                                 └→ Task 7 (login)           ─┘
```

Tasks 1-2 must run first (they establish the design foundation). Tasks 3-7 can run in parallel after that. Task 8-9 run last.
