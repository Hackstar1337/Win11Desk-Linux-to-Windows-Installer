# Official Vengeance UI integration sources

Research for Win11Desk redesign, 2026-10-14. User's primary library is spelled Vengeance UI; official host is https://www.vengenceui.com/.

- https://www.vengenceui.com/ — describes React/Next.js compatible open-source interaction components, catalogue families and CLI `npx shadcn@latest add @vengeanceui/[component]`. Homepage points to actual components: `spotlight-navbar`, `glass-dock`, `folder-preview`, `kinetic-text-loader`, `my-animated-button`, `staggered-grid`, `animated-rays`, `shared-tooltip-avatars`, `flip-text`, `morph-text`.
- https://www.vengenceui.com/components — stateless extraction only returned loading component; inspect browser or official registry for actual APIs.
- https://www.vengenceui.com/docs/theming — Tailwind CSS v4 + shadcn optional registry item `https://raw.githubusercontent.com/Ashutoshx7/VengeanceUI/main/public/r/vengeance-theme.json`. Light/dark `--vng-*` values map to shared shadcn tokens; primary, secondary, danger, success, warning, background, border, radius and spacing tokens. Manual-copy components work with standard shadcn tokens. Example primary/hover/foreground/radius/transition variables documented; no universal npm Vengeance package API assumed.
- Official source repository linked by homepage: https://github.com/Ashutoshx7/VengenceUI (GitHub canonical project search also shows https://github.com/Ashutoshx7/VengeanceUI).

The library mainly targets marketing websites. Select only purposeful, performant dashboard interactions and adapt copied open-source implementations for React/Vite, keyboard controls and reduced motion; verify registry source and licensing before copying.
