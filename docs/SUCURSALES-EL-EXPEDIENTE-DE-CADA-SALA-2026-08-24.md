# Sucursales — el expediente de cada sala, y las tres numeraciones que no son la misma

**Escrito el 2026-08-24**, durante la auditoría completa del portal. Era una de
las once áreas sin documento propio.

Una sucursal es, para el portal, **cuatro cosas a la vez**: una fila en
`branches`, un expediente legal con documentos que vencen, un conjunto de
identificadores con los que otros sistemas la nombran, y un lugar físico con
horario. Casi todos los errores del área vienen de confundir una con otra.

---

## 1. Las tres numeraciones, y por qué la equivocada no da error

Este es el punto más caro del área. Cada sala tiene **tres** identificadores
distintos y ninguno se deduce de los otros:

| identificador | qué es | ejemplo |
|---|---|---|
| `branches.id` | la sala en el portal | 5 |
| `erp_sucursal_id` | la sucursal en el sistema de origen | otro número |
| **la ubicación de inventario** | de dónde sale y a dónde entra la existencia | otro número más |

**La ubicación se leyó del propio sistema el 2026-08-06, no se adivinó**, y la
equivocada **apunta a otro almacén sin dar ningún error**. Bodega tiene dos —«1
BODEGA» y «2 BODEGA DE VENCIDOS»— y la que va en el mapa es la de operación,
porque la de vencidos es a donde **llega** lo descartado, no de donde sale.

### El código corto tampoco es el número

`ERP_CODIGOS` es cómo se nombra cada sala donde no cabe el nombre: el código del
pedido en la hoja de despacho (`03-120826-2-S5`) y la clave del traslado en el
kardex (`P102-S5-H1-I71445`).

**No es el número de la sala.** `erp_sucursal_id` y el nombre se separan justo en
las tres últimas, así que armarlo con el id da «S7» para Salud 5 y —peor— **«S5»
para La Popular, que se lee como otra sala que sí existe**. Un identificador
equivocado que además es válido no lo detecta nadie.

**La autoridad es `erp_sucursal_map.codigo` en la base**, con CHECK de forma y
UNIQUE; es de donde lo lee `planificar_traslado_pedido` al armar la clave. Lo del
frontend es el **espejo**. Si se agrega una sala hay que tocar **los dos**.

### Ese espejo ya se duplicó dos veces

Las constantes vivían dentro de `DashboardView` porque sus únicos consumidores
eran las baldosas. Cuando «Solicitudes de Sucursal» estrenó el botón «Nueva
solicitud» —que abre los mismos formularios y necesita los mismos mapas—
copiarlas habría dejado dos listas a mano que se desincronizan a la primera
sucursal nueva.

Y esa mudanza dejó una copia atrás: `pedidoPrint.js` tenía sus propios
`ERP_NAMES_DEFAULT`, `SUCURSALES_ORDER` y `SUCURSAL_CODES`. Se descubrió el
2026-08-12 **justo al definir la clave del traslado**: se estaba por inventar un
cuarto código de sala sin saber que el módulo que imprime la hoja de despacho ya
tenía el suyo, idéntico.

---

## 2. El expediente: `settings` es un `jsonb`

Los datos generales, el inmueble, lo legal, los servicios y los horarios viven
dentro de `branches.settings`. Eso tiene dos consecuencias operativas:

- **Nada de eso se puede filtrar en PostgREST.** Un criterio que mire dos claves
  del mismo `jsonb` necesita una función en la base, no bajar la tabla y filtrar
  en el navegador.
- **Hay que limpiar antes de escribir.** `sanitizeForJsonb` saca `File`, `Blob` y
  funciones: un `File` dentro del objeto lo vuelve inserializable y el guardado
  falla entero, o peor, guarda un `{}` donde iba el dato.

---

## 3. Los documentos se versionan, no se pisan

Al subir un documento nuevo, el anterior **se archiva** en una subcarpeta `old/`
en vez de sobrescribirse. Un permiso vencido sigue siendo la prueba de que
estuvo vigente en su momento — borrarlo destruye historia regulatoria.

Un detalle que ya falló: **`storage.move` devuelve `{ error }`, no lanza**, así
que el `try/catch` que lo envolvía no alcanzaba y un archivado fallido no dejaba
ni el aviso. Hoy sigue siendo tolerante —el documento nuevo se sube igual— pero
**alguien se entera**.

### Vencimientos

`check-doc-expiry-daily` avisa por los documentos de la sala. Compara contra el
**mediodía UTC del día de El Salvador** a propósito: cerca de medianoche, comparar
con el instante actual corre el resultado un día.

`FormSrsPermit`, `FormPharmacyRegent`, `FormNursingRegents` y
`FormPharmacovigilance` son las cuatro piezas reguladas del expediente. Lo que
guardan alimenta las bitácoras del SRS.

---

## 4. La sala tiene horario, y ese horario decide personal

`settings.horarios` no es informativo: `calculateMinimumStaff` lo usa para
calcular el personal mínimo. La cuenta suma las horas de apertura de la semana,
las multiplica por el mínimo concurrente, agrega el margen de ausentismo y divide
por **44 horas por empleado**.

Un día con `isOpen` mal puesto no muestra un horario raro: **cambia cuánta gente
dice que hace falta**. Y un cierre que cruza la medianoche suma 24 si el
resultado da negativo — sin eso, el día restaría horas.

Las sucursales de menos de tres meses tienen **período de incubación** y no se
miden con la misma vara.

---

## 5. Antes de tocar algo en Sucursales

1. **Antes de usar un número de sala, preguntarse cuál de los tres es.** El
   equivocado no da error.
2. **Al agregar una sala hay que tocar `erp_sucursal_map` Y el espejo del
   frontend.** Y verificar que no haya una tercera copia.
3. **Nada se filtra por dentro de `settings` desde PostgREST.**
4. **Un documento nunca se sobrescribe.**
5. **Antes de cambiar un horario, recordar que de ahí sale el personal mínimo.**
6. **`branches` es una de las tablas seguras para leer sin paginar** (siempre
   menos de 1000 filas) — pero eso vale para `branches`, no para
   `branch_expenses`.
