# Ventas — de dónde sale cada número, y qué lo puede romper en silencio

**Escrito el 2026-08-24**, durante la auditoría completa del portal. Ventas era
una de las once áreas sin documento propio y es la que más veces mostró un
número incompleto **sin fallar**: seis de los siete defectos que se corrigieron
en agosto no dieron ni un error.

Ese es el hilo de todo este documento: **acá el modo de falla no es el error, es
la fila que no está.**

---

## 1. Las tablas, y cuál es la verdad

| tabla | qué es |
|---|---|
| `sales_invoices` | una fila por documento |
| `sales_invoice_items` | una fila por renglón |
| `sales_invoice_changelog` | qué cambió en un documento y cuándo |
| `sales_daily_stats`, `ventas_monthly_stats` | acumulados, reconstruidos por cron |
| `product_sales_rollup`, `product_sales_monthly_agg`, `product_last_sale` | lo mismo por producto |
| `*_resolutions`, `ventas_cuadre_hallazgos` | lo que alguien ya revisó y decidió |

**La verdad es `sales_invoices`; los acumulados son una foto.** Cuando un
acumulado y la lista no coinciden, el que está mal es casi siempre el acumulado
—se reconstruye— y la excepción está en §6.

**`recibido_mh` es `text`, no un booleano.** Guarda el sello de recepción de
Hacienda: 40 caracteres. `IS NULL` y `!!valor` dan por buena cualquier basura, y
`.eq('recibido_mh', true)` compara contra la cadena `'true'` y devuelve **cero
filas, siempre**. La única prueba de sello válido es la longitud de 40.

---

## 2. La regla que más veces rompió esta área: el techo de las 1000 filas

PostgREST corta en 1000 filas **sin error y sin aviso**. En Ventas eso pasó
cuatro veces distintas, y ninguna se notó desde adentro:

- **El filtro «Receta Médica»**, roto desde el día uno. Pedía los `invoice_id`
  de `sales_invoice_items` con un `.in('erp_product_id', <79 ids>)` sin paginar.
  Contra **4,013 renglones reales** llegaban 1,000, y como tampoco llevaba
  fechas el recorte caía repartido por toda la historia: agosto/2026 mostraba
  **8 ventas de 93**.
- **El camino normal de la lista.** `search_ventas_ids` devuelve `SETOF` y se
  llamaba sin paginar. Medido contra producción:

  | búsqueda | filas reales | llegaban |
  |---|---:|---:|
  | «maria» · Este mes | 810 | 810 |
  | «maria» · Últimos 6 meses | 7,540 | 1,000 |
  | «maria» · Este año | 9,777 | 1,000 |

  Y los totales del encabezado se sumaban **sobre el conjunto recortado**: el
  monto en pantalla no era el del período. Los dos rangos están a un clic.

**La salida, las dos veces, fue la misma: el filtro va a la base.** Adentro de
una función, `search_ventas_ids` se llama como subconsulta y el tope no existe.
Traer la lista completa al navegador tampoco servía: esos ids vuelven dentro de
la **URL** del `.in()` siguiente, y con un año son ~1,700.

**Acotar la entrada no acota la salida cuando la columna se repite.**
`erp_product_id` se repite en `sales_invoice_items`, así que 79 ids de entrada
traen 4,013 filas. Hoy lo vigila la categoría `in-columna-repetida` de
`npm run gate:data`.

**Y un tope se aplica antes del filtro, no después.** Bajar N filas y recortar
con un `.filter()` en el navegador no devuelve «los que cumplen», devuelve «los
que cumplen entre los primeros N», y nadie lo puede notar.

---

## 3. El orden tiene que ser total

`range()` corta por **posición**. Ordenar por `total_linea` empata todo el
tiempo —dos renglones del mismo precio—, así que sin un desempate por `id` la
base puede mandar la misma fila en dos páginas y perder otra. El desempate no es
decoración.

---

## 4. Una venta se busca por su id interno, nunca por el correlativo

**El número se repite entre salas.** Medido en producción: `0000068132_COF`
existe en Salud 4 **y** en La Popular, con distinto cliente y distinto monto.
`metadata.invoice_id` de una solicitud es la clave buena.

---

## 5. Lo que se cobra y no es venta de productos

Bajo los códigos administrativos 100/1000 hay cobros que no son venta de
mostrador: la comisión del corresponsal bancario, el apoyo promocional de un
laboratorio, las dietas de reunión.

- **Para la meta ya no cuentan** (v2.699.0).
- **Para las pantallas de hora y de día sí se muestran**, porque la factura
  existió y el corte de caja tiene que cuadrar contra ella. Lo que hacía falta
  era **decirlo**: un cobro de $428 a las 10:17 inventa una hora pico que nadie
  trabajó. Cuatro pantallas lo avisan.

**El permiso lo decide el servidor.** Sin `ventas_no_producto`,
`get_ventas_sin_producto` devuelve `null` y la pantalla no pinta nada. Se
resolvió así —y no trayendo los montos para esconderlos— porque **un monto que
llega al navegador ya salió**, lo pinte la pantalla o no.

---

## 6. El cuadre diario: por qué un libro completo no prueba nada

`check-sales-reconciliation` compara cada día contra el sistema de origen.
Existe por una razón de una línea:

> **Un libro al que le falta un documento cuadra consigo mismo.** No hay error,
> los totales suman bien, simplemente suman un documento menos.

Apareció el 2026-08-02: faltaba una venta de **$45.98** en Salud 4 del 20-jun.
Sólo se ve comparando contra afuera.

**Compara los DOS libros por separado** —consumidor (una línea por día) y
contribuyentes (una línea por documento)— y recién después suma. Si un día
tuviera de más en un libro lo mismo que de menos en el otro, el total daría cero
y el día pasaría por bueno. El de contribuyentes se agregó el 2026-08-04: antes
sólo se miraba consumidor porque es el 99% del volumen, y eso dejaba a los CCF
—los documentos más grandes— sin control diario.

**Los dos lados NO cuentan con el mismo criterio, y esa es una de las causas.**
El portal exige `FINALIZADA` + sello; el origen exige sello y excluye sólo lo
invalidado ante Hacienda, así que **cuenta lo que se marcó `NULA` localmente**.
Medirlos con la misma regla escondería la diferencia en vez de explicarla.
Verificado en tres días de tres sucursales: el exceso del libro del origen es
exactamente el documento `NULA` del día, al centavo.

**Un centavo en un mes de $200,000 es redondeo; dos ya son un documento.**

### Diagnostica, no arregla

Al encontrar un día que no cuadra baja al documento y clasifica:

| causa | qué hacer |
|---|---|
| `falta_en_portal` | se recupera resincronizando ese día |
| `sin_sello` | el sello todavía no llegó; se corrige solo |
| `anulado` | correcto, el libro lo excluye |
| `anulado_sin_invalidar` | tiene sello, se anuló en el sistema y **nunca se invalidó ante Hacienda**: sigue vigente y el libro debería llevarla |
| `origen_perdio_fila` | la venta existe y está sellada, pero el origen ya no tiene su registro: **resincronizar NO la recupera** |
| `dte_inexistente` | hay documento en el portal y su DTE no existe |

La distinción de `origen_perdio_fila` importa porque **el aviso recetaba una
cura equivocada**: decía «hay que resincronizar» y en ese caso resincronizar no
sirve de nada — el que perdió el registro es el origen.

Dos detalles del método:

- El endpoint público del JSON contesta **200 con el cuerpo vacío** cuando el
  documento no es nuestro. Se valida el contenido, nunca el status.
- Tope de **25** consultas por día. Un día con 25 sobrantes ya no es «un
  documento perdido», es otra cosa, y no se arregla preguntando de a uno.

---

## 7. La brecha de mayo/2025 — lo que enseñó

El acumulado diario y las facturas no coincidían: **$117,509.80 en 85 pares**.
Al medirla de nuevo salió $120,078.21, y **el número viejo era el correcto**: la
medición nueva había sumado facturas anuladas. El dato ya registrado corrigió a
la medición nueva, no al revés.

Sigue abierta.

---

## 8. Antes de tocar algo en Ventas

1. **Ninguna consulta sin paginar.** El helper es `fetchAllRows`; `.limit(1000)`
   está prohibido porque es el cap exacto.
2. **Ningún filtro nuevo resuelto en el navegador** si el conjunto puede pasar
   de 1000. Va a la base — `get_ventas_con_receta` es el modelo.
3. **Todo orden lleva desempate por `id`.**
4. **Los argumentos de la lista y los de los totales se mueven juntos.**
   `p_solo_receta` es el décimo de una y el sexto de los otros: si dejan de
   coincidir, el encabezado habla de una lista que no está en pantalla.
5. **Nunca comparar `recibido_mh` contra `true`.**
6. **Al cambiar el criterio de qué entra al libro, cambiarlo en los TRES sitios**
   —el barrido, la guarda del envío y la cola de Pendiente MH—. Tuvieron que
   fallar los tres juntos para que una factura del 16-may-2025 figurara **un
   año** como confirmada.
7. **`npm run gate:data`, `gate:perf` y `gate:eficiencia`** antes de cerrar.
