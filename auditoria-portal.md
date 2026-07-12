Este es el charter de ejecución del resto de la auditoría (Mes 1 + Trimestre del roadmap de
AUDITORIA-2026-07.md). Trabajalo EN ORDEN, bloque por bloque, parando en cada gate. No es
"hacé todo ya": es una secuencia con precondiciones. Al terminar cada bloque, dame un resumen
corto y seguí con el siguiente salvo que un gate te lo impida.

## REGLA DE PRECEDENCIA (sobre todo lo demás)
Los Refactors estructurales A, B y C NO arrancan hasta que el entorno de staging esté VIVO y
aprobado por mí (Refactor D del prompt anterior). Mientras staging no exista, avanzá solo en
los bloques que no dependen de él (1 y 2). Si llegás a un bloque con gate no cumplido, saltalo,
avisame, y seguí con lo que sí puedas.

## BLOQUE 1 — Higiene y hardening restante (no necesita staging, riesgo bajo)
Cada ítem con la disciplina de siempre (solo el fix, verificar build/lint, cero cambio de lógica):
- CORS: consolidar `Access-Control-Allow-Origin: *` hardcodeado → `getCorsHeaders(req)` con
  PORTAL_ORIGIN en las 12 edge functions listadas en Fase 3.5. Desplegar de a una, verificar
  que el frontend legítimo sigue funcionando (sin 401/CORS nuevos) antes de la siguiente.
- Verificar (no necesariamente cambiar) el pendiente "service_role como Bearer" de
  `set-employee-password`/`bulk-create-employee-users` (quick win #6 / pendiente #3 de Fase 2).
  Si es explotable, entra en órdenes permanentes (cerrar ya); si no, documentá y seguí.
- Quick wins restantes de Fase 6 que NO hice en el prompt anterior: los 2 <select> sin migrar
  (evaluá si admiten swap directo a LiquidSelect sin rediseño; si no, documentá por qué), y
  cualquier resto de código muerto ya confirmado.
- El overflow del DataTable en móvil (Fase 5): PRIMERO diagnosticá la causa raíz (por qué
  `hideBelow` no lo resolvió) y mostrámela con la opción "wrapper por vista" vs. "fix en el
  componente compartido" — NO apliques el parche hasta que yo elija estrategia, porque toca
  un componente usado en 19 vistas.

## BLOQUE 2 — Fundación de testing (hacer TEMPRANO, es la red para los refactors)
Esto va antes que A/B/C a propósito: son la protección contra regresiones de esos refactors.
No necesita staging (funciones puras + preview local).
- Instalar Vitest + @testing-library. Escribir tests SOLO para la lógica pura que YA rompió
  antes: factor de presentación, dispatch rounding del 40% (ya tuvo bug de doble-redondeo),
  `inv_dedup`. Estas son funciones puras y demostraron romper en silencio.
- Convertir los 3-4 flujos que la Fase 5 ya cubrió a mano (login normal + carné, race condition
  del modal de empleado, Pedidos, Dashboard) en un `tests/e2e/smoke.spec.js` versionado.
- Configurar CI que corra ambos en cada PR a main. Regla nueva propuesta para CLAUDE.md:
  "todo fix de bug viene con un test que lo hubiera atrapado". No bloquear merges por cobertura
  todavía — solo que el smoke pase.

## BLOQUE 3 — Refactor A: capa de datos (GATE: staging vivo)
- Diseñá `src/data/` (o `src/hooks/queries/`): un hook por entidad de dominio que resuelva
  internamente la paginación >1000 filas (Patrones A/B/C del CLAUDE.md, una sola vez), manejo
  de error consistente (nunca `const { data } = await` sin chequear `error`), y caché con
  invalidación. Wrapper delgado sobre Zustand con TTL — NO metas React Query completo sin
  proponérmelo primero (es una dependencia nueva grande).
- Entregá el diseño + los primeros 3 hooks + UNA vista piloto (empezá por `WidgetInventorySearch.jsx`,
  que ya tuvo el bug de columna eliminada). Probá la piloto en staging antes de mergear.
- NO migres los 390 sitios existentes: solo la piloto ahora; el resto es oportunista después.

## BLOQUE 4 — Refactor B: partir `fetchBoot` monolítico (GATE: staging + smoke test del Bloque 2)
- Agregá `status` por slice SIN quitar `bootStatus` global todavía (coexisten).
- Migrá primero el consumidor que ya tuvo la race condition (modal de edición de empleado).
- Verificá en staging que ningún consumidor dependía implícitamente del timing del boot antes
  de deprecar `bootStatus`. Este es el refactor de mayor riesgo silencioso — probalo con el
  smoke de la race condition corriendo.

## BLOQUE 5 — Refactor C: dividir TabMinMax.jsx y TabPedidos.jsx (GATE: staging + test)
- Un sub-componente extraído por PR, empezando por el de menor acoplamiento. NO "parar una
  semana": cada extracción es un PR chico, revisable, verificado en staging.
- Antes de extraer una pieza con lógica de conversión/cálculo, asegurate de que esa lógica
  tenga test (Bloque 2) — si no, escribilo primero.

## BLOQUE 6 — kiosk_verify RPC (GATE: staging — pendiente de seguridad 3.2.2)
- La lectura anónima de `kiosk_devices` (SELECT `kiosk_verify`) requiere una RPC SECURITY
  DEFINER nueva que valide device_token internamente. Es cambio de lógica → diseñalo,
  en staging, mostrámelo antes de tocar prod.

## BLOQUE 7 — Features 10x (NO construir sin mi OK — son decisiones de producto)
Para cada una entregá un spec corto (alcance, modelo de datos, esfuerzo, valor) y ESPERA a que
yo elija cuáles y en qué orden. NO empieces a codear ninguna sola.
Prioridad sugerida por valor/esfuerzo: (2) alertas push de fallo de sync a los demás supervisores
[barato, cierra el gap de observabilidad pull], (1) tracker de corto vence [reglas de Bodega ya
documentadas], (3) dashboard de salud de syncs. Las demás (kiosk feedback, export ventas
perdidas, historial de precios, objetos huérfanos, offline kiosk) en el spec pero sin urgencia.
El offline del kiosco es el de mayor esfuerzo — no lo empieces sin decisión explícita.

## ÓRDENES PERMANENTES (vigentes en todos los bloques)
- Solo hacer lo pautado en cada bloque; si ves otro problema, lo documentás en AUDITORIA-2026-07.md,
  no lo arreglás.
- Pausá SIEMPRE para: costo, algo irreversible, el login del ERP, o cualquier cosa operativa que
  reactive comportamiento dormido/manual. Y para toda feature del Bloque 7.
- Si algo es crítico-explotable-ahora (como en Fases 2-3): cerralo en el momento, validación
  negativo+positivo, y avisame después.
- Todo lo estructural se prueba en staging antes de prod, una vez que staging exista.
- Bumpá APP_VERSION + changelog solo si tocás src/; commit + push por bloque; mantené el estado
  de AUDITORIA-2026-07.md al día con lo aplicado.
- Al final de cada bloque: resumen corto + seguí, salvo gate no cumplido o decisión mía explícita.