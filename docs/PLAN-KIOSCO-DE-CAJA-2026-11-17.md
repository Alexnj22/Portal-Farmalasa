# Plan · Kiosco de caja: vender, cobrar y llevar la caja desde el portal

Escrito el 2026-11-17. Lo pidió el usuario: que la caja deje de depender de
una persona con sesión abierta, que todos la puedan atender, y que **cada
acción quede a nombre de quien la hizo**. Al finalizar una venta se escanea el
carné.

Decisiones del usuario (2026-11-17):

- El kiosco **también arma ventas** cuando el cliente llega directo a caja.
- El kiosco es **la computadora de caja** (la que tiene ticketera, lector y
  caja de dinero). Las tabletas de marcación siguen como están.
- Los permisos **siguen como están hoy**. Lo que cambia es que siempre queda
  la huella de quién hizo qué.

---

## 0. Principios

1. **El ERP sigue emitiendo.** El portal maneja la caja del ERP como ya lo
   hace con la preventa. La numeración, la factura a Hacienda, el inventario
   y el cierre (Z) siguen siendo del ERP. El portal no emite documentos
   fiscales por su cuenta.
2. **No ralentizar.** Cobrar desde el kiosco tiene que ser **igual o más
   rápido** que F8 en la caja. Meta: menos de 5 segundos desde el escaneo del
   carné hasta el ticket, cuando Hacienda contesta normal.
3. **Una huella por acción.** Quién, en qué equipo, a qué hora y por cuánto.
   Sin sesión abierta de nadie: el carné identifica en el momento de actuar.
4. **Siempre hay respaldo.** La caja del ERP sigue disponible durante todo el
   piloto. Si el kiosco falla (sin internet, el ERP cambió su página), la
   sucursal cobra en el ERP como hoy, sin perder ni una venta.
5. **Una sola verdad.** Lo que el kiosco cobró se compara solo contra la
   factura sincronizada del ERP. Si no cuadran, se ve.

---

## 1. Lo que ya existe (verificado el 2026-11-17)

| pieza | estado | dónde |
|---|---|---|
| Kiosco sin sesión, equipo dado de alta por sucursal (`deviceId` + `deviceToken`) | en uso, para marcar | `/kiosk`, `src/data/kiosco.js` |
| Identificar por carné en el servidor, con freno de intentos | en uso | `kiosco_identificar`, `KIOSK_PIN_RATE_LIMITED` |
| Lo que se puede hacer sin sesión, declarado uno por uno | en uso | `auditoria/superficie-anon.json` + `gate:auditoria` |
| Mandar, corregir y anular preventas en la caja del ERP, con listas que sobreviven la Ñ | en uso | `preventa-caja`, `_shared/preventaCaja.ts` |
| Abrir, corte a ciegas, ingresos, vales y cierre del día en la caja del ERP | en uso (Mi caja, con sesión) | `operar-caja`, `hacer-corte-caja` |
| Mandar un documento a Hacienda y guardar el sello en el ERP | en uso (reenvío nocturno) | `_shared/erp-dte.ts`, `regularizar-dte` |
| Imprimir en ticketera desde el portal | en uso | `imprimirDocumento` |

**Cómo cobra la caja del ERP hoy** (leído de `js/funciones/venta.js`,
`dte_auto.js` y `util.js` de la caja, sin cobrar nada):

1. **Guardar (F8)**: `preventa.php` `process=insert`. Lleva los renglones con
   lote, presentación y precio elegido, los totales (gravado, IVA, exento,
   retención, percepción), `tipo_impresion` (COF/CCF), la forma de pago
   (`con_pago`), el cliente, `codvende`, `id_factura` (la referencia de la
   preventa) y **`id_apertura`, `turno` y `caja`**, que salen de campos
   escondidos de la página.
2. **Efectivo y cambio**: `venta.php` `process=imprimir_fact` con lo
   recibido. La caja advierte que sin este paso «no se tomará en cuenta en las
   ventas ni se descargará de inventario».
3. **Hacienda**: la **página** de caja arma el JSON (`creaJsonDTe`), pide el
   token, lo manda por `proxydte.php`, guarda la respuesta
   (`save_response_mh`) e imprime el ticket con
   `_helper_ticket_dte.php` `process=print_ticket_dte`. Ese helper devuelve el
   encabezado, el cuerpo, el pie y el QR ya armados.

**Números de hoy**: 10 preventas del portal facturadas, mediana de 4 minutos
entre que se mandan y se cobran (p90: 7), y 1 cobrada distinto. La muestra es
chica: la fase 0 la sigue midiendo.

---

## 2. Qué es el kiosco de caja

La computadora de caja dada de alta como **kiosco tipo caja** de su sucursal.
Es una sola pantalla, en reposo **sin nadie identificado**, con cuatro
pestañas:

| pestaña | qué hace | quién |
|---|---|---|
| **Vender** | La misma pantalla de Preventa: buscar cliente y productos, lotes, puntos | cualquiera |
| **En caja** | La cola de preventas de la sucursal que esperan cobro, la más vieja arriba | cualquiera |
| **Caja** | Abrir, corte a ciegas, ingreso, vale, cierre del día | según el permiso de hoy |
| **Marcar** | Entrada, salida y descanso, como el kiosco actual | cada quien |

**No muestra** Personal, Nómina, reportes, ni nada fuera de caja. Ese es el
problema de una sesión personal abierta en una computadora compartida, y aquí
no existe.

### El carné, una vez por acción

- **Finalizar una venta, abrir, cortar, anotar un ingreso o vale, cerrar el
  día y marcar** piden escanear el carné.
- **Se escanea con el mismo lector de los productos.** La pantalla reconoce
  que el código es un carné y no un producto, así que no hay que tocar ningún
  botón antes.
- **El servidor decide.** El carné se valida en la base (como hoy en el
  kiosco), se comprueba el permiso de esa persona en `role_permissions` y se
  guarda la huella. La pantalla nunca ve el código de nadie.
- Después de la acción la pantalla queda otra vez anónima. **Ningún carné
  queda «puesto».**
- **Vender no pide carné.** Armar la venta y elegir el cliente es trabajo de
  mostrador. El carné se pide al finalizar, que es cuando hay dinero y factura.

### Quién vende y quién cobra

Cada venta guarda **dos personas**:

- **Vendió**: quien la armó. En una preventa es quien la mandó (como hoy).
  En una venta armada en el kiosco es quien escanea al finalizar.
- **Cobró**: quien escaneó el carné al finalizar.

El ERP sigue recibiendo `codvende` como hoy, así que sus reportes por
vendedor no cambian.

---

## 3. Finalizar una venta, paso a paso

**En pantalla** (4 toques como mucho):

1. Tocar la preventa en **En caja**, o armarla en **Vender**.
2. Forma de pago. En efectivo se escribe lo recibido y el **cambio** sale
   grande.
3. **Escanear el carné.** Eso es el «Finalizar».
4. Sale el ticket. La pantalla dice «Cobrada · cambio $3.50» y vuelve a la
   cola.

**En el servidor** (función nueva `cobrar-caja`, una sola llamada):

1. **Valida** el equipo (`deviceToken` de su sucursal), el carné (persona
   activa de esa sucursal o con cobertura del día) y el permiso de cobrar.
2. **Reserva el cobro en la base** antes de tocar el ERP: una fila por venta
   con `UNIQUE`. Un doble clic o un segundo kiosco no cobran dos veces.
3. **Relee la preventa en caja** (lista + `cargar_data`): tiene que ser la
   misma referencia, el mismo total y los mismos productos que el portal
   mandó. Si alguien la cambió en el ERP, **no se cobra** y lo dice.
4. **Guarda** (paso 1 del ERP) con la apertura, el turno y la caja que la
   página de esa sucursal tiene abiertos en ese momento. Si la caja está
   cerrada, frena con «Abre la caja primero».
5. **Efectivo y cambio** (paso 2 del ERP).
6. **Hacienda** con `_shared/erp-dte.ts`, con un plazo corto (8 s):
   - **contesta**: el ticket sale con el sello;
   - **no contesta**: la venta ya está guardada y el ticket sale como lo
     imprime el ERP en ese caso (ver pregunta abierta 1). El reenvío
     nocturno lo manda.
7. **Ticket**: pide `print_ticket_dte` al ERP y lo imprime con
   `imprimirDocumento`. El contenido es el del ERP, y el portal solo lo lleva
   a la ticketera.
8. **Huella**: cobró, equipo, hora, forma de pago, recibido, cambio, total y
   factura, en la fila del cobro y en `audit_logs`.

**Si la respuesta del ERP se pierde** a mitad de camino, la fila del cobro
queda «en curso». La próxima lectura busca la factura por `id_factura` (como
ya hace la preventa con su envío) y la da por cobrada o la libera. **Nunca se
reintenta el guardado a ciegas.**

---

## 4. La caja en el kiosco

Son las mismas acciones de Mi caja, con los mismos frenos, por las mismas
funciones (`operar-caja`, `hacer-corte-caja`). Lo único nuevo es otra forma de
identificarse: **equipo + carné** en lugar de sesión.

- **Abrir**: carné y fondo contado. Queda a nombre de quien abrió.
- **Corte a ciegas**: carné y conteo sin ver el esperado. Lo hace quien
  cuenta; la diferencia queda a su nombre y del turno.
- **Ingreso o vale**: carné y motivo.
- **Cierre del día**: carné, con los cuatro frenos de hoy. El cierre
  automático sigue igual.

**Permisos como hoy.** Quien hoy puede cortar o cerrar en Mi caja puede
hacerlo en el kiosco. No se agregan permisos nuevos de caja.

---

## 5. Auditoría: qué se puede saber

| pregunta | de dónde sale |
|---|---|
| ¿Quién cobró esta factura? | la fila del cobro |
| ¿Cuánto efectivo cobró cada persona hoy? | suma de cobros en efectivo por persona |
| ¿Quién abrió, cortó y cerró? | aperturas y cortes, ahora con persona |
| ¿Quién estaba en el turno con faltante? | cobros + marcación del mismo kiosco |
| ¿Algo se cobró distinto de lo armado? | `cobro_distinto`, ya existe |
| ¿Cada cobro del kiosco tiene su factura en el ERP igual? | contraste diario: total, renglones, lote, forma de pago, sello |

El **contraste diario** es lo que sostiene la verdad. Corre de noche y compara
cada cobro del kiosco con su factura sincronizada (`erp_invoice_id`). Una
diferencia sale en rojo y no se resuelve sola. Lo vigila un gate
(`gate:cortes` o uno nuevo).

**El reporte por persona** junta, por día y turno: cobros, efectivo,
anulaciones, cobrados distinto, ventas sin cliente y cortes con diferencia. Un
faltante suelto no acusa a nadie; un patrón repetido se ve.

---

## 6. Seguridad

- **Cada función nueva sin sesión** entra a `superficie-anon.json` con guarda
  «equipo + carné» y su motivo. Sin las dos cosas, no hace nada.
- **El carné se escanea, no se escribe.** Hoy el código del carné es también
  la contraseña del portal de esa persona (`src/data/kiosco.js`). Una foto del
  carné basta para cobrar a su nombre en un kiosco autorizado. **Antes de la
  fase 3** hay que separar el código del carné de la contraseña: el carné
  lleva un identificador propio y revocable.
  **Pospuesto por el usuario (2026-11-17):** «por ahora no lo apliquemos».
  La fase 3 sigue sin él: el riesgo queda aceptado y lo cubre el reporte por
  persona.
- **Un equipo, una sucursal.** El kiosco solo cobra y opera la caja de su
  sucursal. Un equipo perdido se da de baja y queda inservible.
- **Freno de intentos** en el carné, como ya tiene el kiosco.
- **Los datos del cliente** que muestra son los mismos que hoy ve cualquiera
  en la caja del ERP.

---

## 7. Lo que NO cambia

- El ERP numera, emite, descuenta inventario y hace el Z.
- Los precios y las listas son las del ERP, y se relee el precio al mandar.
- Bolsas, entregas y depósitos.
- Las tabletas de marcación.
- **Anular una venta cobrada** sigue en el ERP, con sus permisos. Tiene sello
  de Hacienda: se anula o se hace nota de crédito, y eso es otra fase.
- Devoluciones, ventas perdidas y consultas del ERP.

---

## 8. Fases

Cada fase tiene una **condición de salida** medida. No se pasa a la siguiente
sin cumplirla. Todo empieza en **Salud 4**.

| fase | qué | sale cuando |
|---|---|---|
| **0 · Medir** (ya) | tiempo envío→cobro, cobrados distinto, preventas descartadas | hay 2 semanas de números |
| **1 · Kiosco visible** | alta del equipo tipo caja, pantalla anónima, Marcar y En caja (solo ver) | una semana marcando sin fallas y la cola igual a la lista de caja |
| **2 · Caja en el kiosco** | abrir, corte a ciegas, ingreso, vale, cierre con carné | una semana de cortes iguales a los de Mi caja |
| **3 · Cobrar** | factura en efectivo, solo preventas del portal | 2 semanas con 0 diferencias en el contraste y ≤5 s por cobro |
| **4 · Completo** | crédito fiscal, tarjeta, puntos, crédito; armar y cobrar en el kiosco | 2 semanas con 0 diferencias |
| **5 · Las demás** | una sucursal por semana | la anterior sin diferencias |

El ERP queda como respaldo en todas las fases. Se usa menos solo cuando la
sucursal lo decide.

---

## 9. Riesgos y cómo se cubren

| riesgo | qué pasa | cobertura |
|---|---|---|
| El ERP cambia su página de caja | el guardado lleva otros campos | antes de guardar se comprueba que estén `id_apertura`, `turno`, `caja` y los totales; si falta uno, frena con «Cobra esta en caja» |
| Se cae el internet | el kiosco no llega al servidor | no cobra y lo dice; la sucursal cobra en el ERP |
| Hacienda no contesta | no hay sello | la venta ya está guardada; ticket según la pregunta 1; reenvío nocturno |
| Doble clic o dos kioscos | doble cobro | fila única por venta, reservada antes del ERP |
| Respuesta perdida | no se sabe si se guardó | se busca la factura por `id_factura`; nunca se reintenta a ciegas |
| Alguien edita la preventa en el ERP | se cobraría otra cosa | se relee y se compara antes de guardar |
| Caja cerrada | el ERP no tiene apertura | frena con «Abre la caja primero» |
| Carné prestado o fotografiado | cobra a nombre de otro | carné con identificador propio (fase 3) y reporte por persona |

---

## 10. Preguntas abiertas

1. **Ticket sin sello.** Cuando Hacienda no contesta, ¿qué imprime hoy la
   caja del ERP? Se revisa en la fase 3 con una venta real, y el kiosco hace
   lo mismo que el ERP.
2. **Carné olvidado.** Propuesta: el jefe de sucursal finaliza con el suyo y
   queda a su nombre. No se cobra sin carné.
3. ~~**Cupo de kioscos.**~~ **Decidido por el usuario (2026-11-17):** 1
   kiosco de caja por sucursal, aparte; los de marcación siguen hasta 3
   (`LIMITE_KIOSCOS`).
4. **Tarjeta.** El número de boleta de la terminal (fase 4): leerlo como lo
   pide hoy la caja, junto con `caja_terminales_pos`.

---

## 11. Al construir

- Pantalla y ruta nuevas en español en `App.jsx` y `moduleMap.js`; el área en
  `auditoria/areas.mjs`.
- `cobrar-caja` en `scripts/alcance-manifest.json` (guarda `alcance`, por el
  equipo).
- Las funciones sin sesión en `auditoria/superficie-anon.json`.
- Sin pantalla nativa en la app: el kiosco es un equipo fijo. Va a
  `EXCEPCIONES` de `scripts/app-nativa-gate.mjs` con ese motivo.
- Novedades: se le pregunta al usuario en la fase 1.
- Al cerrar cada fase: `gate:cortes`, `gate:alcance`, `gate:seguridad` y
  `gate:auditoria` completos.
