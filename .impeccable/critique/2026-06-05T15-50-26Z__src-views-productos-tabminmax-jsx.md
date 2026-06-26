---
target: src/views/productos/TabMinMax.jsx
total_score: 22
p0_count: 1
p1_count: 2
timestamp: 2026-06-05T15-50-26Z
slug: src-views-productos-tabminmax-jsx
---
## Design Health Score

| # | Heurística | Score | Issue clave |
|---|-----------|-------|-------------|
| 1 | Visibility of System Status | 3 | Pulse dot en borrador + relativeTime correctos; sin skeleton en tabla |
| 2 | Match System / Real World | 3 | Labels en español, unidades reales ("~3 cajas"), dominio correcto |
| 3 | User Control and Freedom | 2 | Sin undo para zero-out ni para ocultar; solo "N ocultos" para restaurar |
| 4 | Consistency and Standards | 2 | Tres radios de botón distintos; glass en inline style + className mezclados |
| 5 | Error Prevention | 2 | "Publicar todo" sin confirmación; zero-out sin warning, irreversible |
| 6 | Recognition Rather than Recall | 2 | XCircle sin label — usuario no sabe que crea borrador, no aplica en vivo |
| 7 | Flexibility and Efficiency | 3 | CSV, sort multi-columna, publicar filtrado, recalcular todas |
| 8 | Aesthetic and Minimalist Design | 1 | 2 absolute bans en CostCards; glassmorphism como textura en ~8 superficies |
| 9 | Error Recovery | 2 | Error banner con X; sin retry; sin undo post zero-out |
| 10 | Help and Documentation | 2 | Panel "Fórmula actual" útil pero enterrado; sin modelo mental Calcular→Publicar |
| **Total** | | **22/40** | **Funcional con deuda de diseño importante** |

## Anti-Patterns Verdict

**LLM:** CostCards — hero-metric template + identical card grid simultáneos. Glassmorphism en ~8 superficies como textura, no como profundidad.

**Deterministic scan (manual):** CLI unavailable. border-l colors defined in ALERT.left; transition-all in matrix cells; CostCards hero-metric; glassmorphism as default.

## Priority Issues

**[P0] CostCards — hero-metric + identical card grid**
4 tarjetas idénticas con big number + tiny label + icon. Fix: fila de datos inline sin glass por ítem.

**[P1] Glassmorphism como textura**
backdrop-blur en 8 superficies planas. Fix: reservar para capas flotantes; chips y cost row sin blur.

**[P1] Publicar todo sin confirmación**
N=800 cambios sin paso intermedio. Fix: ConfirmModal para N > 10.

**[P2] XCircle sin modelo mental**
Icon-only, sin feedback de que creó borrador. Fix: tooltip + flash ring-amber en celda.

**[P2] ALERT.left define border-l coloreados**
Líneas 49-54. Fix: eliminar propiedad left del objeto ALERT.

## Persona Red Flags

**Supervisor Comercial:** XCircle silencioso crea borrador sin feedback; "Publicar todas las sucursales" vs "Publicar todo" — ambigüedad de scope.

**Gerente General:** CostCards sin jerarquía — $1.2M y $45k compiten en mismo peso visual. Banner críticos clase A debajo del fold.

## Minor Observations

- editId state nunca asignado (dead code) — eliminar
- calcResult state no usado en render — eliminar
- text-[7px] ilegible en monitores no-retina
- Emoji 📊 render inconsistente — usar BarChart2 icon
- transition-all en matrix cells — prohibido por DESIGN.md
