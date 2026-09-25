# DESIGN — "Margin Notes"

A good student's notebook: warm paper, dark ink, one red that means *live*. Timestamps are the signature element. Small mono time chips appear wherever the AI makes a claim.

## Tokens

| Token | Light | Dark | Rule |
| --- | --- | --- | --- |
| `--paper` | `#F7F4EE` | `#15140F` | app background |
| `--sheet` | `#FFFFFF` | `#1E1C17` | cards, sheets, player |
| `--ink` | `#1B1A17` | `#ECE8DF` | body text |
| `--ink-2` | `#5C5850` | `#A39E93` | secondary text (≥4.5:1 on paper) |
| `--rule` | `#E4DED3` | `#2E2B25` | 1px hairlines; no shadows except the sheet |
| `--accent` | `#2B4FD8` | `#8FA6FF` | links, time chips, primary actions |
| `--accent-wash` | `#E8ECFB` | `#232A45` | time chip background |
| `--rec` | `#C93321` | `#FF6A5A` | **recording only** |
| `--ok` | `#2F7D4F` | `#6BC98F` | status: done |
| `--warn` | `#8A5A00` | `#E0B252` | status: in progress / emphasized |
| `--err` | `#9E2A20` | `#F28B82` | errors (always with icon) |

Course colours are 8 presets, and each one is used only as an 8px dot, never as a border bar.

## Type
- Sans: IBM Plex Sans Thai + IBM Plex Sans (400/500/600).
- Mono: IBM Plex Mono 500, `tabular-nums`, used only for timers, time chips, and counts.
- Scale (px): 13 · 15 · 17 · 20 · 28 · 48 (timer).
- Line-height: 1.7 for Thai body text, 1.3 for headings. No letter-spacing on Thai.

## Shape, space, depth
- Radius: 12 for cards and sheets, 999 for chips and buttons.
- Spacing: a 4px base; 16 page gutter; 24 between sections, 8 within a group.
- Elevation: one level only, for the bottom player and sheets (`0 -4px 16px rgb(0 0 0 / .06)`).

## Motion
- 160–220 ms `cubic-bezier(.2,.8,.2,1)`.
- The one authored moment is the recording ring, which breathes on a 2.4 s cycle. Under reduced motion it becomes a static ring.
- Hold-to-stop fills over 1 s.

## Components
- **Time chip:** a mono 13px label on `--accent-wash`, 28px tall with a 44px hit area. Tap seeks and plays.
- **Status:** always an icon and text, never colour alone.
- **Icons:** inline SVG, 1.75 stroke, round caps (Lucide geometry).

## Scene rules
- The Recording screen is always dark, whatever the theme, for discretion in the hall.
- Study screens follow the system theme.
