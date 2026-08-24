# Productos, presentaciones y laboratorios — la presentación y el factor

**Escrito el 2026-08-24**, durante la auditoría completa del portal. Era una de
las once áreas sin documento propio.

Casi todo lo que se rompió en esta área tiene la misma forma: **un número que se
ve razonable y dice otra cosa**. No hay error, no falta una fila; simplemente la
cantidad está en una unidad distinta de la que uno cree.

---

## 1. Lo primero: `cantidad` no está en unidades

`inventory.cantidad` está **en la presentación de esa fila**. El mismo lote
aparece varias veces —CAJA, BLISTER, UNIDAD— y cada una cuenta lo suyo.

Verificado el 2026-08-07 sobre la amoxicilina 500, lote `L5M5137` en La Popular:

| presentación | cantidad | factor | unidades |
|---|---:|---:|---:|
| CAJA | 24 | 30 | 720 |
| BLISTER | 1 | 10 | 10 |
| UNIDAD | 3 | 1 | 3 |

Sumarlas sin convertir no sólo daba un número corto: **cambiaba el orden de las
salas.** La Consulta de Inventario mostraba La Popular (46) por encima de Salud 1
(39), cuando Salud 1 tiene **1,034 unidades contra 836** — la pantalla que existe
para decir «en qué sala hay» apuntaba a la equivocada.

La conversión vive en `src/utils/unidadesInventario.js`, en un solo lugar, porque
la necesitan dos pantallas: la Consulta y el modal de pedir a otra sala.

---

## 2. El factor lo manda la base

Hasta el 2026-08-18 el navegador lo deducía de `detalle` y
`v_inventario_disponible` lo leía del catálogo, así que **la misma pantalla decía
dos números distintos**: la Consulta mostraba «Bodega · 3 uds» de CLOPRIM X 3
AMPOLLAS y el formulario de pedirlo, abierto desde esa fila, decía «Bodega — 1
unidad». Y como la guarda del formulario y el trigger de la base leen ese 1, **la
caja no se podía pedir**.

Hoy lo resuelve `factor_de_inventario` en la base —el catálogo dice qué factores
son posibles para la etiqueta y `detalle` elige entre ellos— y **viaja en la
fila**.

> Que dos fuentes coincidan es cuestión de suerte; que haya una sola, no.

`detalle` se sigue leyendo **sólo como respaldo**, para filas que llegan por un
camino que todavía no manda `factor`. Medido sobre las 24,181 filas del
inventario: 24,031 vienen en formato `1xN` limpio, 48 con un `1` pelado y 102 con
variantes de espaciado (`1 X 1`, `X 25`, `1X 16`) que el parse cubre porque
normaliza los espacios antes de leer.

**Sin número después de la `x` el factor es 1, y NUNCA 0.** Un 0 borraría la
existencia en silencio, que es peor que contarla de menos. Y dividir por 0 daría
`Infinity`, o sea un desplegable ofreciendo una existencia que no existe.

---

## 3. Las dos maneras de pasar de unidades a presentaciones

Están escritas juntas a propósito: **eligiendo la equivocada el número se ve
razonable y dice otra cosa.**

| función | pregunta que responde | redondeo |
|---|---|---|
| `applyPresRule` | cuánto **sugerir** pedir | sube un pack si el residuo pasa el **40%** |
| `presentacionesEnteras` | cuánto **cabe** pedir | siempre hacia **abajo** |

`presentacionesEnteras` es la cuenta que el desplegable de «Presentación» pone
entre paréntesis: con 3 unidades y una caja de 3, la respuesta es **1 caja**, no
3. Hasta el 2026-08-19 ahí iba el **factor**, que se lee igual y dice otra cosa.

Y es un **techo**, no una sugerencia: el formulario de traslado compara
`cantidad × factor` contra la existencia y el trigger `validar_solicitud_traslado`
repite la comparación en la base. Ofrecer una caja de más no muestra un número
feo — **produce una solicitud que el envío rechaza**.

---

## 4. Precios: tres tablas y ninguna es la otra

| tabla | qué guarda |
|---|---|
| `product_precios` | el precio vigente por presentación (`activo`) |
| `product_precios_changelog` | qué campo cambió, de qué valor a cuál, cuándo |
| `product_precios_history` | la foto del precio a lo largo del tiempo |

El changelog es campo a campo y el historial es por fila: se leen juntos en el
detalle del producto y **no son sustitutos**. Un precio que cambió y volvió deja
dos entradas en el changelog y dos puntos en el historial; mirar sólo uno cuenta
la mitad de lo que pasó.

---

## 5. El catálogo se sincroniza, no se escribe

`sync-products-10min` trae el catálogo del sistema de origen. Dos reglas que ya
costaron caro y valen para cualquier sync:

- **Prohibido el upsert incondicional de la tabla completa.** Reescribir cada
  fila aunque nada cambie quema WAL, IO y CPU de Realtime. El patrón obligatorio
  es `ON CONFLICT DO UPDATE ... WHERE (cols) IS DISTINCT FROM (EXCLUDED.cols)`
  —`upsert_product_precios_batch` es el modelo—.
- **Nunca poner `updated_at: now()` en el payload del sync**: hace que toda fila
  «cambie» siempre. Lo asigna el RPC cuando el dato real cambió.
- **Las credenciales van en un secreto**, nunca en el código.

`vacuum-products-hourly` existe porque esta tabla se toca mucho.

---

## 6. Cosas del catálogo que se guardan solas

Devolutivo, Categoría y la ficha del proveedor en Política de Vencimiento **se
persisten al cambiar** (debounce de 700 ms), sin botón «Guardar». Es deliberado y
consistente entre las tres. Si se agrega un campo a esas filas, va con el mismo
comportamiento — un campo con botón entre dos que no lo tienen se queda sin
guardar.

`devolutivo` nace en `true`: **la mayoría de los proveedores sí aceptan
devolución**, y ND es la excepción.

---

## 7. Las tres reglas de rótulo que aplican acá

1. **`es_antibiotico = true` se muestra como «Bajo Receta», nunca «Abx».**
2. **Un desplegable que existe como tabla no se escribe a mano.** El valor sale
   de la fila; así coincide con la base por construcción y no por suerte.
3. **La pantalla nunca nombra el sistema de origen.** Ni «sincronizar»: se dice
   en términos del negocio.

---

## 8. Antes de tocar algo en Productos

1. **Antes de sumar `cantidad`, convertir.** Siempre.
2. **El factor viene en la fila.** No deducirlo de nuevo en el navegador.
3. **Elegir a conciencia entre «cuánto sugerir» y «cuánto cabe».**
4. **Ningún factor puede ser 0.**
5. **Ningún sync escribe filas que no cambiaron.**
6. **`npm run gate:data` y `gate:perf`** antes de cerrar: esta área tiene dos de
   las tablas más grandes del portal.
