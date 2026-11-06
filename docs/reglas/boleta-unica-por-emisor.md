# Un número de boleta sólo es único dentro de quien lo numera

> Movido desde `CLAUDE.md` el 2026-11-06 sin cambiar el contenido. Allá queda la regla corta; acá, el detalle, las mediciones y la historia. Las cifras de este archivo son de la fecha en que se escribieron: la verdad vigente vive en el archivo o la tabla que cada párrafo nombra.

## REGLA: un número de boleta sólo es único DENTRO de quien lo numera (2026-10-28)

El freno de boleta repetida del cajón comparaba número y sentido, nada más. Pero
cada banco numera por su lado y una factura trae el número de su emisor: en
Salud 2, la **000956** del POS Promerica ($3.99, ANDA) y la **000956** de la
terminal de tarjeta Atlántida ($48.00) son dos operaciones reales. Con la regla
vieja, la segunda —si hubiera sido en efectivo— **no se habría podido
registrar**, y `gate:cortes` la acusaba de duplicado.

Quién es la MISMA operación lo decide **la base, una sola vez**:
`caja_misma_operacion_de_boleta` sobre `caja_familia_de_boleta`. POS Promerica
y cualquier otro tipo (proveedor, compra, otro) → mismo número **y** mismo
monto; voucher (tarjeta/transferencia) → no se juzga,
ya tiene su tope de partes en `operar-caja`. `boleta_ya_en_caja` devuelve
`misma_operacion` por coincidencia, y lo leen el freno de `operar-caja`,
`choqueDeBoleta` en la pantalla y la sección E de `gate:cortes`. Sin decir qué
se anota devuelve `null` y frena como antes. Las correcciones de sentido
contrario cruzan tipos (una entrada del POS contra-anotada como «Otro»), así que
ese AVISO no mira la familia. Bolsas ya lo hacía bien: su índice único lleva la
entidad.

**El POS tampoco es uno solo** (2026-11-03): cada sala tiene su terminal
Promerica y cada una numera por su lado. Cuando la de una sala falla se usa la
de otra —legítimo: el efectivo queda en la sala que atendió—, y el papel trae la
terminal ajena. Qué terminal es de qué sala vive en `caja_terminales_pos`, y
`caja_sala_de_terminal(lectura)` la reconoce en la foto comparando por
**huella** (`caja_huella_de_terminal`: la lectura confunde 0↔8 y 1↔4). El juez
recibe la terminal de cada lado: **distintas → otra operación**; misma o alguna
desconocida → número y monto. «Misma terminal» NO basta sin el monto: en Salud
4 la boleta «5» mal leída son dos operaciones reales. La pantalla dice «POS de
Salud 2» (campo calculado `pos_de_otra_sala`, no columna: rellenarla dispararía
la bitácora de dinero por fila). Una terminal nueva = una fila en esa tabla.