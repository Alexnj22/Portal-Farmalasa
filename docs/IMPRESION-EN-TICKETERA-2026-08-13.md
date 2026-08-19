# Imprimir en ticketera desde el portal — 2026-08-13

Pedido del usuario: *«necesito poder imprimir tickets así como lo hace el ERP…
se imprimen en una ticketera, dejame en algún lugar una prueba de impresión.
analizá en el ERP cómo lo hace para poderlo replicar y mejorar»*.

Entregado: el motor de tickets (`src/utils/ticketPrint.js`), la pantalla
**Sistema → Prueba de impresión** (`/impresion`) y este documento. Lo que sigue
abierto está al final, con nombre y apellido.

---

## 1. Cómo imprime el sistema de facturación (medido, no supuesto)

Su pantalla de venta (`venta.php` + `js/funciones/venta.js`) **no usa el diálogo
de impresión del navegador**. Hace dos viajes:

```
navegador ──POST venta.php {process:'imprimir_fact', numero_doc, tipo_impresion}──▶ servidor
navegador ◀── JSON con el texto ya armado + a dónde mandarlo ──────────────────────
navegador ──POST http://localhost/impresion_dte/printpos1.php {datosventa,…}────▶ programa local
                                                                                    └─▶ ticketera
```

El JSON que devuelve el servidor, leído tal cual (pedido con un número de
documento inexistente a propósito, para ver la configuración sin tocar ningún
documento real):

```json
{
  "shared_printer_win": "//localhost/facturacion",
  "shared_printer_pos": "//localhost/ticket",
  "dir_print":  "localhost/impresion_dte/",
  "sist_ope":   "lin",
  "facturar":   "FARMACIA LA SALUD 1|JOSE RUTILIO ALEMAN VASQUEZ|||0401-210685-101-0|213237-5||TOTAL GRAVADO        $    0.00\nTOTAL EXENTO         $    0.00\nTOTAL                $    0.00\n| cero  dolares con 00/100 ctvs\n|VENDEDOR: ",
  "headers":    "|||",
  "footers":    "GRACIAS POR SU COMPRA, VUELVA PRONTO......|COMO LE ATENDIMOS HOY?|QUEJAS O SUGERENCIAS AL 75995118,CON GERENCIA.|NO SE ACEPTAN DEVOLUCIONES DESPUES DE 3 DIAS|",
  "success": true
}
```

Lo que esto dice, punto por punto:

| Dato | Qué significa |
|---|---|
| `dir_print: localhost/…` | El programa que imprime corre **en la misma computadora de la caja**, no en un servidor. Cada caja tiene el suyo. |
| `sist_ope: "lin"` | Las computadoras de sala son **Linux**; por eso el archivo es `printpos1.php` y no `printposwin1.php`. |
| `shared_printer_pos` | La ticketera está registrada como impresora compartida con el nombre `ticket`; la de factura, como `facturacion`. |
| `facturar` | Diez campos separados por `\|`: sucursal, cliente, dos líneas de dirección, NIT, NRC, uno vacío, el cuerpo, el total en letras, el vendedor. |
| el cuerpo | Viene **rellenado con espacios a mano** (`TOTAL GRAVADO` + 8 espacios + `$` + 4 espacios). El que imprime no acomoda nada: saca los caracteres tal cual. |
| `headers` / `footers` | Renglones configurables, también separados por `\|`. Hoy el encabezado está vacío y el pie tiene cuatro líneas. |

Hay cuatro destinos, elegidos por el `tipo_impresion` del formulario de venta:
`COF` → `printfact1.php` (factura), `CCF` → `printcf1.php` (crédito fiscal),
`TIK` → `printpos1.php` (ticket), `ENV` → `printenv1.php`. Cada uno con su
gemelo `…win1.php` para Windows. La opción `TIK` está **comentada** en el
`<select>` de la pantalla de venta, así que hoy en las salas se imprime `COF`.

### El camino que de verdad usa la ticketera es OTRO (corregido 2026-08-13)

Todo lo de arriba es la pantalla de venta **vieja**. El ticket que sale hoy de la
ticketera lo arma `print_ticket_dte` (`js/funciones/util.js`), que es otro
circuito completo:

```
navegador ──POST _helper_ticket_dte.php {process:'print_ticket_dte', id_factura}──▶ servidor
navegador ◀── JSON: encabezado · cuerpo · pie · totales · total_letras
              + img · qr · qr_farmalasa + la config de impresión ──────────────
navegador ──POST http://localhost/impresion_dte/printik_pista.php ────────────▶ programa local
             (printposwin1.php si sist_ope == 'win')                            └─▶ ticketera
```

Las diferencias que importan:

| | pantalla de venta vieja | ticket con datos fiscales |
|---|---|---|
| archivo local | `printpos1.php` | **`printik_pista.php`** (Linux) |
| forma | un `datosventa` con 10 campos y `\|` | **secciones separadas** |
| maqueta | rellenada con espacios | espacios **+ códigos ESC/POS** |
| imágenes | ninguna | logo + QR de Hacienda + QR de puntos, por URL |

Las secciones vienen con los códigos de la impresora adentro: `ESC a 1` centrar,
`ESC a 0` izquierda, `ESC a 2` derecha, `ESC ! 0` letra normal, `ESC ! 1` letra
chica, `ESC ! 0x10` doble alto, y `ESC R \f` el juego de caracteres latino. O sea
que **ese programa no maqueta nada: es un caño** que saca los bytes a la
impresora y descarga las imágenes que le pasan por URL.

**El ancho real del ticket son 54 columnas**, no 40. Contado sobre un ticket real
(factura 351275):

```
         DESCRIPCION           CANT.    P.U   SUBTOTAL      ← 54
FLUCONAZOL 150MG X 2 CAPS. MK   2.00    8.05   16.10        ← 54
```

El nombre ocupa las columnas 1–31 y **el que no entra sigue en el renglón de
abajo** (su `…CAPS. MK` continuaba con `CAJA`). La cantidad cierra en la columna
36, el precio en 44 y el importe en 52 — con dos columnas de margen, que es por
qué el último número no llega al borde. Las líneas en letra normal (el TOTAL)
miden 40, que es de dónde venía la confusión: el Corte Z sale a 40 porque lo
imprime otro reporte en la letra normal, y **eso no es el ancho del ticket**.

Esa geometría está anclada en `tests/unit/ticketPrint.test.js`, que compara
columna por columna contra la línea real: si alguien la cambia «para que se vea
mejor», el ticket sale desalineado en la sala y desde acá no se ve.

**El ancho es 40 columnas.** No lo dice ninguna configuración: se midió contra un
ticket real del origen, el Corte Z que el portal ya guarda crudo en
`corte_z.ticket`. Todos sus renglones cierran en 40 caracteres
(`VENTAS GRAVADAS:` + relleno + `$ 15,667.93`).

**Los dos archivos `print*.php` no están en el servidor** (dan 404 ahí): viven
sólo en las computadoras de sala. O sea que **el formato final —qué hace con esos
diez campos— no se puede leer desde acá.** Lo que sí se puede afirmar es la forma
del pedido, que es la que se replicó.

### Lo bueno y lo malo de ese camino

Bueno: **no hay diálogo** —el cajero aprieta Enter y sale el papel— y es
instantáneo.

Malo, y por eso no es el camino principal del portal:

1. **Sólo funciona donde ese programa está instalado.** Es `localhost`: en una
   computadora de escritorio, en una tablet o en el teléfono, no hay nada que
   reciba el pedido.
2. **La respuesta llega opaca** (petición sin CORS): se sabe si el programa
   contestó algo, nunca *qué* contestó. Un 404 y un 200 se ven igual. En su
   propio código el aviso de error está comentado:
   `if (status != 'success') { //alert("No Se envio la impresión " + data); }`.
   Una impresión que falla es indistinguible de una que salió.
3. **El formato vive en tres lugares** —el servidor arma el texto, el programa
   local lo maqueta, la configuración de encabezado y pie está en la base— y
   ninguno de los tres se puede mirar desde el otro.

---

## 2. Cómo imprime el portal

`src/utils/ticketPrint.js`. El ticket se arma como HTML y se imprime **desde el
iframe de la vista previa**, con el ancho del rollo declarado en `@page`.

```js
import { imprimirTicket } from '../utils/ticketPrint';
await imprimirTicket({ ancho: 80, encabezado: {…}, titulo: 'PEDIDO', datos: […],
                       items: {…}, totales: […], pie: […] });
```

Qué se gana:

- **Funciona en cualquier computadora y en el teléfono**, sin instalar nada.
- **Lo que se ve es lo que sale.** No hay dos maquetadores: el papel y la vista
  previa son el mismo documento. `imprimirMarco()` manda a la impresora
  literalmente el iframe que el usuario está mirando.
- **Las columnas las alinea el CSS**, no espacios contados. Un nombre de 49
  caracteres se parte en tres renglones dentro de su columna en vez de correr la
  del precio (verificado con `ACETAMINOFEN 500MG TABLETAS CAJA CON 100 UNIDADES`).
- **Un error se ve**: `print()` es síncrono y el navegador avisa si no hay
  impresora.
- Y de paso, «Guardar como PDF» produce un PDF con forma de ticket, que se puede
  mandar por mensaje.

`enviarAImpresoraDeLaComputadora()` conserva el camino sin diálogo, con la forma
de pedido del origen, para las computadoras de sala que ya tienen ese programa.

### Reglas del rollo (por qué ese CSS no se parece al del portal)

1. **Sólo negro.** En térmico un gris se vuelve un entramado de puntos que se lee
   sucio y se borra con el tiempo. La jerarquía sale del grosor, el tamaño y las
   mayúsculas. Por eso el ticket **no usa los tokens del tema**: el papel no
   tiene tema, y un `#6b7280` que en pantalla es un gris elegante en papel es una
   mancha.
2. **Nada de fondos rellenos**, salvo la barra de prueba del cabezal.
3. **Ancho fijo, alto medido** (ver abajo).
4. **Margen de corte al final**: 12 mm. La cuchilla queda arriba del punto donde
   deja de salir papel; sin ese margen se lleva la última línea.

---

## 3. Cuatro cosas que se midieron (y las tres que estaban mal)

Todo con el portal compilado y andando, no leyendo código.

### 3.1 A 80 mm entran exactamente 40 caracteres

Medido dentro del documento del ticket: ancho útil 279 px, ancho de carácter
6.821 px → **40 caracteres**. La regla de 32 sobra, la de 48 no cabe (327 px).

Cae justo en las 40 columnas del origen. Bien: significa que un ticket del portal
y uno del sistema de facturación tienen la misma capacidad por renglón, así que
una plantilla se puede pasar de uno a otro sin rehacerla.

### 3.2 `@page { size: 80mm auto }` NO es CSS válido — y el navegador vuelve a carta

Es la forma obvia de decir «ancho fijo, alto libre», aparece en cualquier
tutorial de tickets, y **no existe**: la regla acepta `auto` o dos longitudes,
nunca una mezcla. El navegador descarta la declaración entera y usa su papel por
defecto. Medido: el PDF salía de **216 × 279 mm (carta)** con la regla puesta.

Solución: `ajustarAltoDePagina()` mide el documento ya pintado e inyecta
`@page { size: 80mm <alto>mm }`. Verificado: **1 hoja de 80.1 × 186.9 mm**.

En el CSS queda `297mm` escrito a mano como respaldo — si el JS no corre, sale
papel de más, que es preferible a que el ticket salga en una esquina de una hoja
carta.

### 3.3 `documentElement.scrollHeight` no sirve para medir un ticket

Nunca devuelve menos que el alto de la ventana. El mismo ticket daba **691 px
dentro de un marco de 620 px y 900 px en una ventana de 900 px** — 33 mm de papel
en blanco de más, y el número cambiaba según por dónde se lo mirara. El alto de
un ticket es el del **cuerpo** (`body.getBoundingClientRect().height`), que no
depende del observador.

Además el trazado de impresión sale un pelo más alto que el de pantalla
(redondeo de puntos a píxeles del dispositivo, renglón por renglón). Con el alto
justo, ese pelo manda el margen de corte a una **segunda hoja**: dos cortes, el
segundo en blanco. De ahí la holgura de 4 mm — papel invisible en un rollo,
contra una segunda hoja que se ve siempre.

### 3.4 Dos defectos de la vista previa que sólo aparecen en pantalla

- **El borde de 1 px del iframe hacía desbordar el ticket de lado.** El cuerpo
  mide exactamente el ancho del rollo (302.4 px), y el borde le deja 300 px
  útiles. El borde pasó al envoltorio.
- **`rounded-btn` recortó el ticket en forma de óvalo** y se comió el encabezado.
  Ese token vale 9999 px en el tema de vidrio: **el radio lo decide el tema**, no
  el componente. Una hoja de papel tiene las esquinas rectas: sin radio.

---

## 4. La prueba de impresión

**Sistema → Prueba de impresión.** Permisos copiados de `ios_test` (migración
`20260813223553_impresion_permisos_del_modulo`): hoy la ven el rol de quien
administra y la cuenta de QA; desde la pantalla de Permisos se puede dar a un
jefe de sala.

La hoja está armada para que **el papel conteste lo que la pantalla no puede**:

| En el papel | Qué responde |
|---|---|
| Tres reglas de 32, 40 y 48 caracteres | El renglón más largo que **no se parte** es el ancho real de esa impresora. |
| Un nombre de producto de 49 caracteres | Si el texto se acomoda sin correr la columna de precios. |
| Los totales | Si la columna derecha queda alineada y si el total destacado sale más grande. |
| Una barra negra maciza y otra rayada | Si el cabezal imprime parejo de borde a borde (una banda clara al centro es cabezal sucio o gastado). |
| El pie | Que la cuchilla no se lleve la última línea. |

En pantalla, además, dice **cuánto papel gasta** el ticket (hoy: 187 mm) — dato
que sólo existe después de armarlo, y que sirve para decidir qué documentos vale
la pena mandar al rollo.

---

## 4 bis. Cuando la impresión directa falla en una sala

Pasó en el primer intento (2026-08-13, caja de una sala): el aviso decía «esta
computadora no tiene el programa de impresión directa». **El aviso mentía por
construcción** — con una petición sin CORS, «no hay nada escuchando» y «el
navegador me bloqueó» rechazan igual, con el mismo `TypeError: Failed to fetch`,
y el primero es lo normal fuera de una sala mientras el segundo pasa DENTRO de
una sala con todo bien instalado. Elegir una de las dos manda a buscar el
problema al lugar equivocado. Corregido: el aviso ahora dice qué pasó, muestra la
dirección que intentó y lo que contestó el navegador.

Y había un defecto real detrás: el envío usaba **`printpos1.php` con el formato
viejo**, no `printik_pista.php` con las secciones. Corregido.

Para diagnosticarlo, en orden:

1. **Abrir `http://localhost/impresion_dte/printik_pista.php` en una pestaña de
   esa misma computadora.** Si responde algo (aunque sea un error de PHP), el
   programa está ahí y el problema es del navegador o del portal. Si dice que no
   se puede conectar, el programa no está corriendo.
2. **Usar el mismo navegador donde ya se imprimen los tickets.** El permiso para
   alcanzar la red local se da **por navegador y por sitio**: que el otro sistema
   imprima desde esa computadora no le da el permiso al portal. Si el navegador
   lo pide, hay que concederlo; si lo bloqueó, se destraba en el candado de la
   barra de direcciones.
3. **Si la computadora es Windows**, elegir Windows en la pantalla: el archivo y
   los parámetros son otros. No se prueban los dos automáticamente a propósito —
   donde existieran ambos, imprimiría dos veces.

`http://localhost` desde una página `https` **no** es contenido mixto (la
especificación considera confiable a localhost), así que eso no es lo que lo
bloquea.

## 4 ter. Lo que de verdad lo bloqueaba: nuestra propia CSP (2026-08-14)

Nada de lo de arriba era la causa. **La CSP que el portal se manda a sí mismo en
`vercel.json` no incluía `http://localhost` en `connect-src`**, así que el
navegador cortaba el pedido *antes de tocar la red*. El síntoma es idéntico al de
«no hay nadie escuchando» —el mismo `TypeError`—, y la única pista está en la
consola del navegador, no en la respuesta.

Medido en la caja de Salud 3 (`salud3-ThinkCentre-M73`, Linux, Firefox). Las tres
señales que lo delataron, ninguna concluyente sola:

| Señal | Qué descartaba |
|---|---|
| `curl` alcanza las tres direcciones desde esa misma computadora | La máquina, la red y el programa |
| La pestaña directa a `printik_pista.php` muestra el programa corriendo | Que el programa no estuviera instalado |
| Bajar el bloqueo de contenido mixto de Firefox no cambia nada | Contenido mixto como mecanismo |

Tres cosas que sólo cuadran juntas si **el pedido no sale nunca**.

De la pestaña directa salieron además dos datos que no se podían leer desde acá:
el programa escribe **directo a `/dev/usb/lp0`** (no pasa por CUPS ni por la cola
`pos-80`), y los avisos de PHP nombran uno por uno los nueve campos que espera —
`totales`, `total_letras`, `encabezado`, `cuerpo`, `pie`, `efectivo`, `cambio`,
`qr`, `img`—, **exactamente los nueve que manda `seccionesParaElPrograma()`**. El
contrato reconstruido leyendo su código estaba bien.

**La lección de método**: `comprobarLaConexion()` atrapaba el error en un `catch`
vacío, así que «no contesta» significaba tres cosas a la vez. Es el mismo defecto
que §4 bis ya había corregido en el botón de imprimir, y que había quedado vivo en
el de comprobar — corregir un instrumento no corrige a su gemelo. Hoy el motivo
viaja en el resultado y la pantalla lo muestra bajo cada renglón que falla.

### La caja de Salud 3, medida

Tres colas en CUPS: `pos-80` (`usb://Printer/POS-80`, sana, es la ticketera),
`80series2` y `l210`, las dos deshabilitadas. **La predeterminada del sistema es
`l210`**, o sea que cualquier `lp` sin `-d` va a una impresora muerta.

`lp -d pos-80 -o raw /etc/hosts` **sacó papel legible**: impresora, cola y modo
crudo funcionan, y un agente local que tubee a ese comando tiene su capa de abajo
ya probada. No reconfigurar `pos-80`: es por donde imprime hoy el sistema de
facturación; si hiciera falta otra forma, se crea una cola nueva al mismo
dispositivo.

En ese papel **un renglón de 58 caracteres no se partió** — la letra por defecto
de esa ticketera da ≥58 columnas, coherente con las 54 del ticket del origen en
letra chica. El 40 del portal es un límite de su propio HTML, no del papel.

## 4 quater. El primer ticket impreso, y los dos defectos que trajo (2026-08-14)

Salió papel desde el portal en la caja de Salud 3, con la maqueta de 54 columnas
y los códigos ESC/POS. Lo que el papel corrigió:

**Las tildes salen mal.** «IMPRESIÓN» → `IMPRESIŁN`, «NUÑEZ» → `NUÆEZ`, y el `·`
de los separadores → `™`. El rollo interpreta un codepage de un byte y el portal
manda dos por carácter acentuado. Corregido en v2.601.2 transcribiendo a ASCII
(`soloASCII()`) — que es lo que hace el propio sistema de facturación: sus
encabezados y pies no tienen un solo acento. Para conservar la ñ habría que
mandar `ESC t n` y escribir el cuerpo en ese codepage; se decide con papel.

**La prosa la partía la impresora.** Salió `…ES EL ANCHO DE EST` / `A IMPRESORA.`
El texto de un bloque viajaba entero y el aparato lo cortaba donde se le acababa
el ancho, sin saber qué es una palabra. Ahora se parte en `seccionesParaElPrograma`.

**Lo que el papel confirmó sin tocar nada:** las tres reglas (32, 40 y 48) entran
completas, y el punto donde la impresora cortó la prosa ubica su ancho real cerca
de las **62 columnas**. Las 54 del portal caben con margen — la geometría contada
sobre el ticket real del origen queda como está.

**La barra de prueba del cabezal no viaja por el envío directo**: es un bloque de
CSS, y ese control existe sólo en el camino del diálogo. La hoja de §4 promete un
test que el rollo, por ese camino, no imprime.

### Los códigos de alineación no mandan; el relleno sí

En ese mismo ticket, **los totales salieron centrados pese al `ESC a 2`** y el
renglón sobrante de un nombre largo (`CAJA CON 100 UNIDADES`) salió indentado unas
17 columnas pese al `ESC a 0`. Lo único que quedó en su lugar fue la tabla de
items — que es justo la que **se rellena con espacios en `filaDeItem()`** en vez de
pedirle al aparato que alinee.

Dos explicaciones posibles y no hace falta elegir: que `printik_pista.php` centre
cada renglón por su cuenta (uppercasea todo con `strtoupper`, así que toca el
texto), o que `ESC a` no sobreviva ese mismo `strtoupper` — **es el único código
que usamos con letra minúscula**, y `ESC A` es otro comando. Las dos llevan a la
misma regla:

> **Alinear rellenando, nunca con `ESC a`.** Un `dosColumnas` sin espacios al
> final se ve igual centrado que alineado a la derecha, así que deja de depender
> de quién decida la alineación.

Aplicado a los totales en v2.601.3. Falta el papel que lo confirme.

## 5. Cómo agregar impresión a una pantalla

Una sola llamada. **No elijas el camino a mano**: `imprimirDocumento()` intenta
primero el envío sin diálogo —el papel sale solo, como en la caja— y cae al
diálogo del navegador si esta computadora no tiene el programa. El respaldo es
seguro porque sólo se dispara cuando el envío directo **fue rechazado**, o sea
cuando nadie lo recibió: no puede imprimir dos veces.

```js
import { imprimirDocumento } from '../utils/ticketPrint';

const r = await imprimirDocumento({
    titulo: 'COTIZACIÓN',                       // qué es este papel
    encabezado: { titulo: EMPRESA.nombre, lineas: [sucursal.name, `Tel. ${tel}`] },
    datos: [['Fecha', fecha], ['Atiende', empleado]],   // los pares de arriba
    items: {
        columnas: [{ label: 'PRODUCTO' }, { label: 'CANT' }, { label: 'P. UNIT' }, { label: 'TOTAL' }],
        filas: productos.map(p => [p.nombre, String(p.cant), money(p.pu), money(p.total)]),
    },
    totales: [['GRAVADO', money(g)], ['TOTAL', money(t), true]],   // true = destacado
    pie: ['Precios sujetos a cambio sin previo aviso'],
});
if (!r.ok) toast.error(r.detalle);
```

`ancho` y `sistema` NO se pasan: salen de los ajustes de esa computadora
(`leerAjustesDeImpresion()`), que se configuran una vez en **Sistema → Prueba de
impresión** y quedan. Pasá `ticket.ancho` sólo si la pantalla tiene un motivo
para elegirlo. Y `imprimirDocumento(doc, { forzarDialogo: true })` si querés que
el usuario elija impresora sí o sí (por ejemplo, para guardar en PDF).

**`ok: true` significa que el pedido fue recibido, NO que salió papel.** La
respuesta del programa de la caja es opaca por construcción. La prueba es el
papel; no prometas en pantalla lo que no podés saber.

### Cinco reglas que se rompen solas

1. **Sólo ASCII.** El rollo no lee UTF-8 (§4 quater). `soloASCII()` lo resuelve en
   el envío directo, pero si escribís un rótulo con tilde, en papel sale sin ella:
   tenelo en cuenta al redactar, no lo descubras impreso.
2. **54 columnas en letra chica, 40 en normal** (`COLUMNAS_TICKET`). Un renglón más
   largo lo parte la impresora donde se le acabe el ancho.
3. **Alinear rellenando, nunca con `ESC a`** — ver la subsección de §4 quater.
   `dosColumnas()` y `filaDeItem()` ya lo hacen; no agregues códigos de alineación.
4. **El papel no tiene tema.** Sólo negro, sin fondos rellenos, sin tokens del
   tema y sin `rounded-*`: un gris elegante en pantalla es una mancha en térmico,
   y `rounded-btn` vale 9999 px en el tema de vidrio (§3.4).
5. **La vista previa y el papel son el mismo documento.** Si necesitás mostrar el
   ticket antes de imprimir, usá `construirTicketHtml()` en un iframe y mandá ESE
   iframe con `imprimirMarco()`. No escribas un segundo maquetador — es la regla
   que ya está en `CLAUDE.md`.

### El corte del papel: quién lo manda depende del camino (2026-08-18)

Costó cuatro versiones en un día (v2.661.5 a v2.661.9) porque los dos caminos se
trataron como uno solo. **No lo son:**

| Camino | Quién manda el corte | Qué agrega el portal |
|---|---|---|
| Directo (`printik_pista.php`, la caja) | **El programa ajeno**: `chr(29).chr(86)."1"` después del pie, junto con el pulso del cajón — leído en su código | **Nada.** Un corte acá se SUMA al suyo |
| Cola de la sala (el agente) | **Nadie.** `lp -o raw` entrega los bytes tal cual, sin driver que agregue nada | `GS V '1'` al final de `textoParaElRollo()` |
| Diálogo del navegador | El controlador de la impresora que elija quien imprime | No aplica: ahí no hay ESC/POS |

Por eso el reporte de «no corta» se leyó mal dos veces: la primera era que **no
llegaba nada al papel** (permiso de escritura sobre `/dev/usb/lp0`, ver §5 bis),
y la segunda era el camino de la cola —el que usa quien imprime desde el teléfono
o desde otra computadora—, que efectivamente no tenía corte y salía entero.

Tres cosas que hay que saber antes de tocar esos bytes:

1. **El comando no lleva parámetros ni bytes en cero.** `GS V 66 0` son cuatro
   bytes terminados en NUL; el viaje HTTP + PHP se lo come, la impresora espera
   el parámetro que falta y **se traga el trabajo siguiente** — colgó la
   ticketera de Salud 4 y con ella los tickets del otro sistema. `GS V '1'` son
   tres bytes, está medido en esa misma ticketera, y es el que ya usan los
   tickets de facturación en esas salas.
2. **Corte parcial, no total.** Deja una pestaña: el ticket queda colgando en vez
   de caerse al piso, que importa justo cuando nadie está parado ahí esperándolo.
3. **Va después de los 12 saltos del margen**, nunca en su lugar: la cuchilla
   está arriba del cabezal (§4 quater).

Y el `CORTAR=1` del agente queda apagado: era de cuando el ticket no traía el
suyo, y encenderlo hoy corta dos veces.

### La ticketera no se comparte: CUPS le quita el dispositivo al otro sistema (2026-08-19)

**Reporte de Salud 1, la mañana en que se instaló el agente ahí:** «si imprimo
desde el portal, deja de imprimir el ERP; debo apagar y encender la ticketera
para que imprima por el ERP de nuevo».

No es un byte del ticket. Son **dos formas de abrir la misma impresora, y no
conviven**:

| Quién | Cómo escribe |
|---|---|
| Sistema de facturación (`printik_pista.php`) | **Directo a `/dev/usb/lp0`** — leído en su código, §5 bis |
| Agente de la cola (hasta v2.664.4) | `lp -d POS-80 -o raw`, o sea **CUPS** |

El backend `usb` de CUPS reclama la interfaz USB y **desengancha el módulo
`usblp` del kernel**, que es justamente el que crea `/dev/usb/lp0`. Al terminar
debería devolverlo; con estas impresoras muchas veces no lo hace. El archivo
queda muerto, el otro sistema escribe al vacío, y apagar y prender la ticketera
la vuelve a enumerar — que es exactamente el gesto que lo arregla.

**Corregido en v2.664.5**: el agente le escribe al MISMO archivo que el otro
programa (`DISPOSITIVO`, por defecto `/dev/usb/lp0`) y CUPS queda de respaldo
para una caja donde ese archivo no exista o no se pueda escribir. Va por `dd`
para poder ponerle plazo: una escritura a un dispositivo mudo se cuelga para
siempre y con ella la cola de la sala entera.

**Tres cosas que se deducen de esto y conviene tener presentes:**

1. **Un canal nuevo hacia un aparato compartido se prueba contra el otro
   programa, no solo.** El papel salió bien las cinco primeras veces: lo que se
   rompió fue el sistema de al lado, y de eso el papel no dice nada.
2. **`lp -o raw` estaba bien elegido y aun así era el camino equivocado.** El
   modo crudo resolvía «que no me filtren los bytes»; el problema era «quién es
   el dueño del dispositivo».
3. **Sospechar de esto también en el cuelgue del 2026-08-18 en Salud 4**, que se
   atribuyó entero a `GS V 66 0`. Aquel comando estaba mal por su cuenta —cuatro
   bytes con un NUL al final— pero el síntoma es el mismo, y el agente de esa
   caja ya imprimía por CUPS. No se puede afirmar cuál de los dos era; sí que
   había dos causas posibles y sólo se corrigió una.

### Las piezas, si hace falta bajar un nivel

| Función | Para qué |
|---|---|
| `imprimirDocumento(ticket, opts)` | **La que llama una pantalla.** Directo con respaldo al diálogo |
| `construirTicketHtml(ticket)` | El HTML del ticket, para una vista previa |
| `imprimirMarco(marco)` · `ajustarAltoDePagina(marco)` | Imprimir un iframe ya pintado, con el alto medido |
| `imprimirTicket(ticket)` | Sólo el diálogo, sin vista previa |
| `enviarAImpresoraDeLaComputadora(ticket, {sistema})` | Sólo el envío directo |
| `comprobarLaConexion()` · `permisoDeRedLocal()` | Diagnóstico, sin gastar papel |
| `leerAjustesDeImpresion()` · `guardarAjustesDeImpresion()` | El ancho y el sistema **de esa computadora** |
| `seccionesParaElPrograma(ticket)` | El contrato de nueve campos (lo usan los tests) |

La forma del objeto `ticket`, campo por campo, está en el JSDoc de
`construirTicketHtml()`. La geometría está anclada en
`tests/unit/ticketPrint.test.js` contra un ticket real: si alguien la cambia «para
que se vea mejor», la prueba falla acá en vez de salir torcido en la sala.

## 5 bis. Si hay que rearmar una caja desde cero (2026-08-15)

Pregunta del usuario: *«si se restaura, ¿cómo podríamos configurar el pos-80 para
seguir imprimiendo?»*.

La respuesta corta es que **hay dos capas independientes, y sólo una depende de
quien mantiene el sistema de facturación**:

| Capa | Qué hace falta | ¿Podemos rehacerla nosotros? |
|---|---|---|
| El aparato | Que el núcleo vea la ticketera USB → `/dev/usb/lp*` | **Sí.** Es enchufar el cable |
| La cola | Una cola de CUPS en modo crudo (`pos-80`) | **Sí.** Tres comandos |
| El programa del origen | Servidor web + PHP + la carpeta `impresion_dte/` | **No.** Esos archivos **no están en su servidor** (404): viven sólo en el disco de cada sala. Hay que pedirle la reinstalación a quien lo mantiene |

O sea: **la impresora la recuperamos nosotros; el programa ajeno no.** Por eso el
agente propuesto en §5 ter no lo usa.

`scripts/diagnostico-caja.sh` (sólo lectura, no imprime ni cambia nada) levanta
todo lo de abajo antes de tocar la máquina.

### 1. Que el sistema vea la impresora

```bash
lsusb | grep -i -E 'print|pos'      # el aparato en el bus
ls -l /dev/usb/lp*                  # el dispositivo crudo — dueño root, grupo lp
dmesg | grep -i usblp               # si no aparece, el módulo usblp no cargó
```

Si `/dev/usb/lp0` existe, **ya se puede imprimir sin CUPS ni nada más**: es
exactamente por donde escribe el programa del origen.

### 2. Un nombre estable para el dispositivo

`lp0`/`lp1` se reparten por orden de encendido, así que con más de una impresora
el número puede bailar. La ticketera de Salud 3 tiene serie `48FEB70F3DB2`, y con
eso se le fija un nombre propio en `/etc/udev/rules.d/99-ticketera.rules`:

```
SUBSYSTEM=="usbmisc", KERNEL=="lp[0-9]*", ATTRS{serial}=="48FEB70F3DB2", \
  SYMLINK+="ticketera", MODE="0660", GROUP="lp"
```

⚠️ **El `SUBSYSTEM` hay que confirmarlo en la máquina** (`udevadm info -a -n
/dev/usb/lp0 | head -30`): según la versión del núcleo puede ser `usbmisc` o
`usb`. Es el único paso de esta receta que no está medido.

### 3. La cola de CUPS en modo crudo

Es la que ya funciona hoy (`lp -d pos-80 -o raw` sacó papel el 2026-08-14). Para
recrearla:

```bash
lpstat -v                                   # ver el URI exacto del aparato
sudo lpadmin -p pos-80 -E -v 'usb://Printer/POS-80?serial=48FEB70F3DB2' -m raw
sudo cupsenable pos-80 && sudo cupsaccept pos-80
lp -d pos-80 -o raw /etc/hosts              # prueba: gasta unos centímetros de papel
```

Dos advertencias:

- **`-m raw` está en retirada en CUPS 2.4+.** Si lo rechaza, la alternativa es
  `-m everywhere` o directamente saltear CUPS y escribir al dispositivo del paso
  2 — que es lo que hace el origen y está probado en ese hardware.
- **NO tocar `pos-80` en una caja que funciona**: es por donde imprime hoy el
  sistema de facturación. Si hiciera falta otra configuración, se crea una cola
  nueva apuntando al mismo dispositivo.

### 4. La trampa que ya nos mordió

La predeterminada del sistema en Salud 3 es **`l210`, una impresora deshabilitada**.
Cualquier `lp` sin `-d` va ahí y no sale nada, sin error visible. **Siempre `-d
pos-80` explícito**, en el agente y a mano.

## 5 ter. Imprimir desde cualquier computadora — cómo se vería (2026-08-15)

Diseño consultado el 2026-08-15, **sin trabajo aprobado todavía**. Ver la memoria
`project_impresion_en_ticketera_2026_08_13` para por qué se descartó apuntar a la
IP de la caja (contenido mixto: `https` no puede llamar a `http://192.168.x.x`, y
la exención es sólo de `localhost`).

### Qué habría que relevar por sucursal

**Sí, una vuelta por las 6 salas con caja** —La Popular y Salud 1 a 5; Bodega y
Administración no venden—. Pero se releva **una vez**, y lo que varíe queda como
**dato en una tabla, no como código**: sucursal, nombre de la cola, sistema
operativo. Correr `scripts/diagnostico-caja.sh` en cada caja es exactamente ese
relevamiento.

Lo que hay que confirmar sala por sala: el nombre de la cola (`pos-80` es lo
medido en Salud 3, **no está dicho que se llame igual en las otras**), si la
predeterminada del sistema también está rota, y si alguna caja es Windows — el
origen reporta `sist_ope: "lin"`, pero está medido en una sola.

### Cómo saldría el papel

**Idéntico al de hoy.** La maqueta la decide el portal, no el aparato desde el
que se manda: el agente recibe las mismas nueve secciones que arma
`seccionesParaElPrograma()` y las tubea a la impresora. Las 54 columnas, el ASCII
y el alineado por relleno valen igual si el ticket salió de una computadora de
sala, de la caja o de un teléfono.

### Cómo se vería en pantalla

```
tu puesto (o el teléfono)          la caja
─────────────────────────          ───────
[Imprimir en caja]  ──▶ en cola
                                   el agente pregunta cada 2 s
                                   lp -d pos-80 -o raw  ──▶ sale el papel
       «Impreso en caja» ◀──────── y avisa que salió
```

Dos cosas que hoy no se pueden y ahí sí:

1. **El acuse es real.** Hoy `ok: true` significa «lo recibió», nunca «salió
   papel» (§5). Con la cola, el agente sabe si el comando terminó bien y lo
   reporta: la pantalla puede decir la verdad.
2. **Se puede mandar desde el teléfono**, que hoy no tiene ningún camino.

Y una que hay que decidir antes de escribirlo: **un trabajo encolado con la caja
apagada tiene que vencerse** (diez minutos, digamos). Si no, a la mañana siguiente
sale un ticket de ayer que nadie está esperando.

## 6. Lo que queda abierto

1. ~~**El ancho del rollo para el camino del navegador.**~~ Medido el 2026-08-14
   (ver §4 quater): la ticketera da ~62 columnas y las 54 del envío directo caben.
   Queda sólo la mitad de la pregunta: **el HTML del portal sigue en 40** con la
   letra que tiene, y falta decidir si se iguala a 54 o se deja más grande a
   propósito. Los dos caminos imprimen bien hoy.
2. ~~**La impresión directa sin una impresión exitosa que la confirme.**~~
   **CERRADO el 2026-08-14**: imprime desde el portal en la caja de Salud 3. Lo
   bloqueaba la CSP del propio portal (§4 ter), no la sala.
3. **Las imágenes van vacías.** El origen manda logo y dos QR por URL; el portal
   no manda ninguna hasta comprobar que el programa las omite sin romperse cuando
   llegan vacías. Es lo único del contrato que no salió de leer su código — y el
   ticket del 14-08 salió bien con las tres vacías, así que **omitirlas no rompe
   nada**; falta sólo saber si las dibuja cuando llegan.
3. **Qué documento va al rollo.** El motor está listo y no está enganchado a
   ninguna vista todavía. Los candidatos, en orden de uso probable: una
   cotización (hoy sale en hoja carta), el resumen de un pedido recibido, el
   corte de un conteo. Falta la decisión del usuario.
4. **Reimprimir un documento fiscal es otra cosa** y no está acá. Una factura ya
   emitida tiene su sello y su correlativo, y una copia impresa desde el portal
   se vería igual que el original; si alguna vez hace falta, se decide primero
   qué dice el papel para que no pueda pasar por el comprobante.
