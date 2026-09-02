# Brief común — auditoría total del Portal Farmalasa (2026-09-01)

Sos un auditor de código. Tu trabajo es LEER archivo por archivo el conjunto que te
asignaron y reportar hallazgos con evidencia. Es una auditoría de SOLO LECTURA.

## Reglas duras
1. **NO edites ningún archivo del repo. NO corras git (ni add, ni stash, ni checkout).**
   Hay otras sesiones trabajando en este mismo árbol. Sólo escribís en `docs/auditoria-2026-09-02/informes/` y en la bitácora de `PLAN.md`
   (nunca en `src/`, `supabase/`, ni en ningún otro archivo del repo).
2. **NO escribas en la base de datos.** Si usás `execute_sql` (project `sacecdkdmsdvgqnrsett`) es SOLO
   con SELECT / EXPLAIN. Nunca INSERT/UPDATE/DELETE/DDL.
3. **Leé los archivos ENTEROS**, no sólo grep. El defecto típico de este portal no da error:
   una consulta que devuelve 0 filas, un `find` que devuelve `undefined` y se sigue
   escribiendo `null`, un `.eq('col', true)` sobre una columna `text`, una pestaña en
   `useState`. Eso sólo se ve leyendo.
4. **Cada hallazgo lleva evidencia**: `archivo:línea` + la cita del código (2–6 líneas).
   Si no lo podés confirmar leyendo, marcalo `por confirmar` y decí qué habría que correr.
   No inventes: un hallazgo falso cuesta más que uno que falta.
5. Escribí en español, con la voz del proyecto (directa, sin jerga de tubería, sin
   nombrar «ERP» en textos de pantalla).
6. Antes de reportar algo como «falta», buscá si ya existe en otro lado del repo
   (`src/utils`, `src/components/common`, `src/hooks`). Si existe un canónico y el
   archivo no lo usa, ESE es el hallazgo (duplicado), no «falta».
7. Los gates del repo (`npm run gate:*`) ya vigilan cosas mecánicas. No repitas lo que
   un gate ya reporta salvo que hayas encontrado un caso que el gate NO ve.

## Qué buscar (checklist — recorrela para CADA archivo)
### Lógica y datos
- Bugs: condiciones al revés, `||` donde va `??`, `Number('')` → 0, fechas sin hora
  leídas como UTC (retroceden un día), `parseInt` sin radix, `.find()` que puede fallar y
  se sigue escribiendo, `async` sin `await`, promesas sin catch, `useEffect` con deps
  incompletas que dejan estado viejo, race conditions (doble clic, doble submit).
- **Límite 1000 filas PostgREST**: cualquier `.select()`/`.rpc()` sobre tablas grandes
  sin `fetchAllRows` ni paginación; `.in()` sobre columna no única; `.limit(1000)`;
  un `.range()` con tope seguido de `.filter()` en JS.
- **Tipo de columna vs nombre**: `.eq('x', true)` — verificar contra
  `scripts/db/boolean-columns.json`.
- Errores ignorados: `const { data } = await supabase...` sin leer `error`.
- Escrituras que «funcionan» sin hacer nada: update/insert cuyo resultado no se
  verifica; RLS que puede devolver 0 filas en silencio.
- Estados de carga/error/vacío: ¿se distinguen los tres? (`StateViews`)
- Permisos: ¿la pantalla esconde lo que el servidor de todos modos permite, o al revés?
  Toda acción de usuario → `appendAuditLog`. Toda exportación → `exportCsv` con módulo.
- Formularios largos (≥6 controles) → `saveDraft`/`loadDraft`.
- Dinero: nunca `type="number"`; redondeo a 2 decimales consistente; sumas de
  presentaciones distintas sin unidad.
- Turnos/horario: cualquier lógica propia de `shiftId`/`customStart` es un duplicado
  de `src/utils/turnoDelDia.js`.
### Duplicación y estructura
- Código copiado entre archivos (mismo bloque en 2+ sitios) — citar ambos.
- Helpers locales que ya existen como canónico.
- Archivos/funciones/exports muertos (nadie los importa). Usá `codegraph_callers` o grep.
- Archivos gigantes (>800 líneas) que mezclan vista + datos + reglas.
### Eficiencia
- N+1 (un query por fila en un loop), `Promise.all` que debería chunkear, re-renders
  (objetos nuevos en deps, `useMemo` que falta o sobra), listas sin virtualizar con
  miles de filas, imports estáticos de librerías pesadas (pdfmake, xlsx, jspdf, zxing,
  imgly, chart) — deben ir por `await import()`.
- Polling sin cleanup; suscripciones realtime que no se cierran; timers huérfanos.
### Visual / canon (DESIGN.md — leé §5, §14, §15, §16, §17, §18, §26 «Voz», §29, §31, §32, §33)
- `<select>` nativo → `LiquidSelect`. `<input>`/`<textarea>` crudos → `PortalInput`/`PortalTextarea`.
- Colores crudos (`bg-blue-500`, `#hex`, `rgb(`) fuera de tokens.
- Pestañas en `useState` → `usePestanaEnUrl`. Página de tabla en la URL.
- `DataTable` en teléfono: `usarAccionDeFila`, `apilada`, `acciones`, `movil={false}` con motivo.
- Blancos de dedo 44pt, acuse de toque, `--sa-*` (nunca `env()` a mano).
- Textos: nunca «ERP», «sync», «anaquel» (es vitrina/estante), «Abx» (es «Bajo Receta»).
  Mirar también `title`, `aria-label`, `placeholder`.
- Estados vacíos dibujados a mano en vez de `StateViews`; modales que no usan el canónico.
- Accesibilidad: botones sin rótulo, iconos sin `aria-label`, contraste.
- ¿Le falta algo al canon? Si un patrón se repite 3+ veces sin componente canónico,
  proponerlo como «nuevo canónico».
### Seguridad
- Secretos en el cliente, `service_role` en src/, URLs con tokens.
- Validaciones que sólo viven en el navegador para acciones sensibles (anular, pagar,
  borrar, cambiar contraseña, cambiar cargo).
- `dangerouslySetInnerHTML`, `eval`, `window.open` con datos del usuario.
### Mejoras y funciones nuevas
- Qué le falta al módulo para estar completo desde el punto de vista del negocio
  (una farmacia con 7 salas en El Salvador: ventas, DTE/Hacienda, inventario, personal
  bajo el Código de Trabajo, cortes de caja, traslados, bitácoras reguladas).
- Marcá estas como `mejora` o `nueva-funcion`, separadas de los defectos.

## Formato del informe
Escribí el informe COMPLETO en
`docs/auditoria-2026-09-02/informes/<lote>.md` con esta estructura:

```
# Informe — <área(s)>
Archivos leídos: N de M (lista los que NO pudiste leer y por qué)
Líneas: N

## Resumen
- grave: N · medio: N · menor: N · mejora: N · nueva-funcion: N

## Hallazgos
### [G-1] <título corto>            ← G=grave, M=medio, m=menor, X=mejora, N=nueva-funcion
- Área: <id>  · Archivo: `ruta:línea`  · Confianza: confirmado | por confirmar
- Qué pasa: <2–4 líneas>
- Evidencia:
  ```js
  <cita>
  ```
- Por qué importa: <1–2 líneas, en términos del negocio si aplica>
- Cómo se arregla: <1–3 líneas>
- ¿Ya lo sabía el repo?: sí (docs/X.md §Y / CLAUDE.md) | no

## Lo que está bien y conviene no perder
<3–8 bullets>

## Archivo por archivo
<una línea por archivo: `ruta` — líneas — estado (limpio | hallazgos: G-1, m-3) — nota de 1 línea>
```

Severidades: **grave** = dato que sale mal, dinero, seguridad, pérdida de trabajo, algo
que no funciona. **medio** = regla del repo rota, duplicado que ya divergió, eficiencia
que se nota. **menor** = higiene. **mejora**/**nueva-funcion** = no es defecto.

## Cómo se escribe el informe (esto es lo que falló dos veces)
**El informe se escribe INCREMENTALMENTE, no al final.** Las dos primeras corridas
de esta auditoría murieron por límite de tokens con 20 agentes leyendo en paralelo, y
como cada uno pensaba escribir al terminar, no quedó NADA. Regla:

1. Al empezar el lote, creá `docs/auditoria-2026-09-02/informes/<lote>.md` con el
   encabezado y la sección «Archivo por archivo» vacía.
2. Después de leer CADA archivo, agregá su línea en «Archivo por archivo» y sus
   hallazgos en «Hallazgos». Un archivo leído = un `Edit` al informe. No acumules.
3. Si te cortan, el que retoma lee el informe, ve cuál fue el último archivo anotado
   y sigue desde el siguiente de la lista del lote.
4. El «Resumen» con conteos se escribe al final, y ahí se marca el lote como
   `hecho` en la bitácora de `PLAN.md`.

## Lo que se anota en PLAN.md al cerrar el lote
Una fila en la bitácora: lote · estado · conteos G/M/m/X/N · los 3 hallazgos más
graves en una línea. Nada más — el detalle ya está en el informe.
