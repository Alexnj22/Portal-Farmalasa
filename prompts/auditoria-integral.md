# AUDITORÍA INTEGRAL — Portal Farmalasa

Actúa como auditor principal (código + base de datos + seguridad + diseño + arquitectura + producto).
Tu objetivo: evaluar TODO el proyecto de forma exhaustiva y producir un informe accionable.
NO apliques fixes todavía — primero audita, prueba y reporta; los fixes se aprueban después
por prioridad.

**Mandato de honestidad estructural:** el proyecto todavía está a tiempo de cambiar decisiones
de fondo. Si detectas algo estructuralmente mal — arquitectura, modelo de datos, capa de datos,
manejo de estado, patrón de syncs, organización del código — dilo SIN suavizarlo, aunque
implique un refactor grande o rehacer una pieza completa. Un "esto funciona pero está mal
construido y va a doler en 6 meses" vale más que diez hallazgos cosméticos. Para cada problema
estructural incluye: por qué está mal, qué costará si NO se cambia, cómo debería ser, y la
ruta de migración incremental (no big-bang) para llegar ahí.

## Reglas del engagement
- Lee primero CLAUDE.md, DESIGN.md y src/version.js completos. Son la ley del proyecto.
- Usa CodeGraph (codegraph_context/explore/impact) para el análisis estructural; no grep-loops.
- Puedes ejecutar SQL de SOLO LECTURA en Supabase (project sacecdkdmsdvgqnrsett) libremente.
  PROHIBIDO: escrituras, migraciones, o pruebas que inserten datos reales sin pedirme permiso.
- Las pruebas reales de UI: usa el setup de QA de Playwright (vite preview + credenciales de .env,
  según la memoria "QA Browser Setup"). Screenshots como evidencia de cada hallazgo visual.
- Todo hallazgo debe incluir: severidad (Crítico/Alto/Medio/Bajo), archivo:línea o tabla/función,
  evidencia (output real, query, screenshot), y fix propuesto concreto.

## FASE 0 — Línea base
1. `codegraph_status`, `npm run build`, `npm run lint`, tamaño del bundle (analiza el output de Vite).
2. Supabase: `get_advisors` (security + performance), `get_logs` de las edge functions,
   estado de crons, tamaño de tablas, y top queries por tiempo total en `pg_stat_statements`.
3. Reporta la línea base: qué está verde, qué ya está en rojo antes de auditar.

## FASE 1 — Auditoría de código (src/)
- Errores reales: promesas sin catch, `const { data } = await supabase...` sin chequear `error`,
  race conditions, estado stale, useEffect con deps incorrectas, memory leaks (listeners/rAF sin cleanup).
- Cumplimiento de la regla de 1000 filas de PostgREST: busca TODO select/rpc sobre tablas grandes
  (products, inventory, dte_sales, sales_invoices, product_stock_params) sin paginación/Patrón A-B-C.
- Código muerto, duplicación (componentes/utilidades repetidas entre vistas), imports sin usar.
- Consistencia de patrones: ¿todas las vistas usan LiquidSelect, ViewTabBar, DataTable común,
  appendAuditLog en cada acción de usuario? Lista las vistas que NO cumplen.
- Eficiencia React: re-renders innecesarios (props inline, falta de memo donde duele),
  cálculos pesados en render, listas grandes sin virtualización.
- Manejo de errores de cara al usuario: ¿qué pasa si un fetch falla? ¿hay estados de error/loading
  consistentes o pantallas en blanco?

## FASE 2 — Auditoría de Supabase (BD + edge functions)
- RLS: revisa TODAS las policies. Confirma que ninguna llama `auth_*`/`auth.uid()` sin el wrapper
  `(SELECT ...)` (incidente 2026-07-08). Confirma que ninguna tabla expuesta carece de RLS
  y que no hay `USING (true)` en escrituras sensibles.
- Funciones: SECURITY DEFINER sin `SET search_path`, funciones con EXECUTE para anon/PUBLIC
  que no deberían, RPCs SETOF grandes que deberían migrar a Patrón C (RETURNS json + json_agg).
- Rendimiento: índices faltantes (FKs sin índice, seq scans en tablas grandes vía
  pg_stat_user_tables), planes genéricos en RPCs lentos, bloat/autovacuum, churn de escritura
  en syncs (¿algún cron sigue reescribiendo filas sin cambios?).
- Edge functions: lee el código de todas en supabase/functions/. Busca queries que ignoran
  `error`, columnas que ya no existen, falta de retry/timeout, secretos hardcodeados.
- Crons: lista todos, verifica solapamientos, horarios vs. la ventana segura de DDL, y que
  las tablas de log tengan retención.
- Storage: buckets públicos que deberían ser privados, falta de file_size_limit/allowed_mime_types,
  URLs firmadas guardadas en BD (prohibido).
- Auth: flujo de cuentas @staff.local, revocación al dar de baja, exposición de datos en
  employees vs employees_safe (paridad de columnas).

## FASE 3 — Seguridad ofensiva (defensiva)
- Ejecuta el skill /security-review sobre el estado actual y complementa manualmente:
  XSS (dangerouslySetInnerHTML, render de datos del ERP sin sanitizar), IDOR (¿puede un
  empleado leer/editar datos de otro vía RPC o REST directo?), secretos en el repo o en el
  bundle del cliente, CORS de edge functions, rate limiting del kiosk/login por carné.
- Simula con SQL (rol anon y authenticated vía `SET ROLE` en una transacción de solo lectura
  con ROLLBACK) qué puede ver cada rol realmente. Evidencia por tabla.

## FASE 4 — Diseño y UX (usar skill impeccable + DESIGN.md)
- Pase completo de diseño: diffea CADA vista contra DESIGN.md y los estándares (filter pills,
  empty states glassmorphism, tab bar, contraste mínimo text-slate-600/500, sin border-l
  coloreados, badges "Bajo Receta"). Tabla vista-por-vista: cumple / no cumple / evidencia.
- **Móvil**: audita TODAS las vistas en viewport 390×844 y 768×1024 con Playwright.
  Busca: overflow horizontal, tablas ilegibles, targets táctiles <44px, headers flotantes
  rotos, modales que no caben, inputs con zoom forzado en iOS (font-size <16px).
  Si DESIGN.md NO tiene un estándar móvil/responsive definido: CRÉALO (breakpoints,
  patrón tabla→cards, navegación, safe areas, gestos) y agrégalo a DESIGN.md como propuesta.
- PWA/webapp: manifest, iconos, viewport meta, comportamiento offline mínimo, ¿es instalable?
- Accesibilidad básica: focus visible, labels en inputs, navegación por teclado en LiquidSelect
  y modales, roles ARIA en tablas/tabs.

## FASE 5 — Pruebas reales end-to-end
Con Playwright contra vite preview, ejecuta y documenta con screenshots los flujos críticos:
login (normal y carné), Dashboard, Pedidos (preview + impresión), Productos (Devolutivo/ND,
Vencimiento), Laboratorios, Empleados (abrir modal de edición — verifica la race condition
del boot), Ventas, notificaciones. Reporta cualquier error de consola, request fallido,
o estado visual roto. Repite los 3-4 flujos principales en viewport móvil.

## FASE 6 — Veredicto estructural y visión 10x
Esta fase NO es una lista de quick wins. Es la evaluación de fondo: si construyeras este
portal hoy desde cero sabiendo lo que ahora sabes, ¿qué harías diferente? Todavía hay tiempo
de corregir el rumbo — sé directo.

1. **Veredicto arquitectónico honesto.** Evalúa y da un veredicto explícito
   (sólido / aceptable / mal construido — cambiar ya) sobre cada capa:
   - Capa de datos: queries supabase-js dispersos en cada vista vs. una capa de datos
     centralizada (repositorios/hooks compartidos, caché, invalidación). ¿El patrón actual
     escala o cada vista reinventa fetching, paginación y manejo de error?
   - Manejo de estado: stores actuales (staffStore, etc.) — ¿límites claros o un boot global
     del que todo depende? ¿Las race conditions conocidas (campos sensibles al boot) son
     síntoma de un problema de diseño de estado más profundo?
   - Organización del código: tamaño de las vistas (¿hay archivos de 2,000+ líneas que son
     mini-aplicaciones?), acoplamiento entre vistas, ausencia de una capa de componentes de
     dominio reutilizables vs. copy-paste entre módulos.
   - Modelo de datos: ¿el esquema refleja el negocio o arrastra el modelo del ERP? Tablas o
     relaciones que ya muestran fricción (duplicados de inventory, factores de presentación,
     multi-sucursal). ¿Qué costará cambiar en 1 año lo que hoy cuesta una semana?
   - Pipeline de syncs (ERP → Supabase): resiliencia real — ¿qué pasa si el ERP cambia un
     campo, si un cron se solapa, si falla 3 días seguidos? ¿Hay observabilidad o se descubre
     cuando un usuario reporta datos viejos?
   - Testing: hoy no existe. ¿Cuál es la estrategia mínima viable que protege los flujos
     críticos (Vitest para lógica de conversión/pedidos + Playwright CI para smoke) y cómo
     se introduce sin frenar el desarrollo?
   - Deployment y entornos: ¿existe staging o todo va directo a producción? Riesgo real de
     ese modelo dado el incidente del 2026-07-08.
2. **Decisiones baratas hoy, caras mañana.** Lista explícita de las cosas que son fáciles de
   cambiar AHORA (poca superficie, pocos usuarios afectados) y prohibitivas después. Ordénalas
   por ventana de oportunidad: qué se cierra primero.
3. **Refactors estructurales propuestos.** Para cada uno: problema, diseño objetivo, ruta de
   migración incremental (fases que caben en releases normales), esfuerzo estimado, y qué
   pasa si no se hace. Sin límite de tamaño — si lo correcto es rehacer la capa de datos
   completa, propónlo.
4. **Nuevas features (5-8).** Fundamentadas en lo que viste en los datos y flujos reales
   (ej. tracker de corto vence según las reglas de Bodega ya documentadas, alertas proactivas,
   dashboards que faltan, mejoras al kiosk). Cada una con esfuerzo estimado y valor de negocio.
5. **Quick wins** (top 10, <1 día) — al final y como sección secundaria; nunca a costa de
   omitir un problema estructural.

## ENTREGABLE
Escribe `AUDITORIA-2026-07.md` en la raíz del repo con:
1. Resumen ejecutivo (estado general en 1 párrafo + score por área /10 + veredicto
   arquitectónico en una línea por capa).
2. Hallazgos por severidad (Críticos primero), cada uno con evidencia y fix propuesto.
3. Sección "Estructural": los veredictos de la Fase 6 con sus rutas de migración.
4. Tabla de cumplimiento de estándares vista-por-vista.
5. Propuesta de estándar móvil (si no existía) lista para pegar en DESIGN.md.
6. Roadmap priorizado: Semana 1 (críticos), Mes 1 (altos + inicio de refactors estructurales),
   Trimestre (refactors completos + features 10x).
Al final, pregúntame qué grupo de fixes quieres que aplique primero. No apliques nada antes.
