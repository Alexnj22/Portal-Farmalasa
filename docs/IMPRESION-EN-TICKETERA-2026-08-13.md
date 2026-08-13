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

## 5. Lo que queda abierto

1. **El ancho real de las ticketeras no se sabe todavía.** 40 columnas es lo que
   entra a 80 mm en la letra elegida, y coincide con el origen — pero eso es
   aritmética, no papel. Lo dice la primera prueba impresa en una sala.
2. **El camino sin diálogo está escrito y no probado.** Ese programa no corre en
   una Mac: lo que se afirma es la forma del pedido, copiada de la que usa el
   origen. Que imprima se comprueba en una sala, y el resultado hay que anotarlo
   acá. Ojo con dos cosas al probarlo:
   - `http://localhost` desde una página `https` **no** es contenido mixto (la
     especificación considera confiable a localhost), pero los navegadores nuevos
     pueden **pedir permiso** para alcanzar la red local la primera vez.
   - Si la computadora es Windows hay que elegir Windows en la pantalla: el
     archivo y los parámetros son otros. No se prueban los dos automáticamente a
     propósito — donde existieran ambos, imprimiría dos veces.
3. **Qué documento va al rollo.** El motor está listo y no está enganchado a
   ninguna vista todavía. Los candidatos, en orden de uso probable: una
   cotización (hoy sale en hoja carta), el resumen de un pedido recibido, el
   corte de un conteo. Falta la decisión del usuario.
4. **Reimprimir un documento fiscal es otra cosa** y no está acá. Una factura ya
   emitida tiene su sello y su correlativo, y una copia impresa desde el portal
   se vería igual que el original; si alguna vez hace falta, se decide primero
   qué dice el papel para que no pueda pasar por el comprobante.
