# Fichas de clientes y envío a Hacienda

> Movido desde `CLAUDE.md` el 2026-11-06 sin cambiar el contenido. Allá queda un resumen corto en «Fichas de clientes y Hacienda»; acá, el detalle, las mediciones y la historia. Las cifras de este archivo son de la fecha en que se escribieron: la verdad vigente vive en el archivo o la tabla que cada párrafo nombra.

## Fichas de clientes y envío a Hacienda: un circuito automático (2026-08-09)

Detalle completo en **`docs/RETOMAR-FACTURACION-Y-DTE-2026-08-09.md`** (el del
07-08 quedó reemplazado). Lo que hay que saber antes de tocar cualquiera de sus
piezas:

**Dos crons encadenados, y el orden importa.** 21:30 SV
`sincronizar-fichas-clientes` corrige las fichas; 22:30 SV `regularizar-dte`
manda a Hacienda. Al revés, el envío recibe rechazos por datos que ya estaban
arreglados. **Y desde el 09-08 el envío cierra el lazo la MISMA noche**: llama a
la corrida de fichas en alcance «rechazos» y reenvía, en vez de esperar 24 horas.

**Esa segunda vuelta se dispara por «lo puedo escribir», NO por «accionable»**
(corregido el 2026-08-16). `dte_rechazos_vigentes.accionable` significa *Hacienda
se queja de un dato del receptor* — que no es lo mismo que *esto se arregla
solo*. Con el disparador viejo, una noche entera de las dos funciones
encadenadas no cambió un dato: los 4 rechazos eran 3 de contribuyentes (a los
que no se les escribe la ficha) y uno de un campo sin regla. Hoy se le pregunta
a `fichas_para_corregir_dte()` —la MISMA lista que usa la corrida— cuántas
filas hay con `origen='rechazo' AND puede_escribir AND NOT ya_corregido`, y
además **sólo se reenvía si la corrección escribió algo**. Mandar el mismo
documento sin cambiarle un dato es pedir el mismo rechazo.

**La tabla de decisión de `sincronizar-fichas-clientes` y la lista
`campo_ficha IN (...)` de `fichas_para_corregir_dte()` son la misma lista dicha
dos veces, y se mueven juntas.** Un campo de más deja fichas dando vueltas sin
que nadie las escriba; uno de menos las vuelve **invisibles** para el proceso
hecho para arreglarlas. Pasó con `receptor.telefono`: bien clasificado, marcado
accionable, y fuera de las dos listas — la corrida informaba «3 candidatos»
sobre 4 rechazos y nadie notaba la que faltaba. Hoy la lista es distrito,
municipio, departamento, dui y phone. **Un teléfono que falta o no tiene 8
dígitos se REEMPLAZA por el de la empresa (`23010013`), no se borra como el
DUI**: un DUI inventado sería un dato falso de identidad, y Hacienda en cambio
EXIGE un teléfono con forma — sin él el documento no entra.

**«Sin sello» significa sin sello VÁLIDO — y hay que decirlo en los TRES
sitios.** `recibido_mh` es `text` con 40 caracteres: `IS NULL` y `!!valor` dan
por buena cualquier basura. Estuvo mal en el filtro del barrido, en la guarda
previa al envío y en la cola de Pendiente MH, y los tres tenían que fallar
juntos para que una factura del 16-may-2025 pasara **un año** figurando como
confirmada. Regla del usuario: lo único que NO se manda a Hacienda es lo que ya
tiene sello y su observación es de otra cosa. Ver
[[feedback_nombre_de_columna_no_es_su_tipo]] — «el tipo manda» se aplica al
CONCEPTO, no sólo a la línea donde apareció el bug.

**Al corregir una ficha se escribe en el ERP, NO en el portal.** `regularizar-dte`
le pide al ERP que arme el DTE (`creaJsonDTe`), así que el receptor sale de la
ficha del ERP; un `UPDATE` sobre `customers` es cosmético. Las dos copias
divergen y el portal a veces muestra la buena. Y los códigos de
departamento/municipio/distrito del ERP son **por departamento**: resolver por
etiqueta y escribir en cascada — ver
[[feedback_los_codigos_de_ubicacion_del_erp_son_por_departamento]].

**`_shared/distrito.ts` es una TRADUCCIÓN verificada, no código nuevo.** El
original es `elegir_distrito` de `scripts/migracion-clientes/bloque.py`, con
25,946 decisiones reales encima, y tres de sus seis reglas se descubrieron
corrigiendo errores medidos. Se enfrentaron las dos implementaciones sobre esos
25,946 casos: **iguales, 0 distintas**. **Cualquier cambio en cualquiera de las
dos exige volver a correr `comparar_matcher.mjs`** — si no, se pierde justo lo
que la hace confiable. Y ojo: la traducción reproduce los defectos del original
a propósito (`norm()` deja espacios dobles donde había una coma, y eso cambia
qué regla gana). Mejorarlo es otra decisión y va en `bloque.py` primero.

**El cliente se liga por el número del ERP, nunca por el nombre.** El nombre
sale de cómo se escribió la factura. Medido sobre 68 duplicados reales:
normalizar acentos evita 0, alfanumérico evita 3 — el 96% son nombres
genuinamente distintos (`VAQUEZ`/`VASQUEZ`). Cuando `sync-dte-sales` no
reconoce un nombre, le pregunta al ERP a qué cliente pertenece la factura
(`reimprimir_factura.php` → `id_cliente`), con tope de 25 lecturas por corrida
y degradación al comportamiento viejo si el ERP no responde.

**Fusionar clientes BORRA una ficha y mueve su historial.** `fusionar_cliente_
duplicado` resuelve el destino desde el `erp_id` para que el llamador no pueda
elegirlo, y quien la llama agrega su propio freno: si los nombres no se parecen,
no fusiona — publica en «Por revisar» con motivo `fusion_dudosa`. Unir a dos
personas que no lo son mezcla sus historiales y no se deshace.

**El alcance de la escritura al ERP lo decide `alcance_escritura_ficha()`, en la
base** — no un `if` en la Edge Function. Tres valores, y ninguno es un booleano
a propósito: «se puede escribir» resultó ser una pregunta de grado.

| categoría | alcance | qué se le escribe |
|---|---|---|
| Consumidor, o ficha sin categoría | `todo` | la tabla de decisión completa |
| Contribuyente · Gran Contribuyente | `solo_distrito` | **sólo** el distrito, y sólo si falta |
| Extranjero, o una categoría nueva | `ninguno` | nada: sólo espejo |

La decisión del 2026-08-09 era «a los contribuyentes no se los toca, sus CCF
pueden trabarse y está aceptado». El usuario la abrió el **2026-08-16**: *«si es
contribuyente, permite editar el distrito si no está también»*.

**El distrito del contribuyente se DERIVA con el matcher, nunca con el triple
por defecto.** Es la parte que no se puede improvisar: de las 77 fichas de
contribuyente sin distrito, **15 viven fuera de Chalatenango** (San Salvador,
La Libertad, San Miguel, Sonsonate). El default habría mudado de departamento a
esas 15 — o sea, cambiado el domicilio de un documento fiscal. Las 77 tienen
departamento y municipio; lo único que falta es el distrito, así que
`elegirDistrito` lo elige DENTRO de los del municipio propio.

Consecuencia que hay que conocer: cuando la dirección no nombra ningún distrito,
el matcher elige uno **determinista** entre los del municipio (2 de los 3
primeros casos reales). Es un distrito del municipio correcto —que es lo que
Hacienda exige y lo que la ficha no tenía—, pero no es un dato averiguado. Si
alguna vez se decide que un contribuyente sólo se corrige con evidencia en la
dirección, el lugar es la rama `solo_distrito` de `sincronizar-fichas-clientes`.

Y `ninguno` es la falla segura: una categoría que nadie decidió NO se escribe.
Al revés, el día que aparezca una, el circuito le escribiría sin que nadie lo
haya resuelto.

**`identificacion.fecEmi` no es un dato del cliente** y NO se corrige: aparece
siempre que se transmite hoy una factura emitida antes, y cambiarla sería
alterar un dato fiscal. Solo las observaciones `receptor.*` son accionables.

**El flag `--no-verify-jwt` depende de QUIÉN llama a la función, no de a qué
circuito pertenece.** Cron o Postgres → `--no-verify-jwt` (no hay sesión que
presentar, y la función valida por su cuenta). Navegador → JWT. Hasta el
2026-11-06 acá había una lista fija de «las cuatro funciones que invoca un
cron»; las migraciones llaman por `functions/v1/` a decenas, así que la lista
era falsa por omisión. Un redeploy sin el flag deja a la función en 401 **antes
de ejecutar una línea** (pasó tres veces). Y al revés: `aplicar-solicitud-facturacion`
la llama el navegador con la sesión de quien aprueba y vive con
`verify_jwt: true`; desplegarla con el flag habría *abierto* una función que
anula facturas. **Antes de cualquier redeploy, leer el valor VIVO** —
`list_edge_functions` lo trae en `verify_jwt`— en vez de confiar en una lista.
