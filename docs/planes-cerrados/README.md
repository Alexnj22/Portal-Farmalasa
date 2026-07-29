# Planes y auditorías cerrados

Documentos de trabajo que ya cumplieron su función. **No se ejecutan más** — se
conservan porque son el registro de por qué el código es como es hoy, y porque
DESIGN.md, CLAUDE.md y varios comentarios de `src/` los citan por nombre.

Los planes y auditorías **vivos** siguen en la raíz del repo. Un documento se
mueve acá solo cuando todas sus fases están aplicadas, explícitamente
descartadas por decisión del usuario, o absorbidas por un plan posterior.

## Índice

| Documento | Cerrado | Evidencia del cierre |
|---|---|---|
| `AUDITORIA-2026-07.md` | 2026-07-10 | "COMPLETA — Fases 0 a 6". Su roadmap se convirtió en `PLAN-EJECUCION-2026-07.md`. |
| `PLAN-EJECUCION-2026-07.md` | 2026-07-17 | Bloques 0–8 cerrados + sección "Verificación 2026-07-17 (post-cierre)". 4 ítems diferidos por decisión del usuario (0B.4, 0B.11 y 2 más), no por trabajo pendiente. |
| `auditoria-portal.md` | — | Charter previo (Mes 1 + Trimestre del roadmap). Reemplazado por `PLAN-EJECUCION-2026-07.md`, cuyos bloques cubren sus 7 y están cerrados. |
| `PREPARED-0B-MIGRATIONS.md` | 2026-07-12 | Migraciones 0B.1 y 0B.6 aplicadas en prod; 0B.5 cerrado como riesgo aceptado; 0B.4 diferido por decisión. Nada queda por aplicar. |
| `prompt-auditoria-eficiencia-2026-07-12.md` | — | Prompt absorbido por el Bloque 4 de `PLAN-EJECUCION` (7/7 cerrado 2026-07-17). ⚠️ Lo que no llegó a ejecutarse —purga de `cron.job_run_details`, bloat de `net._http_response`— fue **re-medido y ahora vive en `AUDITORIA-SUPABASE-2026-07-29.md` (P4)**, que sigue abierta. |
| `AUDITORIA-MINMAX-2026-07-17.md` | 2026-07-17 | CHANGELOG: "se cierran las 4 fases de la auditoría MinMax". M2/M7 aplicadas; M3/M4/M6 diferidas sin fecha por decisión. El checklist §5 quedó sin marcar — es stale, no pendiente. |
| `PLAN-BUSCADORES-NORMALIZACION.md` | — | *(sigue en la raíz)* Fases 1–2 en prod; Fase 3 (fuzzy server-side) nunca se implementó. |
| `AUDITORIA-MOBILE-HEADER-STANDALONE-2026-07.md` | 2026-07-23 | "RESUELTO Y CONFIRMADO POR EL USUARIO EN SU IPHONE (v2.32.1)". |
| `PLAN-MOBILE-2026-07.md` | 2026-07-24 | Fases 1–3 aplicadas (v2.30.0–v2.32.1). Fase 4 (pasada por vistas) se fundió en T4 y Fase 5 (matriz de QA) en T7 del plan de tema — ambas cerradas ahí. |
| `AUDITORIA-TEMA-2026-07.md` | 2026-07-24 | T1–T7 cerrado (DESIGN.md v2.0 §historial: "T7.4 — cierre de AUDITORIA-TEMA-2026-07.md T7"). El checklist §8 quedó sin marcar — su deuda restante la absorbió y cerró la auditoría de diseño de julio 26. |
| `AUDITORIA-DISENO-2026-07-26.md` | 2026-07-28 | Su plan derivado (`PLAN-DISENO-PENDIENTE.md`) cerró las 5 fases. |
| `PLAN-DISENO-PENDIENTE.md` | 2026-07-28 | Sección "Cierre del plan D0–D4". Gate en 20 de 23 categorías en cero absoluto; las 3 con ratchet son deuda deliberada y documentada. ⚠️ Sus dos abiertos (A1 densidad, `Skeleton` sin adopción) y los 3 ratchet los cerró `PLAN-CIERRE-DISENO-2026-07-29.md`. |
| `PLAN-CORRECCION-AUDITORIA-2026-07-29.md` | 2026-07-29 | P1/P2/P3 aplicados (v2.183–2.187). Su único abierto —224 targets táctiles— lo cerró `PLAN-CIERRE-DISENO-2026-07-29.md` F5 el mismo día, **y de paso corrigió el conteo**: eran 46, no 224. |
| `PLAN-CIERRE-DISENO-2026-07-29.md` | 2026-07-29 | Sección "Resultado (v2.204.0)". F0–F6 cerradas. **Baseline del gate VACÍO**: 25 categorías bloqueantes en cero, contraste 0/0 en 29 rutas, 7 targets bajo 44px y los 7 con motivo escrito. Es el plan que deja el sistema de diseño sin ítems abiertos. |
| `PLAN-PROVEEDORES-2026-07.md` | 2026-07-18 | Cabecera: "CERRADO — Fases 0-5 aplicadas en prod (v2.21.0-v2.22.0)". Los checkboxes de §1–3 quedaron sin marcar; son stale. |
| `PLAN-FACTURAS-COMPRA-2026-07.md` | 2026-07-29 | Fases 1–5 verificadas en prod. Su último bloqueante era reactivar el cron: `sync-purchase-emails-daily` (jobid 183) está `active=true` en prod — verificado el 2026-07-29. |

## Ojo con los checkboxes

Cinco de estos documentos tienen `- [ ]` sin marcar que **no son trabajo
pendiente**: el cierre se escribió en prosa (cabecera o sección de cierre) y
nunca se bajó al checklist. Al leerlos, la cabecera y la sección de cierre
mandan sobre los checkboxes.
