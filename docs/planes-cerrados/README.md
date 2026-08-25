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
| `PLAN-BUSCADORES-NORMALIZACION.md` | 2026-08-05 | Fases 1–2 en prod desde 2026-07-17 (v2.17.53). Fase 3 (fuzzy server-side) está marcada **«opcional, después»** en el propio plan y nunca se empezó: es un apunte, no trabajo en curso. |
| `AUDITORIA-MOBILE-HEADER-STANDALONE-2026-07.md` | 2026-07-23 | "RESUELTO Y CONFIRMADO POR EL USUARIO EN SU IPHONE (v2.32.1)". |
| `PLAN-MOBILE-2026-07.md` | 2026-07-24 | Fases 1–3 aplicadas (v2.30.0–v2.32.1). Fase 4 (pasada por vistas) se fundió en T4 y Fase 5 (matriz de QA) en T7 del plan de tema — ambas cerradas ahí. |
| `AUDITORIA-TEMA-2026-07.md` | 2026-07-24 | T1–T7 cerrado (DESIGN.md v2.0 §historial: "T7.4 — cierre de AUDITORIA-TEMA-2026-07.md T7"). El checklist §8 quedó sin marcar — su deuda restante la absorbió y cerró la auditoría de diseño de julio 26. |
| `AUDITORIA-DISENO-2026-07-26.md` | 2026-07-28 | Su plan derivado (`PLAN-DISENO-PENDIENTE.md`) cerró las 5 fases. |
| `PLAN-DISENO-PENDIENTE.md` | 2026-07-28 | Sección "Cierre del plan D0–D4". Gate en 20 de 23 categorías en cero absoluto; las 3 con ratchet son deuda deliberada y documentada. ⚠️ Sus dos abiertos (A1 densidad, `Skeleton` sin adopción) y los 3 ratchet los cerró `PLAN-CIERRE-DISENO-2026-07-29.md`. |
| `PLAN-CORRECCION-AUDITORIA-2026-07-29.md` | 2026-07-29 | P1/P2/P3 aplicados (v2.183–2.187). Su único abierto —224 targets táctiles— lo cerró `PLAN-CIERRE-DISENO-2026-07-29.md` F5 el mismo día, **y de paso corrigió el conteo**: eran 46, no 224. |
| `PLAN-CIERRE-DISENO-2026-07-29.md` | 2026-07-29 | Sección "Resultado (v2.204.0)". F0–F6 cerradas. **Baseline del gate VACÍO**: 25 categorías bloqueantes en cero, contraste 0/0 en 29 rutas, 7 targets bajo 44px y los 7 con motivo escrito. Es el plan que deja el sistema de diseño sin ítems abiertos. |
| `PLAN-PROVEEDORES-2026-07.md` | 2026-07-18 | Cabecera: "CERRADO — Fases 0-5 aplicadas en prod (v2.21.0-v2.22.0)". Los checkboxes de §1–3 quedaron sin marcar; son stale. |
| `PLAN-FACTURAS-COMPRA-2026-07.md` | 2026-07-29 | Fases 1–5 verificadas en prod. Su último bloqueante era reactivar el cron: `sync-purchase-emails-daily` (jobid 183) está `active=true` en prod — verificado el 2026-07-29. |

### Cerrados en la auditoría de planes del 2026-08-05

| Documento | Cerrado | Evidencia del cierre |
|---|---|---|
| `AUDITORIA-CONTEO-2026-07-29.md` | 2026-07-29 | Cabecera: "C1–C7 aplicadas" (v2.183.0, 6 migraciones) + 4 entregas posteriores (v2.201→v2.231). Lo único abierto es el **corte de movimientos**, listado en "Fuera de alcance" como decisión de negocio (contar con la sucursal cerrada), no deuda técnica. |
| `PLAN-MINMAX-Y-CANDADO-2026-07-29.md` | 2026-07-29 | Cabecera "**APLICADO** (F0–F4)" + sección "Cierre — 2026-07-29" con la tabla antes/después medida contra prod. Citado por `CLAUDE.md` (§MIN·MAX) y `src/data/moduleLocks.js`. |
| `AUDITORIA-SUPABASE-2026-07-29.md` | 2026-08-05 | Su roadmap se convirtió en `PLAN-SUPABASE-100` → `PLAN-SUPABASE-CIERRE`, que declara cero puntos técnicos abiertos. Verificado hoy contra prod: `write_always_true` bajó de 21 tablas a **4 policies**. Residuo: PITR y compute (decisiones de facturación) y el POS (proyecto). |
| `PLAN-SUPABASE-100-2026-07-29.md` | 2026-08-05 | F1–F5 cerradas (F3.3→C1, F4.5→C5, F4.7→C4, F5→C2 en el plan de cierre). F4.2 (HIBP) **descartada por decisión explícita** del usuario. Quedan F6/F7 (PITR y compute: dashboard, no código) y F8 (POS). |
| `PLAN-SUPABASE-CIERRE.md` | 2026-07-29 | "**No queda ningún punto técnico abierto en este plan.** Lo que sigue es decisión (PITR) o proyecto (POS)." C2 cerrado en v2.228.0 con baseline verificado 15/15 y `migration repair` aplicado. |
| `PLAN-BUSCADORES-NORMALIZACION.md` | 2026-08-05 | Ver la fila de arriba. |
| `AUDITORIA-PERMISOS-2026-08-03.md` | 2026-08-03 | Cabecera: "auditoría **cerrada y EJECUTADA**" (v2.356.1, v2.360.0, v2.361.0). Desde v2.361.0 la vigila `npm run gate:permisos` en el pre-commit. Su único abierto —`staff_salary`, §8— es **decisión explícita del usuario** y el gate lo imprime como aviso en cada corrida. |
| `AUDITORIA-PROVEEDORES-Y-LIBROS-IVA-2026-08-02.md` | 2026-08-02 | **Absorbida el mismo día** por `docs/PLAN-CONTABILIDAD-2026-08-02.md`, que la sucede porque ésta "quedó incompleta y con dos conclusiones equivocadas". Se conserva porque el plan sucesor la cita por nombre. |
| `HALLAZGO-VENTA-PERDIDA-SALUD1-2026-07-14.md` | 2026-08-04 | "✅ **RESUELTO** — el origen recuperó el registro", verificado por tres vías: `dteqr_pdf.php` genera el documento, el Corte Z reprocesado cuadra al centavo en las 6 sucursales, y el cuadre diario recorrió julio completo con 0 diferencias. |
| `PLAN-METAS-2026-08-03.md` | 2026-08-05 | Diseño del módulo, Fases 1–3 hechas. Su propia cabecera dice que **lo que sigue vive en `PLAN-METAS-CIERRE-Y-GASTOS-2026-08-05.md`**, que es el plan vigente. ⚠️ Las Fases 4–5 siguen abiertas y se rastrean allá, no acá. |
| `RETENCION-IVA-VENTAS-2026-08-04.md` | 2026-08-04 | Documento de cierre: la retención sobre factura de consumidor **no es un error** (Art. 162 inciso 3.º) y el libro no lleva columna de retención (Art. 83/85 RCT). Su único abierto —¿el total del libro es lo cobrado o el valor de la venta? ($48.95)— es una **pregunta al contador** y vive en `docs/PREGUNTAS-CONTADOR-2026-08-03.md`. |
| `PROMPT-MODULO-CLIENTES.md` | 2026-08-05 | Prompt **consumido**: `src/views/ClientesView.jsx` existe y la Fase 1 está en prod (v2.317.0). La Fase 2 —propagar la edición al ERP— se rastrea en `docs/RETOMAR-CLIENTES-2026-08-01.md`. |

### Cerrados en la auditoría de planes del 2026-08-24

Nueve documentos, y **cada cierre se verificó contra producción o contra el
código, no contra lo que decía su encabezado** — que en tres casos decía lo
contrario de lo que había pasado.

| Documento | Cerrado | Evidencia del cierre |
|---|---|---|
| `PLAN-SESIONES-SEGURAS-2026-08-08.md` | 2026-08-09 | Su propia §ESTADO: **CERRADO**, F0–F4 ✅ con versión y verificación medida (el hook devolvió 200 con la actividad fresca y 401 `session idle timeout` envejecida — sin la primera mitad el 401 no probaba nada). F5 no es trabajo pendiente: es «lo que queda anotado y no entra ahora», MFA y la contraseña del carné, las dos con decisión escrita. |
| `PLAN-CANON-MOVIL-2026-08-07.md` | 2026-08-09 | Cabecera «**las cinco fases cerradas**» con la tabla F0–F4. Lo que dejaba vivo lo nombra él mismo y vive en otros dos documentos: la prueba en el aparato (`PRUEBA-EN-TELEFONO-REAL.md`) y el trabón al girar (`RETOMAR-ROTACION-MOVIL-2026-08-08.md`). |
| `PLAN-CIERRE-MOVIL-2026-08-08.md` | 2026-08-24 | F1–F5, F7 y F8 ✅. Sus dos abiertos están **absorbidos**: F6 lo remidió y cerró en su mitad medible `PLAN-MOVIL-2026-08-20.md` §F6 —la cañería del notch, con los insets de un iPhone 13 pisados sobre los tokens `--sa-*`— y lo que sólo puede decir el aparato quedó en `PRUEBA-EN-TELEFONO-REAL.md`; F9 sigue **en pausa por decisión** en `RETOMAR-ROTACION-MOVIL-2026-08-08.md`. |
| `PLAN-MOBILE-2026-07.md` | 2026-07-24 | **Ya figuraba como cerrado en este índice desde el 2026-08-05 y el archivo se había quedado en la raíz.** Su cabecera lo confirma: fases 1–5 ✅ y «los siete criterios de aceptación están cumplidos». |
| `PLAN-MINMAX-AJUSTE-A-MANO-2026-08-20.md` | 2026-08-21 | Las cinco fases APLICADAS **y el §10 también** — el único pendiente que la cabecera daba por abierto contra el 1-sep. La migración `20260821161901` marcó 1,129 filas; medido hoy contra producción: **1,137 con `manual_at`** de 19,045, y `product_stock_params_history` sin una sola fila en el barrido, o sea que no se movió ningún MIN ni ningún MAX. |
| `PRUEBA-TRASLADO-2026-08-11.md` | 2026-08-24 | El guion decía «falta únicamente ejecutar esta prueba». **Se ejecutó**: `pedido_traslado_erp` tiene **26 despachos en modo real** entre el 12 y el 24-ago (más 42 simulacros y 3 errores del 11/12-ago, ya resueltos). |
| `RETOMAR-TRASLADOS-2026-08-06.md` | 2026-08-24 | Cinco de sus seis pasos estaban hechos el mismo 06-ago; el sexto era «una prueba con una unidad, ida y vuelta». Medido: **366 `INVENTORY_TRANSFER_REQUEST` en APPROVED** desde el 17-ago. El circuito no está probado: está en uso diario. |
| `RETOMAR-FICHAS-Y-DTE-2026-08-07.md` | 2026-08-09 | Su propio encabezado: «⚠️ **REEMPLAZADO por `RETOMAR-FACTURACION-Y-DTE-2026-08-09.md`**». Se conserva por el historial —el matcher, los duplicados, la migración—. |
| `BLOQUE-D-CIERRE-DE-PERIODO.md` | 2026-08-13 | Decía «DOCUMENTADO, no ejecutado, pendiente de que Alex lo confirme», y quedó cerrado por los dos lados: `RETOMAR-CONTABILIDAD-2026-08-06.md` §5 lo lista entre los «cerrados por decisión, no por trabajo», y **después se construyó igual** como Paso 3 de `PLAN-CONTADOR-INTERNO-2026-08-12.md` (v2.591.0, cierre de período con pantalla). Verificado en producción: la tabla `periodos_fiscales` existe. |

> **Tres encabezados decían lo contrario de lo que había pasado.** `PLAN-MINMAX-AJUSTE-A-MANO` daba por abierto un §10 que su propio §10 declara HECHO; `PRUEBA-TRASLADO` pedía una prueba que ya había corrido 26 veces; `RETOMAR-TRASLADOS` pedía la primera cuando había 366. Es la misma lección del §«Ojo con los checkboxes» un escalón más arriba: **la cabecera de un plan envejece igual que un checkbox, y cuando envejece miente con más autoridad.** Al auditar, el estado sale de producción o del código — el documento es la hipótesis, no la evidencia.

## Ojo con los checkboxes

Cinco de estos documentos tienen `- [ ]` sin marcar que **no son trabajo
pendiente**: el cierre se escribió en prosa (cabecera o sección de cierre) y
nunca se bajó al checklist. Al leerlos, la cabecera y la sección de cierre
mandan sobre los checkboxes. Se suma `PLAN-BUSCADORES-NORMALIZACION.md` (2 sin
marcar, ambos de la Fase 3 opcional).

## Rutas que quedaron apuntando a la raíz

Al mover los 12 documentos del 2026-08-05 se corrigieron todas las referencias
del código, la documentación y los gates — **menos las de
`supabase/migrations/`**, que se dejaron intactas a propósito: un archivo de
migración es el registro de lo que se aplicó, y su comentario decía la verdad el
día que se escribió. Tres migraciones de Metas citan `docs/PLAN-METAS-2026-08-03.md`
y una de permisos cita `docs/AUDITORIA-PERMISOS-2026-08-03.md`; los dos archivos
viven ahora en esta carpeta.
