---
target: src/views/DashboardView.jsx
total_score: 24
p0_count: 1
p1_count: 2
timestamp: 2026-05-19T17-11-57Z
slug: src-views-dashboardview-jsx
---
## Design Health Score

| # | Heurística | Score | Issue clave |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Spinners presentes, sin skeleton states |
| 2 | Match System / Real World | 3 | Labels en español, iconos reconocibles |
| 3 | User Control and Freedom | 3 | Drag-and-drop funcional, poco descubrible |
| 4 | Consistency and Standards | 2 | Birthdays DIV manual vs WidgetCard; paleta de color ancha |
| 5 | Error Prevention | 2 | Sin estados de error en fallas de red |
| 6 | Recognition Rather Than Recall | 3 | Iconos + labels claros; tabs etiquetados |
| 7 | Flexibility and Efficiency | 3 | Layout personalizable, filtro por tab |
| 8 | Aesthetic and Minimalist Design | 1 | Viola 3 absolute bans: hero-metric, identical cards, default glass |
| 9 | Error Recovery | 2 | Sin estados de error diferenciados |
| 10 | Help and Documentation | 2 | Resize sin tooltip; Personalizar no obvio |
| **Total** | | **24/40** | **Funcional con deuda de diseño significativa** |

## Anti-Patterns Verdict

**LLM:** 3 absolute bans activos — hero-metric KPI cards, identical card grid, glassmorphism como default.

**Detector (4 findings):** gray-on-color ×2 (1 false positive — dead code), ai-color-palette ×2 (gradient violet en birthdays avatars, líneas 1323 y 1361).

## Priority Issues

**[P0] Hero-metric KPI cards** — 4 tarjetas idénticas con big number + label + ícono. Replicadas en los 3 tabs. Fix: scorecard compacto en línea con contexto relativo.

**[P1] Glassmorphism como default** — `bg-white/55 backdrop-blur-[18px]` en KpiCard, WidgetCard, y birthdays. Glass aplicado indiscriminadamente. Fix: glass solo en capas flotantes; stats row sin glass.

**[P2] AI color palette en birthdays** — `from-violet-500 to-pink-500` gradient en avatares. Fix: iniciales con color derivado del nombre, sin gradient.

**[P3] Decorative motion** — stagger de 0/60/120/180ms en KPI cards; orbes de fondo con ambient-drift. Viola "no orchestrated page-load sequences." Fix: sin stagger, fade-in discreto de 150ms.

## Persona Red Flags

**Gerente General:** stagger añade 180ms de latencia percibida en el último KPI. Sin delta ni sparkline para contexto.

**Empleado operativo:** ve KPIs de gerencia que no puede actuar. Dashboard no adapta su vista al rol.

**Supervisor Comercial:** montos sin formato consistente cross-device; widget Top Productos sin conexión visual con KPIs de arriba.

## Minor Observations

- Dead code `{false&&...}` línea 1273 con false positive del detector
- Emojis en UI (🎂🎉) render inconsistente cross-OS
- "Restablecer todo" sin confirmación — acción destructiva sin fricción
- LiquidSelect en widget ventas demasiado ancho en mobile
