# Plan — los catálogos cuyo rótulo ES el dato

> **Estado: CERRADO el 2026-08-13.** Grupo 1 (v2.571.11 y v2.590.5), grupo 3
> (v2.590.2), el hallazgo del tipo de incapacidad (v2.590.5) y el grupo 2
> (v2.590.6, con sus migraciones `20260813175945` y `20260813180317`). Abierto
> el 2026-08-12 al cerrar el barrido de §26.4 (v2.571.8 y v2.571.10).
>
> Lo único que queda anotado y sin decidir: la redacción de
> `Excepción turno (kiosk)` ya se resolvió, pero conviene revisar si el resto de
> `REQUEST_TYPES` usa jerga del sistema en algún otro rótulo.

## Por qué existe

Al unificar el portal a sentence case quedaron 343 etiquetas candidatas. La
mayoría se resolvió cambiando una línea, porque el rótulo es texto de pantalla y
lo que se guarda es un código:

```js
{ value: 'ABC', label: 'Polvo químico seco (ABC)' }   // se guarda 'ABC'
{ value: '44',  label: 'Tiempo completo 44h' }        // se guarda '44'
DISABILITY: { label: 'Incapacidad médica' }           // se guarda 'DISABILITY'
```

Quedan **tres grupos donde eso no vale**, y cada uno rompe de una forma
distinta. Este documento los separa para que nadie los trate como un problema de
mayúsculas.

---

## Grupo 1 — el rótulo se cruza contra otra tabla, y no coincidir NO falla

> ### ✅ CERRADO el 2026-08-12 (v2.571.11)
>
> **El bug era real y estaba vivo.** Medido contra las 24 filas de `roles`: la
> tabla dice **`Regente de Enfermeria`** (id 23, sin tilde) y el formulario
> ofrecía **`Regente de Enfermería`** (con tilde). Relevar a un regente de
> enfermería guardaba `role_id: null`, sin error y sin log. Los otros tres
> cargos sí coincidían.
>
> Lo aplicado:
> - `src/utils/roles.js` — `buscarCargo` (exacta primero, normalizada después) y
>   `opcionesDeCargo`, que arma el desplegable **desde la tabla**.
> - `FormLeadership.jsx` — se borró el arreglo literal de cuatro cargos; ahora
>   lee `roles` del store (que ya los traía de la base) y el texto que se
>   muestra sale de la fila real. El valor por defecto, también.
> - `UnifiedModal.jsx` — el `? :` que convertía "no encontré el cargo" en
>   `role_id: null` se reemplazó por un **freno**: si no resuelve, no escribe y
>   lo dice. Y `employees.role` y la bitácora guardan `outRoleObj.name`, o sea
>   el nombre que de verdad quedó.
> - `FormNovedad.jsx` — la guarda de cupo usaba el mismo `find` exacto: si no
>   calzaba, el aviso de "cargo lleno" se saltaba entero.
> - `systemSlice.js` — ya lanzaba en vez de escribir nulo (era el patrón
>   correcto y sirvió de modelo); sólo se le dio la misma tolerancia al acento.
>
> Verificado con los datos reales: `Regente de Enfermería` pasó de `NULL` a
> `id 23`, guardando `«Regente de Enfermeria»`. Cero errores de consola.
>
> **Queda pendiente de este grupo:** el literal `'Sin Asignar'` que
> `UnifiedModal.jsx` escribe en `employees.role` (dos sitios). Es otro rótulo
> que es dato y no se tocó en esta pasada.

**El más peligroso, y el único que ya era un bug, independiente de las
mayúsculas.**

Cuatro cargos están escritos a mano en `src/components/forms/FormLeadership.jsx`:

```js
{ value: 'Dependiente de Farmacia', label: 'Dependiente de Farmacia' },
{ value: 'Subjefe/a de Sala',       label: 'Subjefe/a de Sala' },
{ value: 'Jefe/a de Sala',          label: 'Jefe/a de Sala' },
{ value: 'Regente de Enfermería',   label: 'Regente de Enfermería' },
```

y `src/components/UnifiedModal.jsx` los cruza contra la tabla `roles`:

```js
// UnifiedModal.jsx:514
const outRoleObj = roles.find(r => r.name === formData.outgoingRole);
await updateEmployee(formData.currentAssignee, {
    role_id: outRoleObj ? outRoleObj.id : null,   // ← sin coincidencia: null, sin error
    role:    formData.outgoingRole,
});
```

Si el string del formulario deja de coincidir con `roles.name`, `find` devuelve
`undefined` y **el empleado se guarda con `role_id: null`**. No lanza, no avisa,
no queda en el log. Es la misma familia que
`feedback_sin_policy_de_update_el_write_devuelve_cero`: la escritura "funciona" y
no hace lo que dice.

`roles` es una tabla real, sembrada en
`supabase/migrations/20260729223031_seed_catalogo_minimo_para_branches.sql`
(`(30, 'Dependiente de Farmacia', …)`). O sea que la lista del formulario es una
**copia a mano de un registro que ya existe** — exactamente
`feedback_lista_a_mano_se_desincroniza_del_registro`.

### Qué hacer, y en qué orden

**El renombre NO es el arreglo.** El arreglo es quitar la copia:

1. **Medir primero.** Traer `select id, name from roles order by id` y compararlo
   con la lista escrita a mano. No asumir que coinciden hoy: si ya divergen, hay
   empleados con `role_id` nulo y eso se arregla antes que ninguna mayúscula.
2. **Leer `roles` de la base** en `FormLeadership`, como ya hace el resto del
   portal, y borrar el arreglo literal. Con eso desaparece la posibilidad de
   divergencia y el `role_id: null` silencioso.
3. **Recién entonces** la ortografía del cargo es una decisión de un solo lugar:
   se cambia `roles.name` con una migración y la pantalla sigue.
4. Mientras tanto, el `? :` que produce el null merece un freno explícito: si no
   hay `outRoleObj`, no escribir — avisar.

**No tocar los payloads históricos.** `audit_logs` y los eventos de empleado
guardan `new_role: 'Dependiente de Farmacia'` como registro de lo que pasó ese
día. Eso es historia y no se reescribe
(`feedback_el_estado_actual_no_conserva_el_evento`). Los registros viejos se
quedan con la ortografía vieja, y está bien.

**Relacionado, mismo archivo:** `UnifiedModal.jsx:536` y `:544` escriben el
literal `'Sin Asignar'` en `employees.role`. Es otro rótulo que es dato, y entra
en el mismo trabajo.

> ### ✅ CERRADO el 2026-08-13 (v2.590.5) — y la premisa era falsa
>
> **`employees` no tiene columna `role`.** Sus columnas de cargo son `role_id`,
> `secondary_role_id` y `system_role`. El store deriva `role` de `role_id`, y
> `updateEmployee` hace `delete dbPayload.role` antes de escribir y lo vuelve a
> calcular después del UPDATE. O sea que los `role: …` del payload eran inertes
> **en las dos puntas**: no llegaban a la base y no sobrevivían en memoria.
>
> El comentario que dejó v2.572.1 —«así `employees.role` y `role_id` cuentan
> siempre la misma historia»— describía una columna inexistente. Es el mismo
> error que esta regla persigue, en su forma más barata: creerle al nombre en
> vez de mirar el esquema ([[feedback_nombre_de_columna_no_es_su_tipo]]).
>
> Lo aplicado: fuera los tres `role:` de los payloads y el comentario; el
> rótulo pasa a la constante `SIN_ASIGNAR` en vez de estar escrito a mano en
> **once** lugares, en sentence case; y la bitácora anota `targetRoleObj.name`
> —el cargo que de verdad quedó— en lugar del texto del formulario.

---

## Grupo 2 — el rótulo lo genera Postgres, no el navegador

Cuatro etiquetas viven **también** dentro de funciones de la base, así que
cambiar sólo el frontend deja las dos mitades diciendo cosas distintas:

| etiqueta | dónde vive en la base |
|---|---|
| `Permiso / Licencia` | 5 migraciones — títulos de aviso de solicitudes |
| `Anticipo Salarial` | las mismas 5 |
| `Traslado entre Salas` | 3 migraciones de avisos de traslado |
| `Facturas de mi Sala` | 7 migraciones de Facturas de Sala (RPC, cron, storage) |

Son títulos de notificación construidos server-side. El cambio es una migración
que reemplaza el literal en cada función, en el mismo commit que el cambio del
frontend, y **con su archivo local nombrado con la versión de 14 dígitos que
devuelva `apply_migration`** (CLAUDE.md). Con `SET lock_timeout = '5s'`.

Prioridad baja: hoy las dos mitades coinciden, así que no hay defecto — sólo
queda pendiente el sentence case.

> ### ✅ CERRADO el 2026-08-13 (v2.590.6) — y «prioridad baja» estaba mal
>
> **Las dos mitades ya NO coincidían.** El barrido de §26.4 (v2.571.8/.10) pasó
> por el frontend y dejó la base atrás, así que **nueve** tipos de solicitud se
> llamaban distinto según quién escribiera el texto:
>
> | tipo | Bandeja | Notificación |
> |---|---|---|
> | ANNULMENT_REQUEST | Anulación de factura | Anulación de **F**actura |
> | PAYMENT_CHANGE_REQUEST | Cambio de forma de pago | Cambio de **F**orma de **P**ago |
> | VENDOR_CHANGE_REQUEST | Cambio de vendedor | Cambio de **V**endedor |
> | CLIENT_CHANGE_REQUEST | Cambio de cliente | Cambio de **C**liente |
> | INVENTORY_LOAD_REQUEST | Carga de inventario | Carga de **I**nventario |
> | INVENTORY_DISCARD_REQUEST | Descarte de inventario | Descarte de **I**nventario |
> | SHIFT_CHANGE | Cambio de turno | Cambio de **T**urno |
> | OVERTIME | Horas extra | Horas **E**xtra |
> | SHIFT_EXCEPTION | Excepción turno (kiosk) | Excepción de Turno |
>
> O sea que no era deuda cosmética pendiente: era **esta misma deriva, ya
> ocurrida**, y en la mitad que la gente lee en el teléfono. La lección para el
> próximo plan: «las dos mitades coinciden» es una MEDICIÓN, no un supuesto —
> este documento lo dio por hecho el 12-08 y llevaba días sin ser cierto.
>
> **La tabla de arriba también estaba mal contada.** Los rótulos viven en DOS
> funciones (`notificar_solicitud_creada`, `avisar_facturas_de_sala`), no en las
> 5/5/3/7 migraciones que decía: eso era cuántas veces se reescribió la función,
> no cuántas hay. Salió de `pg_proc`, que es donde vive la respuesta.
>
> `SHIFT_EXCEPTION` era el único con dos redacciones distintas de verdad.
> Decisión del usuario: gana la base («Excepción de turno») y el frontend suelta
> el «(kiosk)», que es jerga del sistema.
>
> Verificación: los cuerpos salieron de `pg_get_functiondef` sobre producción
> —el catálogo, no el repo—; partidos en renglones y apartados los 33 con
> rótulos, el md5 del resto quedó idéntico al de prod en ambas funciones.
> Migración `20260813180317`, probada antes en el entorno de pruebas.
>
> **Y `roles` quedó limpia** (`20260813175945`): los ids 9 y 22 ya no terminan
> en espacio.

---

## Grupo 3 — texto libre guardado como texto

| etiqueta | dónde | forma |
|---|---|---|
| `Renuncia Voluntaria` | `FormNovedad.jsx` | motivo de baja, `value === label` |
| `Permisos y Licencias`, `Documentos Legales`, `Fiscal y Financiero`, `Operativo y Logística`, `Recursos Humanos` | `FormAddCustomDocument.jsx` | categoría de documento, `value === label` |

Acá sí es un `UPDATE` corriente: cambiar el literal en el formulario y las filas
ya guardadas, en el mismo commit. Antes hay que **contar cuántas filas hay con
cada valor** — si son pocas, es trivial; si son miles, va con `lock_timeout` y
fuera del horario de los crons.

`Recursos Humanos` probablemente se queda como está: es el nombre de un
departamento, no una etiqueta común.

> ### ✅ CERRADO el 2026-08-13 (v2.590.2)
>
> **El conteo dio cero, y por eso salió más barato de lo previsto.** Medido
> contra producción antes de tocar nada:
>
> | qué | cuánto |
> |---|---|
> | `employee_events` en total | 4 (3 traslados, 1 cambio de cargo) |
> | de tipo baja (`TERMINATION`) | **0** — `terminationReason` nunca se escribió |
> | empleados `INACTIVO` | 0 de 47, consistente con lo anterior |
> | `branches` con `settings` | 8 de 8, con `rent\|legal\|location\|services` |
> | documentos en `customDocs` | **0** en las 8 |
>
> Ese cero se comprobó contra el instrumento antes de creerlo: la cuenta que
> consultó ve eventos de **cuatro empleados distintos, ninguno el suyo**, o sea
> que la policy le abre la tabla entera. Un cero por permisos se habría visto
> igual que un cero de verdad — ver
> [[feedback_cero_hallazgos_y_cero_datos_se_ven_igual]].
>
> **Sin `UPDATE` que hacer, se hizo lo que sólo es gratis ahora: separar la
> clave del rótulo**, en vez de corregir la mayúscula y dejar el defecto para la
> próxima. `src/data/constants.js` gana `TERMINATION_REASONS` y
> `CATEGORIAS_DOCUMENTO` con la forma de `EVENT_TYPES` (clave → `{ label }`),
> más `opcionesDeCatalogo` y `categoriaDeDocumento`.
>
> Dos decisiones que conviene no revertir sin pensarlo:
>
> 1. **`categoriaDeDocumento` acepta el rótulo viejo**, con o sin tildes y con
>    cualquier mayúscula. No sobra por más que hoy no haya filas: un respaldo,
>    otro entorno o una copia vieja en el navegador lo pueden traer. Lo que no
>    reconoce cae en `OTRO`, que es una sección que **sí** se pinta —un
>    documento mal clasificado se ve; uno sin sección desaparece de la pantalla
>    sin dar error—. `tests/unit/catalogos.test.js` fija los seis rótulos
>    exactos.
> 2. **`deleteEmployee` dejó de aceptar texto libre.** Tenía `'Baja general'`
>    por omisión: un valor fuera de todo catálogo que dejaba el evento sin
>    causa contable y no fallaba. Hoy exige la clave, y si no resuelve no
>    escribe y avisa. No la llama nadie, y era justo la vía por la que volvía
>    el defecto.
>
> `Recursos Humanos` quedó como estaba —es el departamento— y ahora eso no
> cuesta nada, porque el rótulo dejó de ser el dato.

---

## Hallazgo nuevo (2026-08-13) — el rótulo que además es la CONDICIÓN

No estaba en ningún grupo porque el filtro del plan buscaba `value === label`, y
acá **no coinciden**: `FormNovedad.jsx` ofrece
`{ value: 'Enfermedad Común', label: 'Enfermedad común (padecimiento o embarazo)' }`
y dos más. Pero el `value` sigue siendo un rótulo en Title Case guardado como
dato, y encima se compara por igualdad **en seis lugares** del mismo archivo:

```js
formData?.disabilityType === 'Maternidad'      // ← decide los 112 días del Art. 309
```

O sea que reescribir ese texto no desincroniza una lista: **apaga la regla de
las 16 semanas de maternidad**, en silencio. Es el mismo defecto de grupo 1
—cruzar por texto— pero contra un literal en vez de contra una tabla, que es por
qué ningún filtro por `value:` lo iba a encontrar.

Medido igual que el grupo 3: **cero eventos de incapacidad guardados**, así que
convertirlo a claves (`ENFERMEDAD_COMUN`, `RIESGO_PROFESIONAL`, `MATERNIDAD`)
también es gratis hoy.

> ### ✅ CERRADO el 2026-08-13 (v2.590.5)
>
> `DISABILITY_TYPES` en `src/data/constants.js`, las seis comparaciones contra
> la clave, y `tipoDeIncapacidad` como puente con lo guardado antes — **sin
> valor de respaldo**, a diferencia de `categoriaDeDocumento`: devuelve `null`
> y el formulario obliga a elegir. Un documento mal clasificado se ve y se
> corrige; un tipo de incapacidad adivinado decide mal los 112 días.
>
> Verificado en el navegador contra el entorno de pruebas: con maternidad
> elegida y primer día 01/09/2026, la fecha de retorno se calcula sola en
> 21/12/2026 y el panel dice «Días calculados: 112».

---

## Lo que NO entra en ningún grupo, y por qué

Se revisaron y se dejan como están:

- **Nombres propios:** bancos (`Banco Cuscatlán`) y AFP (`AFP Confía`).
- **Documentos con nombre oficial:** `CCF — Crédito Fiscal`,
  `COF — Consumidor Final`, `Carné JVPQF — Regente / Químico Farmacéutico`,
  `Solvencia Municipal`, `Partida de Nacimiento`, `Constancia Laboral`.
- **Términos ya decididos del portal:** `Sistema de Ventas` y `Sis. Ventas` (así
  se nombra al origen en pantalla — nunca «ERP»), `Bajo Receta`, `Min / Max`,
  `Libros IVA`, `Corte Z`.
- **Mayúsculas por diseño:** los encabezados de columna y las versalitas, que el
  tema pinta en caps; §26.4 los exceptúa explícitamente.
- **Ejemplos de marcador de posición** (`Ej: Juan Perez`), donde la mayúscula es
  contenido y no formato.

---

## Orden sugerido

> Los tres pasos están hechos (2026-08-13). Se dejan como registro de en qué
> orden convino atacarlos y por qué.

1. **Grupo 1, paso 2** — leer `roles` de la base y borrar la lista a mano. Es el
   único que arregla un defecto real y no depende de ninguna decisión de
   redacción.
2. **Grupo 3** — un `UPDATE` chico, si el conteo de filas lo permite.
3. **Grupo 2** — cosmético, cuando toque tocar esas funciones por otra cosa.
