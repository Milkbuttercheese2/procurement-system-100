# Korea Institution 100 Design System

## 1. Atmosphere & Identity

A quiet public-policy command desk. The site should feel like a trustworthy reference product rather than a campaign page: clear, structured, calm, and ready for repeated use by 공무원, 보좌진, 연구자, 기자, and policy-curious readers. The signature is the `제도 모델 패널`: a dense but readable structure that pairs legal basis, actors, status, and bottlenecks in one view.

## 2. Color

### Palette

| Role | Token | Value | Usage |
| --- | --- | --- | --- |
| Canvas | `--color-canvas` | `#fcfcfb` | Page background |
| Surface | `--color-surface` | `#ffffff` | Main panels and content blocks |
| Surface muted | `--color-surface-muted` | `#f5f7f6` | Subtle bands and inactive rows |
| Surface tint | `--color-surface-tint` | `#eef8f3` | Accent-backed summaries |
| Text primary | `--color-text` | `#111714` | Headings and primary copy |
| Text secondary | `--color-muted` | `#5d6b63` | Body support copy |
| Text faint | `--color-faint` | `#87938d` | Metadata and helper labels |
| Border | `--color-border` | `#dde5df` | Separators and panel borders |
| Border strong | `--color-border-strong` | `#bdcbc4` | Active panel borders |
| Accent | `--color-accent` | `#0f9f72` | Primary action, focus, active states |
| Accent dark | `--color-accent-dark` | `#087452` | Hover and high-contrast accent text |
| Accent soft | `--color-accent-soft` | `#dff5eb` | Badges and selected backgrounds |
| Warning | `--color-warning` | `#c78116` | Bottleneck and risk labels |
| Ink | `--color-ink` | `#0b1410` | Dark buttons and high-contrast chips |

### Rules

- Accent green is functional: active states, primary actions, selected rows, focus rings.
- Warning amber is used only for bottlenecks, review-needed markers, or status risk.
- Use borders and tonal shifts for hierarchy; avoid heavy shadows.
- No decorative purple/blue gradients.

## 3. Typography

### Scale

| Level | Size | Weight | Line Height | Tracking | Usage |
| --- | --- | --- | --- | --- | --- |
| Display | `clamp(36px, 6vw, 72px)` | 720 | 0.98 | 0 | Page title |
| H1 | `40px` | 720 | 1.1 | 0 | Major section heading |
| H2 | `28px` | 680 | 1.2 | 0 | Panel heading |
| H3 | `20px` | 680 | 1.3 | 0 | Card title |
| Body large | `18px` | 450 | 1.65 | 0 | Lead copy |
| Body | `16px` | 430 | 1.65 | 0 | Default copy |
| Body small | `14px` | 450 | 1.55 | 0 | Metadata and helper copy |
| Label | `12px` | 700 | 1.4 | 0.06em | Uppercase labels |
| Mono | `12px` | 650 | 1.5 | 0.04em | Step codes and evidence IDs |

### Font Stack

- Primary: `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif`
- Mono: `"SFMono-Regular", "Roboto Mono", "Cascadia Code", ui-monospace, monospace`

### Rules

- Korean display text uses 0 letter spacing to avoid awkward CJK texture.
- Headings may be large only in the top product area; panels use compact heading sizes.
- Do not place a final particle or short Korean ending alone if manual copy can avoid it.

## 4. Spacing & Layout

### Base Unit

All spacing derives from 4px.

| Token | Value | Usage |
| --- | --- | --- |
| `--space-1` | `4px` | Tight inline gaps |
| `--space-2` | `8px` | Button/icon gaps |
| `--space-3` | `12px` | Compact padding |
| `--space-4` | `16px` | Default gap |
| `--space-5` | `20px` | Panel inner rhythm |
| `--space-6` | `24px` | Card padding |
| `--space-8` | `32px` | Section gap |
| `--space-10` | `40px` | Large panel padding |
| `--space-12` | `48px` | Section padding |
| `--space-16` | `64px` | Major vertical rhythm |

### Grid

- Max content width: `1440px`
- Desktop shell: two columns, `minmax(360px, 0.78fr) minmax(560px, 1.22fr)`
- Tablet: single-column panels with sticky nav disabled
- Mobile: list-first layout, preview image below the selected summary

## 5. Components

### Top Navigation

- Structure: brand text, anchor links, primary CTA.
- States: hover underline, focus ring, active hash target state.
- Accessibility: anchors remain real links.

### Institution Row

- Structure: index, title, type badge, one-line promise.
- Variants: default, active, priority.
- States: hover border tint, active accent stripe, focus outline.
- Accessibility: implemented as buttons with `aria-pressed`.

### Evidence Panel

- Structure: title, type, legal sources, actors, status, why first.
- Variants: standard, active launch sample.
- States: updates when an institution row is selected.
- Motion: opacity and transform only for the update transition.

### Sample Figure

- Structure: image viewport, label strip, source note.
- Variants: diagram image, future HTML preview.
- Accessibility: descriptive `alt` text.

### Request Form

- Structure: 제도명, 궁금한 지점, 독자 유형, submit.
- States: default, focus, saved confirmation.
- Accessibility: all inputs have visible labels.

## 6. Motion & Interaction

| Type | Duration | Easing | Usage |
| --- | --- | --- | --- |
| Micro | `140ms` | `ease-out` | Buttons and row hover |
| Standard | `220ms` | `cubic-bezier(.2,.8,.2,1)` | Panel update |

### Rules

- Animate only `opacity` and `transform`.
- Respect `prefers-reduced-motion`.
- Motion signals selection or saved state only. No decorative loops.

## 7. Depth & Surface

### Strategy

Use mixed borders and tonal shifts. Shadows are minimal and used only for the sticky nav and focused preview surface.

| Level | Value | Usage |
| --- | --- | --- |
| Border subtle | `1px solid var(--color-border)` | Panels and rows |
| Border active | `1px solid var(--color-border-strong)` | Selected elements |
| Shadow soft | `0 16px 48px rgba(16, 33, 24, .08)` | Preview surface only |

### Rules

- Cards use 12px radius; preview panels use 18px radius; buttons use pill radius.
- Do not nest cards inside cards. Repeated items may be cards; full sections are unframed or single panels.
