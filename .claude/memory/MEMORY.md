# Memory Index

## ⚠️ Reglas de diseño (leer SIEMPRE antes de tocar UI)
Antes de crear o editar CUALQUIER vista, componente, módulo o estilo:
1. Lee `design.md` y cúmplelo: tokens, temas (liquid/dark/solid/solid-dark),
   tipografía, navegación, componentes, animaciones, plataforma nativa y
   anti-patterns. Los tokens viven en `src/index.css`; no hardcodees valores
   que ya existen como CSS var o como patrón documentado.
2. NO inventes en silencio. Si algo que necesito no existe en `design.md`,
   detente y pregúntame antes de crearlo. (Esto es literal: el viejo design.md
   inventó colores que no existían en el código — no repetir ese error.)
3. Si te pido algo que CONTRADICE `design.md` (color fuera de la paleta, radius/
   spacing distinto, otra librería de iconos, romper responsive, agregar
   framer-motion, usar <select> nativo, left-border en filas), ADVIÉRTEME antes
   de hacerlo: dime qué regla viola y el valor correcto, y espera mi confirmación.
   Nunca lo apliques en silencio.
4. Reusa antes de crear: si ya existe un componente parecido (ModalShell,
   UnifiedModal, LiquidSelect, DataTable, GlassViewLayout, ViewTabBar),
   extiéndelo; no dupliques. Usa Lucide React; no mezcles iconos.
5. Toda UI nueva debe pasar el checklist y los anti-patterns de `design.md`
   antes de darse por terminada.

## Reglas de proyecto (comportamiento)
- [Git Push After Changes](feedback_git_push.md) — commit + push después de cada cambio de código
- [Always Log Actions to Audit](feedback_audit_log.md) — toda acción de usuario llama appendAuditLog del staffStore (tabla audit_logs)
- [New Module Checklist](feedback_new_module_checklist.md) — 5 pasos obligatorios al agregar un módulo (view, route, menu, permissions, DB)
- [Supabase 1000-Row Cap](feedback_supabase_row_limit.md) — NUNCA omitir .range() — PostgREST trunca a 1000 filas sin error

## Referencia de arquitectura
- [Project Architecture](project_architecture.md) — AppLayout unificado, RBAC con role_permissions, rutas
- [DTE Sync Architecture & Known Fixes](project_dte_sync_state.md) — fixes sync-dte-sales v15, FK removida, detección de puntos, estado DB tras resync 2026-05

## Referencia visual
- [Design System](design.md) — fuente de verdad de TODO lo visual: tokens, 4 temas, componentes, navegación, animaciones, plataforma nativa. Reemplaza los antiguos archivos de UI standards.