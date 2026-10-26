# Design system

The source of truth is [`src/app/styles/tokens.css`](../src/app/styles/tokens.css). Sizes are CSS px at the
1920×1080 app resolution. Visual reference: the approved blueprint (directions A + C).

## Principles

- Dark, cinematic canvas; large white type; colour used sparingly and with meaning.
- Everything readable from the sofa: nothing below 20px, body 26px.
- Focus is always obvious: a white ring separated from the artwork by a dark gap, plus a slight scale.
- Honest states: playing, loading, offline, error, advertised vs verified quality are visually distinct.
- Restrained motion: only `transform`/colour transitions (150 ms focus, 220 ms overlays); no blur, parallax or
  autoplaying backgrounds. Reduced-motion turns transitions off.

## Tokens

| Group | Tokens |
|---|---|
| Base | canvas `#0E1013`, card `#1C2028`, raised `#2A303B`, text `#F2F4F7`, text-dim `#9AA3B2`, accent `#8AB4FF` |
| Semantic | live `#E5484D`, verified `#6EE7A8` on `rgba(61,214,140,.16)`, warning `#F5C26B`, error `#FF8A8F` |
| Section accents (chips/dots only) | football `#34D399`, news `#F87171`, sports `#F5A524`, kids `#FFD84D`, 4K `#C4A7FF`, movies `#FF9157`, series `#3CC7C2` |
| Type scale | hero 84 · page 54 · section 44 · row 30 · body 26 · meta 22 · min 20 |
| Spacing | 8 · 12 · 16 · 24 · 32 · 48 · 64; 24 between cards, ~40–48 between shelves |
| Safe area | 96px sides, 54px top/bottom (5% overscan) |
| Radius | chips 10 · cards 16 · panels 22 · nav pills fully rounded |
| Cards | logo 240×135 · landscape 320×180 · poster 220×330 · match 520×262 |
| Focus | scale 1.07 + `0 0 0 4px canvas, 0 0 0 8px #fff` + shadow |

Font: Manrope (OFL), bundled; falls back to the TV's system fonts (LG Smart UI) for scripts Manrope lacks
(Arabic, Bengali, …).

## Components

| Component | Notes |
|---|---|
| Top nav | Logo, tabs (Home, Live TV, Movies, Series, Kids), Search pill, Settings icon, clock. Selected = tinted pill; focused = white pill. Tabs switch 250 ms after focus settles. Entering from below lands on the selected tab. |
| Hero | Eyebrow chips, 84px title, meta lines, pill buttons. Backdrop is a static gradient (tinted from artwork when available). |
| Shelf | Title + horizontal track; focused card scrolls to the leading edge; remembers its last card. |
| Tile | Channel logo on a neutral plate (uneven logos still line up); monogram when no logo; channel number top-left. |
| Chip | Neutral, live, verified (filled green), advertised (outline), muted; selectable chips for filters. |
| Empty state | Focusable card stating what is missing and how to fix it — never a dead row. |
| Dialog | Focus trap, dimmed backdrop (no blur), default action focused. |
| List row | Settings and channel lists; focused row turns white with dark text. |

## Layout rules (compatibility)

No flex `gap` (use `.hstack`/`.vstack` margins), no `inset`, `aspect-ratio`, `clamp()`, `:is()`,
`:focus-visible`, `backdrop-filter` (FND-001). Focus styling uses `[data-focused]`, never a class (BUG-001).
