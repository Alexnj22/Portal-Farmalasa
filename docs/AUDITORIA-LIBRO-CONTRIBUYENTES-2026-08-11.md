# Auditoría del libro de ventas a contribuyentes

Fecha: 2026-08-11. Motivo: **el contador dice que el libro de contribuyentes no
tiene la estructura correcta.** Tiene razón. Esto documenta contra qué se
comparó, qué está mal, y qué está bien.

Patrón de comparación: **Art. 85 del Reglamento del Código Tributario** (las doce
columnas del libro, en orden) y **Art. 141 CT** (los requisitos formales). No el
manual del F-07 — ese es el otro documento, y ahí está justamente el problema.

Lo auditado: `generar_csv_libro('contribuyente', …)` leída del catálogo de
producción, su gemela en `LibrosIvaView.jsx:897`, el RPC
`get_libro_ventas_contribuyente`, y **las filas reales de julio 2026** (51 CCF
finalizadas en 5 sucursales).

---

## El veredicto en una línea

**El archivo que produce el portal no es un libro: es el anexo del F-07.** Son
dos documentos distintos, con dos leyes distintas, y hoy existe uno solo que
intenta ser los dos. Por eso le faltan cosas al libro — no por descuido en una
columna, sino porque está construido contra el patrón equivocado.

| | Libro de ventas a contribuyentes | Anexo 1 del F-07 |
|---|---|---|
| Qué es | el **registro** que se lleva y se conserva | el **archivo** que se sube a la declaración |
| Ley | Art. 141 CT · Art. 85 RCT | Manual F-07 v14 |
| Encabezado | **obligatorio** (mes, nombre, título, NRC) | **prohibido** |
| Columnas | 12, en el orden del Art. 85 | 20, en el orden del manual |
| Cierre | totales del período + resumen + firma del contador | ninguno |
| Soporte | libro empastado y foliado, autorizado por un CPA | archivo CSV |

---

## Hallazgo 1 — las columnas no suman el total (es el que se ve a simple vista)

Fila real del libro de julio 2026, sucursal M001P003:

```
06/07/2026;4;03;DTE03M001P003000000000000117;2026C2E5A04D…;5978AA98…;323659;830860;
BANCO PROMERICA, S.A.;0.00;0.00;0;359.79;46.77;0.00;0.00;402.96;05110402951018;1
```

> Gravadas **359.79** + Débito **46.77** = **406.56**
> Total de la fila: **402.96**
> Diferencia: **$3.60**

Los $3.60 son la **retención del 1%** que el banco le hizo a la farmacia. El
literal l) del Art. 85 pide el «**total de ventas por documento**», que es la
suma de las columnas anteriores; lo que va en el archivo es el **total cobrado**,
con la retención ya descontada.

**Alcance medido: 21 documentos, $87.82**, entre el 2025-05-12 y el 2026-07-06,
sobre 619 CCF históricos. En julio 2026 es una fila sola, y es la de un banco
—o sea, la que un contador mira.

Esto ya estaba detectado y anotado como pendiente el 2026-08-04
(`docs/planes-cerrados/RETENCION-IVA-VENTAS-2026-08-04.md`); no se corrigió
entonces porque movía números ya declarados. Ahora lo levantó el contador, así
que la decisión de dejarlo quieto se acabó.

Aclaración que sigue vigente y no hay que revertir: **la retención no lleva
columna propia en el libro.** El Art. 85 enumera «impuesto percibido» (literal k)
y no menciona el retenido; el Art. 83, el de consumidor, tampoco. La retención es
un anticipo del impuesto (Art. 162 CT) y va en la declaración, respaldada por los
comprobantes de retención. Lo que está mal no es que falte su columna: es que se
está restando de una que sí existe.

---

## Hallazgo 2 — falta el número correlativo de la operación

Art. 85 literal **a)**: «Número correlativo de la operación registrada».

La pantalla lo tiene (columna `N.º`). El archivo **no lo lleva**. Es la primera
columna del libro según la ley.

## Hallazgo 3 — falta el encabezado, que es obligatorio

Art. 85, primer inciso: el libro debe «identificar **el mes** a que corresponden
las operaciones, y un **encabezado** con el **nombre del contribuyente**, **título
del libro**, y **NRC**».

El archivo sale **sin encabezado** — a propósito, porque el anexo lo prohíbe
(«las columnas no deben contener encabezados o títulos»). El mes está sólo en el
nombre del archivo. Las dos reglas son ciertas y opuestas: prueba de que un
archivo no puede ser los dos documentos.

## Hallazgo 4 — falta la columna de impuesto percibido

Art. 85 literal **k)**: «Impuesto percibido». No existe en el archivo ni en la
pantalla. Hoy la farmacia no percibe sobre sus ventas, pero la columna es parte
de la estructura del libro y su ausencia es justamente lo que se está señalando.

## Hallazgo 5 — el orden de las columnas no es el de la ley

El Art. 85 enuncia las columnas «**en el orden que a continuación se enuncia**».
El archivo pone el NRC **antes** del nombre del cliente (la ley pide d) nombre,
e) NRC) y el segundo identificador al final, después del total.

## Hallazgo 6 — dos identificadores del cliente donde el libro pide uno

El Art. 85 e) pide el **NRC del cliente**, y nada más. El archivo lleva el NRC en
la columna 8 y otro identificador en la 18.

Y ese segundo identificador **no siempre es un NIT**: en las personas naturales
de julio son `017779482`, `040594374`, `019579749` — **9 dígitos, o sea DUI**,
no los 14 de un NIT. En el anexo del F-07 esas dos columnas son **excluyentes**
(si se llena el DUI, el NIT/NRC debe quedar completamente vacío). Hoy van las dos
llenas siempre.

## Hallazgo 7 — falta el cierre del período

Art. 85, inciso final: al terminar cada período tributario hay que **totalizar
las operaciones** y consignar un **resumen** con las ventas exentas y gravadas a
contribuyentes **y a consumidores finales**, separadas de las de cuenta de
terceros, y el **cálculo del débito fiscal** de unas y otras.

Art. 141 d): las anotaciones «deben totalizarse por período tributario y servir
de base para la elaboración de la declaración. **En la hoja que conste el total
de las operaciones deberá firmar el Contador**».

El archivo termina en la última fila de datos. Los totales existen en la pantalla
(el carril de arriba) pero no viajan al archivo, y el resumen conjunto
contribuyentes + consumidores no existe en ningún lado.

## Hallazgo 8 — el filtro dejaría fuera las notas de crédito y débito

Art. 85 b) nombra los documentos del libro: Comprobante de Crédito Fiscal,
**Comprobante de Liquidación, Nota de Débito y Nota de Crédito**.

El filtro es `tipo_documento = 'CCF'`. Hoy no hay daño —en las 346,206 ventas
históricas sólo hay `COF` (345,586), `CCF` (619) y un `UNKNOWN`— pero el día que
se emita una nota de crédito **queda fuera del libro sin avisar**. Es el patrón
de siempre: un cero que se lee como «no hubo».

---

## Lo que SÍ está bien (no rehacer)

- **Los identificadores del documento corresponden a la fila.** Número de
  control, sello y código de generación son los del CCF de esa línea —a
  diferencia del libro de consumidor, que tiene el hallazgo de códigos de
  generación cruzados (`LIBROS-IVA-FORMATO-Y-HALLAZGOS-2026-08-01.md` §4.1).
- **El filtro del sello está bien puesto**: `length(recibido_mh) = 40` deja
  fuera lo que no tiene sello válido de Hacienda.
- **Las invalidadas no ensucian el libro**: julio tuvo 2 CCF invalidadas por
  $27.00 y van al anexo de anulados, no acá.
- **Gravadas y débito fiscal cuadran** documento por documento.
- **No falta ningún CCF**: los 51 finalizados de julio están los 51.

---

## Cómo se arregla

**Separar los dos documentos.** Es la raíz de 6 de los 8 hallazgos.

1. **El libro** (Art. 85): con encabezado —mes, nombre de la farmacia, título,
   NRC—, correlativo, las doce columnas en el orden de la ley, impuesto
   percibido, y al pie los totales del período más el resumen del inciso final.
   Formato pensado para imprimirse y empastarse, no CSV pelado.
2. **El anexo** (F-07 v14): el archivo de 20 columnas, sin encabezado, con las
   dos columnas de Renta que hoy faltan — lo del
   `docs/ANEXOS-HACIENDA-2026-08-11.md` §6 grupo A.

**Y aparte, el hallazgo 1, que es el único que cambia un número**: que la columna
de total lleve la suma de las columnas del libro (gravadas + débito) y no el
total cobrado. Son 21 documentos y $87.82. **Antes de tocarlo hay que preguntarle
al contador cómo quiere los períodos ya declarados** — corregir hacia atrás mueve
cifras presentadas.

**Preguntas para el contador, que ahorran adivinar:**

1. ¿Cuál de estos ocho es el que vio? (Puede que sea uno solo y el resto le sean
   indiferentes.)
2. El libro, ¿lo quiere para imprimir y empastar, o alimenta otro sistema?
3. Los $87.82 de retención de períodos ya declarados: ¿se corrigen hacia atrás o
   se arregla de acá en adelante?
4. ¿Necesita el resumen del inciso final del Art. 85 —contribuyentes y
   consumidores juntos— o eso lo arma él?

---

## Nota sobre la pantalla

El tooltip del botón de exportar dice hoy «**completo y en orden legal**». Con
estos hallazgos esa frase es falsa hasta que se separen los dos documentos; hay
que cambiarla en el mismo commit que arregle el archivo.
