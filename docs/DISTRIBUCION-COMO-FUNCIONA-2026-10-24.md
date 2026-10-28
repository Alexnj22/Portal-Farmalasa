# Distribución (Torogoz) — cómo funciona (2026-10-24)

Documento del área `distribucion` de la auditoría. Sale de leer el código y las
33 migraciones `distribucion_00NN_*` de `supabase/migrations/`, no de la
memoria de quien lo construyó. El plan de pase a producción
(`docs/planes-cerrados/PLAN-TOROGOZ-A-PRODUCCION-2026-10-01.md`) dice QUÉ faltaba hacer; éste
dice CÓMO funciona lo que ya está.

Lo cita el encabezado de `src/data/distribucion.js`, que es la puerta de
entrada del área.

## 1. Qué es y qué NO es

Torogoz es la **S.A.S. de distribución**: otra empresa, con otro NIT, que vende
en ruta a tiendas, supermercados y farmacias. Vive dentro del portal pero no
comparte nada fiscal con las siete salas:

| | las farmacias | la distribuidora |
|---|---|---|
| quién emite el DTE | el sistema de la caja | **el portal** (`distribucion-dte`) |
| NIT, certificado, credenciales | los de la farmacia | los suyos (`dist_emisores` + secretos) |
| inventario | el de cada sala y Bodega | **propio, por lote** (`dist_lotes`) |
| área de auditoría | `facturacion` | `distribucion` |

Por eso el prefijo es `dist_` y no `ruta_*`: «ruta» ya es el reparto de Bodega
a las salas (`rutas`, `ruta_pedidos`). Y por eso es un área aparte: mezclarlas
haría que tocar el emisor nuevo descongele la facturación de las salas.

Entrada propia: `/torogoz` (con su login, `TorogozLoginView`, y su marco,
`TorogozLayout`). `/distribucion` sólo redirige.

## 2. El emisor

`dist_emisores` es la empresa que firma: nombre, NIT (9 o 14 dígitos), NRC,
actividad, dirección por departamento/municipio/distrito, establecimiento
(`B001`) y punto de venta (`P001`) para el número de control, y los códigos que
asigna Hacienda al registrar el establecimiento.

Dos columnas mandan más que las demás:

- **`ambiente`** — `'00'` pruebas de Hacienda, `'01'` producción. Arranca en
  `'00'` y cambiarlo es una decisión, no un detalle: decide a qué host se
  transmite (`apitest.dtes.mh.gob.sv` contra `api.dtes.mh.gob.sv`).
- **`gran_contribuyente`** — si Hacienda califica a la empresa, ella PERCIBE el
  1% (Art. 163). El del cliente es otra cosa: un cliente gran contribuyente le
  RETIENE el 1% a la empresa (Art. 162).

Las credenciales de Hacienda **no viven en la tabla**: son secretos de la edge
function (sección 6). La tabla lo dice en su propio `COMMENT`.

Varias funciones toman el emisor con `ORDER BY id LIMIT 1`. Es correcto con
uno, que es el caso; con dos habría que pasarlo por parámetro.

## 3. Clientes

`dist_clientes` es la ficha del cliente de ruta. Lo que la base exige al
GUARDAR, para no descubrirlo al facturar:

- **Contribuyente = tiene NRC.** `contribuyente` es una columna GENERADA
  (`nrc IS NOT NULL`), no una casilla: no se puede marcar a mano. Con NRC se le
  emite Crédito Fiscal; sin él, Factura.
- **Un contribuyente trae la ficha completa** (`dist_clientes_ccf_completo`):
  NIT como documento, actividad económica y dirección con los cuatro campos.
  Sin eso no se guarda, porque un CCF sin esos datos lo rechaza Hacienda.
- **Un documento por cliente** (`dist_clientes_documento_unico`, por emisor,
  tipo y número). La pantalla traduce el choque a «Ya hay un cliente con ese
  documento».
- **Autorización de la SRS** (`licencia_srs`, `licencia_srs_vence`). Sin ella
  vigente no se le vende medicamento (RTS 11.02.04:24 §5.9.2; Ley de
  Medicamentos art. 57 b). La frena el trigger del pedido, no la pantalla.
- **Crédito**: `limite_credito` y `plazo_dias` (0 a 120). Con cualquiera de los
  dos en cero, el cliente es de contado.
- **Tipo** (`tienda`, `supermercado`, `farmacia`, `otro`): a tienda y
  supermercado sólo se les vende lo de venta libre (sección 4).

`creado_por` lo pone la base con `auth_employee_id()`: la pantalla conoce la
CUENTA y para la mayoría del personal no es el mismo id que la ficha.

**Bitácora (2026-10-24).** `guardarCliente` anota su propia entrada
—`DISTRIBUCION_CLIENTE_ALTA` o `DISTRIBUCION_CLIENTE_EDITAR`— con el patrón de
`src/data/audit.js`: la anota la función que guarda, así la pantalla y la app
del teléfono la heredan; sólo se anota lo que entró; y nunca lanza. El detalle
lleva el nombre y si fue alta o edición, **nunca el NIT, el DUI ni el NRC**:
la bitácora la leen más personas que la ficha. Lo prueba
`tests/unit/distribucionClienteBitacora.test.js`.

## 4. La venta

### 4.1 El pedido y quién decide el precio

`dist_pedidos` + `dist_pedido_items`. El navegador sólo dice qué producto y
cuántos; todo lo que decide algo lo decide la base:

- **El precio sale del catálogo** (`dist_catalogo`, luego listas de precios en
  0004 y precios con IVA en 0007). El trigger `dist_validar_item` lo copia; lo
  que mande la pantalla se ignora.
- **Qué se le puede vender a quién** lo decide ese mismo trigger: fuera de
  catálogo no; a tienda o supermercado, nada que no sea de venta libre, ni
  antibiótico, regulado o con receta.
- **El cliente** lo valida `dist_validar_pedido`: activo, del mismo emisor, con
  licencia SRS vigente, CCF sólo con NRC, crédito sólo si lo tiene aprobado y
  sin pasar su plazo.
- **Idempotencia**: el teléfono genera `client_uuid` antes de mandar. Si la
  señal se corta y reintenta, el pedido no se duplica.

Los errores de los triggers llegan con un código (`DIST_SIN_LICENCIA`,
`DIST_NO_VENTA_LIBRE`, …) y `mensajeDeDistribucion` los traduce a lenguaje de
la pantalla. Un código nuevo sin traducción muestra la parte del mensaje que
va después de los dos puntos, no el código.

### 4.2 Descuentos que se piden (0008, 0029)

Quien tiene `distribucion_descuentos` da hasta el tope de la empresa sin pedir
permiso; quien tiene `distribucion_config` da cualquiera. Todo lo demás NO se
aplica: el renglón queda con el descuento PEDIDO y en cero, y la venta queda
como preventa hasta que alguien con `requests_distribucion` lo resuelva. Quien
pide no puede aprobárselo (`DIST_AUTOAPROBAR`). La edge function se niega a
facturar con un descuento pendiente.

### 4.3 Reservas (0012)

Lo que está en una venta abierta o en una preventa se APARTA por lote, para que
dos vendedores no vendan la misma caja. `dist_reservar` recibe el carrito
entero y devuelve, renglón por renglón, cuánto se pudo apartar y quién tiene el
resto. El reloj es de **30 minutos desde el primer producto** y no se reinicia;
al vencer, el cron `dist-vencer-reservas` (cada minuto) las suelta y le avisa
al vendedor con el enlace para retomarla.

### 4.4 Inventario por lote (0006, 0030)

Existencia en UNIDADES por producto, lote y vencimiento. Sólo cambia por
funciones, cada cambio con su movimiento (`dist_lote_movimientos`, historial
append-only). El lote se asigna **al facturar**, no al tomar el pedido: primero
vence, primero sale; una presentación no se parte entre lotes; si no alcanza,
no factura y dice cuánto falta.

El camión es una UBICACIÓN del lote (`en_camion_de`): cargar mueve unidades del
lote de bodega al mismo lote en el camión. La carga circula amparada por una
**Nota de Remisión** electrónica (Código Tributario art. 109).

### 4.5 Sin señal

La venta hecha sin señal se guarda en el teléfono (`distribucionSinSenal.js`)
con su hora y su código de generación. Al volver la señal se manda con
`contingencia` y el documento se arma en modelo DIFERIDO con esa hora.

### 4.6 Después de la venta

- **Cuentas por cobrar** (0014): el crédito nace del documento —la parte con
  forma de pago 13 de lo que recibió Hacienda—. `dist_cobrar` bloquea la
  cuenta y valida contra el saldo; un CHECK impide el saldo negativo; el recibo
  se ANULA con motivo, no se borra. Cada mañana, `dist-aviso-cartera-atrasada`
  avisa a cada vendedor sus atrasados (0023), y a nadie «cero atrasados».
- **Devoluciones** (0017): Nota de Crédito sólo sobre un Crédito Fiscal
  sellado; a una Factura se la corrige anulando y emitiendo otra.
- **Liquidación y caja** (0020, 0024): el esperado es fondo + ventas y cobros
  en efectivo + ingresos − gastos − entregas parciales. El cierre guarda una
  FOTO; si después entra otra venta de ese día, lo dice.

## 5. La emisión

### 5.1 Por qué la arma el servidor

El navegador sólo pide «factura este pedido» (`facturarPedido` →
`distribucion-dte`, acción `facturar`). El tipo de documento, los precios, el
correlativo (`dist_siguiente_correlativo`, atómico), la firma y el sello salen
del servidor con la llave de servicio. Un DTE armado en el navegador sería un
documento fiscal que el cliente puede editar antes de firmar.

### 5.2 El motor

`supabase/functions/_shared/dte/` es el motor DTE 2.0, sin dependencias de
otro sistema:

| archivo | qué hace |
|---|---|
| `documentos.ts` | arma Factura (01), Crédito Fiscal (03), Nota de Remisión (04) y Nota de Crédito (05) |
| `calculos.ts`, `decimal.ts`, `letras.ts` | montos con decimales exactos y el total en letras |
| `catalogos.ts` | los catálogos de Hacienda (tipos, ambientes, contingencia) |
| `firma.ts` | la misma firma que el firmador oficial (JWS RS512), con WebCrypto, sin Java |
| `hacienda.ts` | autenticación, recepción, consulta, contingencia e invalidación |
| `eventos.ts` | los eventos de invalidación y de contingencia |
| `lotes.ts` | parte un renglón por lote para que el documento diga lote y vencimiento |

Lo prueban `tests/unit/dteMotor.test.js`, `dteHacienda.test.js` y
`dteLotes.test.js`, contra los esquemas oficiales y contra DTE reales sellados
(`tests/fixtures/dte-reales-2026-09.json`).

### 5.3 Los estados del documento

`dist_dte.estado`: `sin_firmar` → `firmado` → `sellado`, o `rechazado`,
`contingencia`, `invalidado`, `descartado`. **Nada se da por emitido si
Hacienda no lo selló**: sin certificado queda «sin firmar»; sin credenciales,
«firmado» y pendiente de enviar. Las dos cosas se ven en pantalla
(`EstadoHacienda.jsx`) y se reintentan (`transmitir`). Cada intento queda en
`dist_dte_intentos`.

### 5.4 Envío a Hacienda

- El token se pide **una vez al día** y se guarda en `dist_mh_token`: pedir uno
  por documento es la forma de que Hacienda empiece a rechazar por abuso.
- La transmisión tiene que estar a **±30 minutos** de la emisión. Un documento
  sin sello de más de 25 minutos ya no va por la vía normal: pasa a
  contingencia.
- Si la recepción no contesta: se CONSULTA primero y sólo se reenvía si
  Hacienda no lo tiene. Reenviar a ciegas uno que sí entró da un duplicado
  rechazado.
- `enviar_contingencia` arma el evento por tipo, lo firma, lo reporta y, con el
  evento recibido, transmite cada documento que cubre.

### 5.5 Invalidar se PIDE (auditoría H3, 2026-10-22)

Quien vende no invalida un documento sellado: `anular_venta` y
`corregir_sellado` crean una solicitud que decide quien tenga
`requests_distribucion`. El responsable ante Hacienda es QUIEN APRUEBA (su
nombre y DUI van en el evento).

## 6. Credenciales

Cuatro secretos de la edge function, por proyecto (pruebas y producción tienen
los suyos), nunca en el repositorio ni en el chat:

- `DIST_MH_USUARIO` y `DIST_MH_CLAVE_API` — la entrada a la API.
- `DIST_MH_CERT` y `DIST_MH_CERT_CLAVE` — el certificado y su contraseña
  privada. Quien tiene el `.crt` puede firmar a nombre de la empresa.

`distribucion-dte`, `distribucion-comprobante` y `distribucion-correo` van
**con JWT**: las llama el navegador, ningún cron.

## 7. Lo que falta: el primer DTE real

Todo el circuito está construido y probado contra esquemas y documentos reales
de otro emisor, pero **todavía no se transmitió el primer DTE real con
credenciales reales de la S.A.S.**:

1. Cargar el emisor real (pestaña Empresa) con `ambiente = '00'`.
2. Poner los cuatro secretos con `supabase secrets set`.
3. Transmitir en pruebas de Hacienda y confirmar las rutas de lote, consulta,
   contingencia y anulación: `hacienda.ts` las tomó de la guía con el host
   nuevo y se confirman con la primera llamada.
4. Pasar el plan de pruebas de Hacienda y recién ahí `ambiente = '01'`.

Hasta entonces, cualquier venta queda «sin firmar» o «firmada sin enviar», a la
vista y sin darse por emitida.

Y dos cosas que no son del DTE pero también faltan (venían del plan de pase a
producción, hoy en `docs/planes-cerrados/PLAN-TOROGOZ-A-PRODUCCION-2026-10-01.md`):

- **GPS en Rutas.** `vercel.json` manda `Permissions-Policy: geolocation=()`, que
  apaga la ubicación en todo el sitio: las visitas se guardan sin coordenadas y
  sin error. Hay que cambiarlo a `geolocation=(self)`.
- **Correo al cliente:** una `RESEND_API_KEY` nueva (la anterior quedó expuesta) y
  `CORREO_REMITENTE`. `CORREO_MODO` no se pone en producción.

## 8. Dónde mirar

- Datos: `src/data/distribucion.js` (+ `distribucionInventario`,
  `distribucionCompras`, `distribucionPaquete`, `distribucionSinSenal`,
  `distribucionRastreo`).
- Lógica pura: `src/utils/distribucion*.js`, cada una con su prueba.
- Pantallas: `src/views/DistribucionView.jsx`, `DistribucionVentaView.jsx` y
  `src/views/distribucion/`.
- Entorno de pruebas: `scripts/entorno-pruebas/distribucion.mjs` y
  `probar_distribucion.mjs`.
