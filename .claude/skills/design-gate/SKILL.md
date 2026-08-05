---
name: design-gate
description: Historia y reglas de operación de `npm run gate:design` — cómo funciona el ratchet contra `scripts/design-gate-baseline.json`, por qué las 24 categorías están hoy en cero absoluto, la trampa de claves duplicadas en `EXCEPTIONS`, y cuándo se regenera el baseline. Cargar al trabajar en tema, estandarización visual, colores crudos, elementos nativos del navegador, o al tocar `scripts/design-gate.mjs` / el baseline.
---

# Gate de diseño — cómo opera y por qué

El disparador vive en `CLAUDE.md` («Estándares del proyecto»): antes de cerrar
cualquier trabajo de tema o estandarización visual, correr `npm run gate:design`
y que pase en verde. Las excepciones legítimas viven en `scripts/design-gate.mjs`
(const `EXCEPTIONS`) y en `DESIGN.md` §6/§14. Este archivo es el resto: la
historia que explica por qué el gate está configurado como está.

## El ratchet

**Desde D0 de la auditoría de diseño (2026-07-26) el gate funciona por
ratchet, no por cero absoluto**
(`docs/planes-cerrados/AUDITORIA-DISENO-2026-07-26.md`): falla si
una categoría SUBE respecto a `scripts/design-gate-baseline.json`, no por
tenerla en rojo. Un gate permanentemente rojo no lo mira nadie — que es
exactamente cómo se acumuló esta deuda.

## Estado actual

**Estado al 2026-07-29 (cierre del plan `PLAN-CIERRE-DISENO-2026-07-29.md`):
el baseline está VACÍO y las 24 categorías son bloqueantes en cero absoluto.**
Las cinco que arrancaron con deuda en D0 (`white` 1094, `typography` 4490,
`z-index` 552, `hex` 32, `motion` 30) se cerraron en D1/D2; la última con
ratchet era `input-a-mano`, cerrada al pasar sus 3 archivos —login, kiosco y
el campo del ⌘K, todas superficies bespoke de DESIGN.md §25.4— a `EXCEPTIONS`
**con su motivo escrito**, que es más fuerte que tolerarlos por número: ahora
un `<input>` a mano en cualquier OTRO archivo falla el gate.

Categoría nueva del mismo cierre: **`celda-a-mano`** (un `<td>` crudo dentro
de un `<DataRow>` — saltea `DataCell` y con él la densidad de fila).

**2026-08-05 — el baseline dejó de estar vacío**: entró `carril-pildora` con
**15 hallazgos en 10 vistas**. Detecta el carril de tarjetas y la píldora en
renglones separados (falta `lg:flex-row` en el contenedor, o `flex-1` en el
carril). No es estética: `useMedidaFila` busca el carril en el ABUELO de la
píldora, en renglones separados lo encuentra igual y le descuenta 314px por un
carril que no tiene al lado — el layout equivocado no falla, roba ancho en
silencio.

Nació con deuda, así que va por **ratchet** y no bloqueante en cero: 15
hallazgos preexistentes que se bajan vista por vista. Bajarlos NO es mecánico —
§17.0 pide verificar a dos anchos (1280 y 1600) porque angostar la tarjeta a
148px destapa truncamientos.

Se agregó porque la regla **ya estaba escrita en tres lugares** —DESIGN.md
§17.0, la memoria `feedback_la_pildora_va_en_la_fila_de_las_tarjetas` y el
comentario de `ConteoInventarioView`— y se rompió igual: se copió el layout de
`ClientesView`, que tiene la excepción MEDIDA, a una pestaña cuya píldora era
mucho más chica. Una excepción medida no se hereda; es el caso de manual de
[[feedback_la_regla_que_solo_vive_en_prosa_se_rompe]].

**Cuidado con `EXCEPTIONS`:** es un objeto literal, así que una clave repetida
hace que la segunda pise a la primera **en silencio**. Había 4 duplicados sin
detectar. Lo verifica `assertSinClavesDuplicadas` al arrancar el gate: cada
archivo va en UNA entrada con todas sus categorías.

`chart-retirado` y `chip-a-mano` llegaron a **0 el 2026-07-28** y quedaron
bloqueantes: los 3 categóricos retirados se migraron a su destino (424
referencias en 51 archivos) y los 7 chips restantes se resolvieron uno por
uno. `chart-8` salió de la lista de retirados porque no lo estaba: es el
NEUTRO de la paleta y está vivo (`--chart-8-solid` tiene valor propio, el
`neutral` de `Badge` se apoya en él, y tiene familia completa de glows).

Las tres bloqueantes agregadas en D3/D4 — `button-name`, `paleta-cerrada`,
`input-sin-nombre` — no van al baseline: una categoría que no figura en el
JSON arranca bloqueante sola (`baseline[c] ?? 0`).

## Regenerar el baseline

Al BAJAR deuda (cada fase del plan baja la suya), regenerar con
`npm run gate:design -- --update-baseline` y commitear el JSON. **Nunca
regenerarlo para tapar un hallazgo nuevo**: si una categoría subió, es
código nuevo que hay que arreglar. Cuando una categoría llega a 0 queda
bloqueante para siempre.
