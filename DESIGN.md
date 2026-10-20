---
name: Oceanic Precision
colors:
  surface: '#f9f9f9'
  surface-dim: '#dadada'
  surface-bright: '#f9f9f9'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f3f4'
  surface-container: '#eeeeee'
  surface-container-high: '#e8e8e8'
  surface-container-highest: '#e2e2e2'
  on-surface: '#1a1c1c'
  on-surface-variant: '#444651'
  inverse-surface: '#2f3131'
  inverse-on-surface: '#f0f1f1'
  outline: '#757682'
  outline-variant: '#c5c6d2'
  surface-tint: '#435ba2'
  primary: '#001242'
  on-primary: '#ffffff'
  primary-container: '#03256c'
  on-primary-container: '#788fdb'
  inverse-primary: '#b4c4ff'
  secondary: '#0461a4'
  on-secondary: '#ffffff'
  secondary-container: '#74b4fd'
  on-secondary-container: '#004579'
  tertiary: '#001a21'
  on-tertiary: '#ffffff'
  tertiary-container: '#00303b'
  on-tertiary-container: '#00a0be'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dbe1ff'
  primary-fixed-dim: '#b4c4ff'
  on-primary-fixed: '#00174c'
  on-primary-fixed-variant: '#294289'
  secondary-fixed: '#d2e4ff'
  secondary-fixed-dim: '#9fcaff'
  on-secondary-fixed: '#001c37'
  on-secondary-fixed-variant: '#00497e'
  tertiary-fixed: '#b0ecff'
  tertiary-fixed-dim: '#42d7fb'
  on-tertiary-fixed: '#001f27'
  on-tertiary-fixed-variant: '#004e5e'
  background: '#f9f9f9'
  on-background: '#1a1c1c'
  surface-variant: '#e2e2e2'
  persian-blue: '#2541b2'
  surface-subtle: '#f4f7fb'
  surface-border: '#d8e2ed'
  text-muted: '#556b82'
typography:
  display-lg:
    fontFamily: Manrope
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  display-lg-mobile:
    fontFamily: Manrope
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: -0.015em
  headline-lg:
    fontFamily: Manrope
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Manrope
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.005em
  headline-sm:
    fontFamily: Manrope
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  title-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 26px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.04em
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1.5rem
  gutter-sm: 1rem
  margin: 2rem
  margin-sm: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

This design system blends **Corporate / Modern** discipline with high-clarity **Minimalism** and subtle hydrodynamic architectural cues. Engineered for mission-critical digital interfaces, enterprise SaaS, and sophisticated financial or analytical platforms, it projects absolute stability, technical authority, and operational velocity.

The target audience consists of data-intensive operators, institutional leaders, and high-performance product teams who demand immediate cognitive legibility without visual exhaustion. The interface conveys calculated competence, architectural precision, and pristine clarity through high-contrast maritime blues, crisp boundary lines, and controlled visual hierarchy.

## Colors

The palette establishes an authoritative cool-spectrum chromatic hierarchy:

- **Primary (`#03256c` - Imperial Blue):** Anchor for structural framing, core navigational headers, dominant action triggers, and primary typographical headings.
- **Secondary (`#1768ac` - Ocean Deep):** Mid-depth interactive actions, secondary tabs, key progress indicators, and active selection fills.
- **Tertiary (`#06bee1` - Sky Surge):** High-energy electric accent strictly reserved for focused data callouts, active system status indicators, notification beacons, and precise focus rings.
- **Persian Blue (`#2541b2`):** Expressive interactive state color for hover states, link hover highlights, and active container accents.
- **Neutral & Light Surfaces:** White (`#ffffff`) anchors the canvas background. Muted cool tint `surface-subtle` (`#f4f7fb`) provides low-contrast alternate section grouping, while `surface-border` (`#d8e2ed`) maintains structured partition integrity.

## Typography

The type system pairs **Manrope** for authoritative structural framing with **Inter** for clean, dense information processing. 

- Use **Manrope** across all display headers and prominent card titles. Its geometric construction and refined proportions deliver executive presence.
- Use **Inter** for dense data displays, body narrative, labels, inputs, and tabular numbers. It maintains impeccable legibility even at compact scales (`11px` - `12px`).
- Apply uppercase styling with expanded letter spacing (`0.04em` - `0.05em`) strictly to metadata badges, column headers, and status flags.

## Layout & Spacing

This design system uses a strict 8-point baseline grid. 

- **Desktop (>= 1200px):** 12-column fluid grid, max container width of 1440px, 2rem canvas margins, and 1.5rem gutters.
- **Tablet (768px - 1199px):** 8-column layout with 1.5rem margins and 1rem gutters. Side navigation drawers collapse to icons or rail format.
- **Mobile (< 768px):** 4-column single flow, 1rem margins, and 1rem gutters. Complex multi-metric layouts stack vertically.

## Elevation & Depth

Visual hierarchy relies on crisp hairline boundaries combined with deep, ambient-tinted oceanic shadows to prevent visual noise:

- **Surface Levels:**
  - `Level 0 (Canvas)`: Pure White (`#ffffff`) or subtle background tint (`#f4f7fb`).
  - `Level 1 (Cards & Data Panels)`: Pure White with a 1px border (`#d8e2ed`) and an ambient shadow `0 2px 8px -2px rgba(3, 37, 108, 0.05)`.
  - `Level 2 (Dropdowns & Popovers)`: Elevated surface with `0 8px 24px -4px rgba(3, 37, 108, 0.10)` and crisp `1px` border.
  - `Level 3 (Modals & Overlays)`: Pure White container flanked by a deep indigo overlay (`rgba(3, 37, 108, 0.45)`) with shadow `0 16px 40px -8px rgba(3, 37, 108, 0.18)`.
- **Focus Depth:** Focused interactive controls replace static shadows with a multi-ring halo: `0 0 0 1px #ffffff, 0 0 0 3px #06bee1`.

## Shapes

The system implements a soft, engineered profile (`roundedness: 1`):

- **Default UI controls (Buttons, Inputs, Badges):** `4px` (`0.25rem`) border radius, preserving architectural sharpness and structural rigor.
- **Containers & Cards (`rounded-lg`):** `8px` (`0.5rem`) radius to soften larger visual blocks without looking playful.
- **Modals & Flyouts (`rounded-xl`):** `12px` (`0.75rem`) radius.
- **Tags & Indicator Pills:** Fully pill-shaped (`9999px`) to visually differentiate metadata elements from interactive square buttons and inputs.

## Components

### Buttons
- **Primary:** Background Imperial Blue (`#03256c`), text `#ffffff`, 4px radius. Hover shifts to Persian Blue (`#2541b2`). Active shifts to Ocean Deep (`#1768ac`). Focus states display an electric Sky Surge (`#06bee1`) ring.
- **Secondary:** Background Ocean Deep (`#1768ac`), text `#ffffff`. Hover shifts to `#03256c`.
- **Outline / Subtle:** Background transparent, 1px border `#d8e2ed`, text `#03256c`. Hover: Background `#f4f7fb`, border `#1768ac`.

### Chips & Badges
- **Informational Chip:** Background `rgba(6, 190, 225, 0.12)`, text `#03256c`, border `1px solid rgba(6, 190, 225, 0.35)`.
- **Interactive Filter Chip:** Background `#ffffff`, border `1px solid #d8e2ed`, text `#556b82`. Selected state: Background `#03256c`, text `#ffffff`, border `#03256c`.

### Form Fields & Inputs
- **Base Input:** White surface, 1px border `#d8e2ed`, 4px radius, text `#03256c`, placeholder `#556b82`. Padding: `0.5rem 0.75rem`.
- **Active / Focus:** Border shifts to Ocean Deep (`#1768ac`) with a 3px outer glow ring of Sky Surge (`#06bee1` at 30% opacity).

### Checkboxes & Radio Controls
- **Unchecked:** 1.5px border `#d8e2ed`, background `#ffffff`, 3px radius for checkboxes, circle for radio.
- **Checked:** Background Imperial Blue (`#03256c`), border Imperial Blue, icon fill `#ffffff`. Focus retains the `#06bee1` glow.

### Cards & Data Tables
- **Cards:** Surface White (`#ffffff`), 1px solid border `#d8e2ed`, 8px radius. Card header includes a subtle 1px divider border `#d8e2ed`.
- **Data Tables:** Alternating rows using `#ffffff` and `#f4f7fb`. Header row background `#03256c` with text `#ffffff`, or subtle neutral variant with border-bottom `2px solid #03256c`.