# App de clientes «Puntos Salud»

> Un solo documento desde el 2026-10-28: junta lo que estaba en tres
> (`APP-CLIENTES-2026-10-05`, `-CUENTA-DE-REVISION-2026-10-17` y
> `-PRIVACIDAD-APP-STORE-2026-10-17`). Escrito el 2026-10-05, revisado el 2026-10-24.

La app pública del cliente. Es distinta de la app del personal (`apps/mobile`):
otro identificador (`lat.farmasalud.clientes`), otra ficha en la tienda y otra
puerta al servidor. Decisión del usuario: la de clientes se **publica** y la del
personal va por distribución no listada.

## Qué hace

| Pestaña | Qué muestra | De dónde sale |
|---|---|---|
| Puntos | saldo en dólares y en puntos, avance al primer canje, por vencer, movimientos | `puntos_estado_cuenta` (lo mismo que `/mis-puntos`) |
| Ofertas | lo publicado y vigente hoy; las exclusivas, sólo el título para quien no es socio | `ofertas_clientes` |
| Inyecciones | aplicaciones pagadas y sin aplicar; las aplicadas del último año | `app_cliente_inyecciones(customer_id)` |
| Cuenta | permisos del programa y promociones, avisos al teléfono, reglamento, cerrar sesión, **borrar cuenta** | `app-clientes` |

## La sesión

Entra con **documento + teléfono** (o el código de 7 letras del ticket), igual
que `/mis-puntos`, pero una sola vez: `app-clientes` devuelve un token de 32
bytes que vive en el llavero del teléfono. En la base sólo queda su huella
(`app_cliente_sesiones.token_hash`). Caduca a los 180 días sin uso.

**El `customer_id` sale siempre de la sesión, nunca del cuerpo.** El freno por
IP es el mismo contador que `/mis-puntos` (`puntos_consulta_registrar`).

## El pre-registro

Quien no tiene ficha se une desde la app. **No se crea la ficha**: nace en el
sistema de la caja, y un alta desde un teléfono abriría la puerta a duplicados y
datos inventados. Queda en `app_cliente_preregistros` y la persona ya entra (ve
ofertas; puntos e inyecciones dicen «en tu próxima compra»).

Se vincula **solo**: cada consulta de la app vuelve a buscar la ficha con el
mismo documento y teléfono. Los que no coinciden aparecen en el portal,
`/ofertas-clientes` → «Pre-registros», donde la sala vincula (por documento,
nunca por nombre; la base lo verifica) o descarta.

## Borrar la cuenta

Apple lo exige dentro de la app (5.1.1(v)). Revoca todas las sesiones y los
avisos y borra el pre-registro. **La ficha no se borra**: es registro fiscal.
Opcionalmente retira los dos permisos en el mismo gesto.

## Lo que faltaba el 2026-10-05 (revisado el 2026-10-24)

1. **Enviar avisos** — hecho: `avisos-clientes` (ver «Avisos al teléfono» abajo).
2. **Inyecciones TRAÍDAS**: guardan sólo el nombre escrito, sin ficha. No
   aparecen en la app y no se adivinan por nombre. (No se volvió a revisar.)
3. **Pagos en línea** — hecho para reservas y créditos: `wompi-pagos` (abajo).
4. **Ficha en la tienda**: política de privacidad pública, capturas, cuenta
   de prueba para la revisión de Apple. (No se volvió a revisar.)

---

# Lo que hace hoy (2026-10-24)

Esta segunda parte se escribió leyendo el código del área `app-clientes`
(`auditoria/areas.mjs`): la app (`apps/clientes/`), las funciones
`app-clientes`, `avisos-clientes`, `wallet-pases`, `wompi-pagos` y
`preventa-caja`, y la capa del portal que la atiende (`src/data/reservas.js`,
`ofertasClientes.js`, `chatClientes.js`, `chatHilo.js`, `horarios.js`,
`mayoristas.js`; `src/utils/apartar.js`, `preventa.js`, `reservasDeSala.js`,
`horarioDelChat.js`, `chatBorradores.js`). Si discrepa del código, manda el
código.

## Las piezas

| pieza | quién la llama | qué hace |
|---|---|---|
| `app-clientes` | la app, con el token de la sesión | todo lo que el cliente ve y pide: puntos, ofertas, reservas, chat, cuenta |
| `avisos-clientes` | crons `avisos-clientes-minuto` y `avisos-clientes-diario` | los avisos al teléfono, de 8:00 a 20:00 de El Salvador |
| `wallet-pases` | el iPhone (rutas de PassKit) y un cron cada minuto | la tarjeta de Puntos Salud en Apple Wallet se actualiza sola |
| `wompi-pagos` | Wompi (aviso) y el navegador del cliente (vuelta) | confirma un cobro en línea contra la API de Wompi, nunca contra lo que dice la petición |
| `preventa-caja` | el portal, con la sesión de quien envía | deja la venta de una reserva armada en la caja |

En `wompi-pagos`, una misma transacción no puede pagar dos reservas
(`app_reservas_pagos.id_transaccion` es UNIQUE). En `wallet-pases`, el token de
cada tarjeta se DERIVA del serial con HMAC: no se guarda y no se puede adivinar
el de otra persona.

## Niveles y ofertas exclusivas

El nivel del programa —Bronce (clave `vip`), Plata, Oro o Platino— sale de lo
comprado en los últimos 12 meses en todas las facturas válidas
(`puntos_compra_12m` + `puntos_niveles`). La app sólo lo LEE
(`supabase/functions/_shared/nivel.ts`). Desde el 2026-10-19 lo que un nivel
promete (umbral, factor, cumpleaños, horas para retirar, días de anticipo para
ver ofertas, premios del raspable) se cambia desde el portal (Puntos →
Niveles) por `puntos_nivel_guardar`, con historial; la app arma los beneficios
desde esa tabla, así no puede prometer algo que el programa no da.

Una oferta puede exigir un nivel (`ofertas_clientes.nivel_minimo`: todos,
plata, oro, platino o sólo mayoristas — `NIVELES_DE_OFERTA`). **Todos la VEN**
(es una invitación); sólo quien llega al nivel la puede reservar, y eso lo
decide `app-clientes`, no la pantalla.

## Reservas

Reglas que el cliente acepta antes de reservar (`TERMINOS_RESERVA` en
`app-clientes`; cambiar el texto vuelve a pedir la aceptación):

- Se reserva cualquier producto, en oferta o a precio normal.
- La sucursal tiene **24 h para preparar**; avisada «lista», se retira en los
  3 días siguientes. Si no hay en la sala, se trae de otra o de Bodega, y
  **mientras viene en camino el plazo de preparación se detiene**.
- Hasta **3 reservas sin pagar** a la vez; las pagadas en línea no tienen tope.
  3 reservas sin retirar en 30 días bloquean reservar por 30 días.
- **Bajo receta**: 24 h para subir la foto y 24 h para que la sala la revise.
  La sala decide con `reserva_receta_decidir` (aprobada / otra foto /
  rechazada; el motivo es obligatorio salvo al aprobar). Con **4 h** sin
  revisar se avisa a supervisión (cron `recetas-escalar-15min`).
- Una sola prórroga de 7 días (`reserva_prorrogar`).
- Lo pagado y no retirado queda como **saldo a favor por 60 días**
  (`saldo_favor_dias()`), usable en cualquier sucursal; devolverlo en dinero
  sólo lo autoriza administración (`reserva_saldo_devolver`).

Desde la sala (portal y app del personal) **nada se escribe directo**: todo
pasa por funciones de la base con su guarda (`reserva_puede_manejar`). Los
plazos no están escritos en el navegador: cada fila de `reservas_de_sucursal`
trae `plazo_hasta` y `horas_al_preparar` (`reserva_plazos()`).

Lo que el navegador sí calcula (probado en `tests/unit/reservasDatos.test.js`):

- los **mensajes de WhatsApp** para quien no tiene la app (reserva lista,
  encargo conseguido o llegado, enlace de pago): saludan por el primer nombre,
  llevan el código `R-000123`/`E-000123` y el DÍA hasta el que se retira;
- el número (`whatsappDe`): 8 dígitos llevan el 503; otro largo no es un
  número válido y no se manda;
- el **reparto del dinero** al ajustar una reserva (`repartoDelAjuste`): lo
  pagado cubre primero lo que se queda, después la alternativa, y el resto
  queda a favor. Es la misma cuenta que hace `reserva_ajustar`; la que vale es
  la de la base;
- qué reserva espera algo de la sala (`reservaPorResolver`, `reservaPorTraer`,
  `faltaDeReserva`) y qué devoluciones están autorizadas y sin entregar.

### Apartar y encargar en el mostrador

`src/utils/apartar.js` es la regla del formulario, una sola vez para el portal
(`DialogoApartar`) y la app del personal. Cuatro modos: `reserva` (hay en la
sala: se aparta 7 días con el precio de hoy), `viene` (se aparta sobre un
traslado que ya viene), `traslado` (otra sala lo tiene) y `encargo` (no hay en
ninguna parte: se encarga sin cobrar, de 1 a 20 unidades por producto). Quien
decide es la base (`apartado_cotizar`, `apartado_aplicar`, `encargo_*`).

### La preventa

«Enviar a caja» deja la venta de la reserva armada en la caja: producto,
cliente y vendedor. La **base** decide si se puede (`preventa_preparar`), el
**núcleo** la arma (`armarVenta`, `src/utils/preventa.js`) y un **adaptador**
la traduce a la caja de hoy (`_shared/preventaCaja.ts`). Cuando la venta se
factura, el cron `preventas-cerrar-facturadas` cierra la reserva.
`enviarPreventa` **nunca lanza**: devuelve `{ ok: false, error }` con el
motivo que viene en el cuerpo de la respuesta.

## Chat con la farmacia

Un cliente tiene UNA conversación; contesta cualquiera con `chat_clientes`.
Lo que escribe el equipo va por funciones (`chat_responder`, `chat_tomar`,
`chat_resolver`, `chat_etiquetar`), y la base avisa al teléfono.

- **Archivos**: bucket privado `app-clientes-archivos`. El equipo sube sólo a
  `chat/<cliente>/equipo/` (lo único que la policy le deja); la nota de voz va
  como `audio/mp4` porque es lo que reproduce el iPhone. Las firmas se guardan
  y se reutilizan mientras les queden más de 10 minutos: una firma nueva por
  vuelta hacía bajar de nuevo cada foto y la bandeja parpadeaba.
- **Mensajes**: de a 50; el refresco en vivo pide sólo lo nuevo (`despuesDe`)
  y lo editado o borrado por el cliente (`fetchMensajesCambiados`).
- **Reacciones**: `mensaje_id` se repite, así que acotar la entrada no acota
  la salida (CLAUDE.md, Patrón A): van en tandas de 100 mensajes con tope de
  900 filas, y una tanda que llega al tope lo avisa en la consola.
- **El hilo en memoria** (`src/data/chatHilo.js`): se pinta en el primer cuadro
  con lo que había y la lectura fresca lo pone al día; se PRECARGA al pasar el
  ratón por la bandeja. `precargarHilo` sólo lee —no toma la conversación ni
  la marca leída—, nunca lanza y nunca pide dos veces a la vez. Por eso no se
  anota en la bitácora: está declarada en `SIN_BITACORA` de
  `scripts/auditoria-barrido.mjs` (el `.delete(` que veía el detector es el
  del `Map` de precargas, no un DELETE de la base). El envío optimista se
  reconcilia con `fusionar`: el mensaje real retira el globo temporal del
  mismo autor y texto; uno **fallido** no lo retira nadie, para que se vea.
- **Lo escrito sin enviar** sobrevive a cerrar el panel (`chatBorradores.js`),
  en memoria: una foto es un `File` o un `uri`, que no caben en `localStorage`.
- **«Está escribiendo…»** vale 6 s desde la última tecla; quien escribe la
  renueva cada 3 s (`escrituraDelChat.js`).
- **Mensajes automáticos**: la base decide si la farmacia está abierta
  (`farmacia_estado()`) con el horario de cada sala (`horario_de_sala()`:
  horario especial del día > si es feriado, el de domingo > el semanal) y
  elige entre los dos mensajes de `app_chat_ajustes`. `{cierra}` y `{abre}` se
  vuelven «10:00 p. m.» y «mañana a las 7:00 a. m.»; en la vista previa, un
  marcador sin dato se pinta como faltante en vez de inventar una hora.
- **Esperas**: el cron `chat-vigilar-espera-1min` avisa a los 15 min a la sala
  del asignado; a los 20 min lo registra (`app_chat_incumplimientos`) y avisa
  a supervisión.

Guardar los mensajes automáticos o un horario especial sin permiso no lanza en
la base —devuelve cero filas—; la capa de datos lo convierte en un error
explícito. Un horario especial de un día que ya tenía uno se **actualiza**,
nunca se borra y recrea: si el insert fallara, el día se quedaría sin horario.

## Clientes mayoristas

Todo por funciones con guarda del módulo `mayoristas`: ver, proponer y
resolver (aprobar, rechazar, descartar a un candidato, cambiar precio,
retirar, cancelar un cambio). Bajar a Mayoreo y retirar rigen a los 15 días
(Condiciones §6). Rangos por compra: Jade (desde $0), Zafiro ($300), Rubí
($800) y Diamante ($2,000). El listado sale de `mayoristas_resumen_mensual`,
que se rehace cada noche: leer las ventas en vivo eran 625 MB por consulta.

## La vitrina: ofertas, historias y banners

Se escriben directo; el RLS exige `ofertas_clientes`. Cada guardado manda sólo
los campos de su lista (`CAMPOS`, `CAMPOS_HISTORIA`, `CAMPOS_BANNER`) y queda
en la bitácora. Las imágenes van al bucket privado `ofertas-clientes`: la app
las recibe firmadas desde `app-clientes` y el portal las firma en una sola
llamada para la vista previa; si la firma falla, la lista llega igual.

Los pre-registros se buscan por documento **en la base**, no en la lista
cargada (H9, 2026-10-22: un tope antes del filtro escondía justo el que se
buscaba). Las fichas se buscan por documento —DUI, NIT o pasaporte—, nunca por
nombre, y el documento se limpia a letras y números antes de entrar al filtro.

## Avisos al teléfono

`avisos-clientes`, de 8:00 a 20:00. Cada minuto, lo inmediato: puntos ganados,
oferta nueva (sólo a quien aceptó promociones: es publicidad), mayoreo
aprobado o cambiado, y los de receta, chat y reservas que la base deja escritos
para enviar. A las 9:00, los recordatorios: puntos que vencen en 15 días,
inyección pagada hace 3 días sin aplicar, saldo a favor que vence en 7 días y
el día que vence, y crédito vencido (cada 7 días como máximo, sin montos porque
se lee en la pantalla bloqueada).

## Pruebas

Nuevas el 2026-10-24: `reservasDatos`, `chatHilo`, `chatClientesDatos`,
`horarioDelChat` y `ofertasHorariosMayoristasDatos` (en `tests/unit/`). Ya
existían `apartar`, `preventa`, `chatPersonal`, `mayoristasYChat`,
`historiasBannersReservas`, `reservasSaldoYPrueba` y `reservaVistaNucleo`.

---

## Las tiendas: la cuenta del revisor (2026-10-17)

Apple (y Google) necesitan entrar a la app para revisarla. La única cuenta con
datos de muestra era la ficha real del dueño, que no se le puede dar a nadie.

**Las credenciales NO están acá: el repositorio es público.** Viven en las
notas de revisión de App Store Connect / Play Console y las tiene el dueño.
Quien las necesite las lee de ahí.

### Qué se creó en producción

| tabla | qué | cómo encontrarlo |
|---|---|---|
| `customers` | la ficha «CLIENTE DEMO» (id 3201016; se llamó «CLIENTE DE REVISION» unas horas, pero la tarjeta muestra las dos primeras palabras) | `notes` dice que no es una persona |
| `puntos_codigo_acceso` | su código de 7 caracteres | `customer_id = 3201016` |
| `app_cliente_muestras` | 19 muestras copiadas de la cuenta de prueba (ofertas, inyecciones, vencimientos, facturas, historias) | `customer_id = 3201016` |

### Desde el 2026-10-19: el revisor entra con DUI y teléfono, NO con el código

Entrar con el código de 7 letras abre ahora una sesión LIMITADA (puntos,
saldo, tarjeta, nivel y ofertas; ver `CON_CODIGO` en `app-clientes`). Si las
notas de revisión dan el código, el revisor no ve facturas, reservas ni chat,
y «Borrar mi cuenta» le pide entrar con DUI y teléfono — motivo de rechazo
(5.1.1(v) exige poder borrar la cuenta). La ficha 3201016 tiene DUI y
teléfono: **las notas de App Store Connect y Play Console tienen que dar esos
dos**, y como mucho mencionar el código como segunda forma de entrar.

### Las facturas de muestra abren un documento de EJEMPLO (2026-10-19)

Sus cuatro facturas de muestra se copiaron de la cuenta de prueba y su
`documento_de` apunta a facturas de OTRA ficha: el control de pertenencia —que
no se abrió— no las dejaba abrir. Ahora una muestra cuya factura prestada no
es de la ficha sirve `sales-dte/muestras/FACTURA-DE-EJEMPLO.pdf` y `.json`
(datos ficticios, marcados «EJEMPLO», sin validez fiscal): en Mis facturas, al
descargar y al enviarlas por correo. `DOC_EJEMPLO` en `app-clientes`.

### Por qué no sale de la base

- **No va al sistema de la caja**: la cola hacia allá es `customers_changelog`,
  que sólo llenan las ediciones del portal. Un alta directa no la toca.
- **No entra a la corrida nocturna de fichas** (`fichas_para_corregir_dte`): no
  tiene facturas (no puede tener rechazos de Hacienda) y tiene domicilio
  completo y categoría Consumidor (no es «sin distrito»).
- **Sin puntos**: dar puntos se hace sólo con `puntos_ajustar`, desde el portal
  y con permiso; hacerlo por SQL dejaría un movimiento sin firma. Si se quiere
  un saldo para mostrar, que lo dé una persona con ese permiso, motivo
  «Cuenta de revisión de las tiendas».
- **Sin el panel «Modo de prueba»**: tiene muestras pero no la fila
  `modo_prueba` (ver `esDePrueba` en `app-clientes`). Apple lee ese panel como
  una función de depuración.

### Borrarla

```sql
DELETE FROM app_cliente_muestras  WHERE customer_id = 3201016;
DELETE FROM puntos_codigo_acceso  WHERE customer_id = 3201016;
DELETE FROM app_cliente_sesiones  WHERE customer_id = 3201016;
DELETE FROM customers             WHERE id = 3201016 AND name = 'CLIENTE DEMO';
```

Antes de borrar, mirar que no tenga nada más colgado (reservas, chat, avisos):
la revisión puede haber reservado o escrito algo.

---

## Las tiendas: respuestas de privacidad (2026-10-17)

Lo que se carga **a mano** en App Store Connect («App Privacy») y en Google Play
Console («Seguridad de los datos»). No hay API pública para ninguno de los dos.

Es coherente con:

- el aviso de privacidad versión 2 (`docs/legal/aviso-de-privacidad.html` →
  `public/privacidad.html`, cláusula 10), y
- el manifiesto `ios.privacyManifests` de `apps/clientes/app.json` (y el del
  widget, `apps/clientes/targets/saldo/PrivacyInfo.xcprivacy`).

**Si cambia uno, cambian los tres.** Una etiqueta de la tienda que dice menos que
el manifiesto, o un manifiesto que dice menos que el aviso, es motivo de rechazo
y —peor— una afirmación falsa al cliente.

### Cómo se decidió cada respuesta

- **«Recogido»** = sale del teléfono hacia nosotros o hacia un proveedor nuestro.
  Lo que se procesa sólo en el teléfono **no** se declara (Apple y Google dicen
  lo mismo). Por eso la **ubicación no se declara**: `lib/cercania.js` calcula la
  distancia en el teléfono y `salas` no recibe coordenadas. Lo mismo el
  movimiento (brillo de la tarjeta), la biometría (`expo-local-authentication`
  sólo responde sí/no) y los horarios de toma (`lib/tomas.js`, archivo local).
- **«Vinculado a la identidad»**: todo lo que viaja con la sesión queda unido al
  `customer_id`, así que **todo es vinculado**, incluidos los fallos
  (`app_errores.customer_id`).
- **Rastreo (tracking): NO** en todo. No hay SDK de publicidad ni de analítica,
  no se pide el IDFA (sin `NSUserTrackingUsageDescription`), no se cruzan datos
  con terceros para publicidad.
- **Proveedores que procesan por cuenta nuestra** (Supabase, Expo push, Sentry,
  Resend, Wompi) **no son «compartir»** en el sentido de Google ni «tracking» en
  el de Apple.
- **Sentry**: `tracesSampleRate: 0` → **no** se recogen datos de rendimiento;
  sólo fallos. `sendDefaultPii: false` y se limpian DUI y tokens antes de enviar.

### 1. App Store Connect — App Privacy

Primera pregunta: **«¿Usted o sus socios recogen datos de esta app?» → Sí.**

En cada tipo marcado: **Vinculado a la identidad del usuario: Sí** · **Usado para
rastreo: No**.

| Categoría de Apple | Tipo | ¿Recogido? | Propósitos | De dónde sale |
|---|---|---|---|---|
| Contact Info | **Name** | Sí | App Functionality | registro, ficha, chat, tarjeta Wallet |
| Contact Info | **Email Address** | Sí | App Functionality · Developer's Advertising or Marketing | registro (opcional), facturas por correo, promociones con permiso |
| Contact Info | **Phone Number** | Sí | App Functionality · Developer's Advertising or Marketing | entrar, registro, promociones con permiso |
| Contact Info | **Physical Address** | Sí | App Functionality | dirección de entrega y dirección fiscal al reservar desde el carrito |
| Contact Info | Other User Contact Info | No | — | |
| Health & Fitness | **Health** | Sí | App Functionality · Product Personalization | fotos de receta; recordatorios de recompra (`app_tratamientos`) |
| Health & Fitness | Fitness | No | — | |
| Financial Info | Payment Info | **No** (ver nota 1) | — | la tarjeta se escribe en la página de Wompi |
| Financial Info | Credit Info | No | — | |
| Financial Info | Other Financial Info | No | — | |
| Location | Precise Location | **No** | — | se usa sólo en el teléfono |
| Location | Coarse Location | **No** | — | ídem |
| Sensitive Info | Sensitive Info | No | — | (la receta va como Health) |
| Contacts | Contacts | No | — | `invitar` usa la hoja de compartir, no lee contactos |
| User Content | Emails or Text Messages | No | — | (el chat va como Customer Support) |
| User Content | **Photos or Videos** | Sí | App Functionality | receta, foto de perfil, fotos del chat |
| User Content | Audio Data | No | — | micrófono desactivado |
| User Content | Gameplay Content | No | — | |
| User Content | **Customer Support** | Sí | App Functionality | chat con la farmacia, calificación |
| User Content | **Other User Content** | Sí | App Functionality · Analytics | encuestas, notas de pedido, solicitud de mayorista |
| Browsing History | Browsing History | No | — | |
| Search History | Search History | No | — | la búsqueda del catálogo no se guarda |
| Identifiers | **User ID** | Sí | App Functionality | DUI / código de acceso / número de cliente |
| Identifiers | **Device ID** | Sí | App Functionality · Developer's Advertising or Marketing | referencia de avisos (Expo push), registro de Apple Wallet, id aleatorio de `lib/dispositivo.js` |
| Purchases | **Purchase History** | Sí | App Functionality · Product Personalization | compras, reservas, pedidos, pagos, puntos |
| Usage Data | **Product Interaction** | Sí | App Functionality · Analytics | historias vistas, cupón raspado |
| Usage Data | Advertising Data | No | — | |
| Usage Data | Other Usage Data | No | — | |
| Diagnostics | **Crash Data** | Sí | App Functionality | Sentry + `app_errores` (90 días) |
| Diagnostics | Performance Data | **No** | — | Sentry con `tracesSampleRate: 0` |
| Diagnostics | **Other Diagnostic Data** | Sí | App Functionality | modelo del teléfono, versión, pantalla del fallo |
| Surroundings | Environment Scanning | No | — | |
| Body | Hands / Head | No | — | |
| Other Data | **Other Data Types** | Sí | App Functionality · Product Personalization | fecha de nacimiento (opcional), NIT/NRC/giro al pedir crédito fiscal |

Otros campos de la ficha de la app:

- **Privacy Policy URL**: `https://portal.farmasalud.lat/privacidad`
- **User Privacy Choices URL** (opcional): la misma.
- **Eliminación de cuenta** (guía 5.1.1(v)): dentro de la app, Cuenta › Borrar mi
  cuenta. En las notas de revisión, decir qué se conserva y por qué (ficha y
  facturas = registro fiscal; receta de lo retirado = libro sanitario).

### 2. Google Play Console — Seguridad de los datos

Preguntas generales:

| Pregunta | Respuesta |
|---|---|
| ¿La app recopila o comparte alguno de los tipos de datos obligatorios? | **Sí** |
| ¿Todos los datos se encriptan en tránsito? | **Sí** (todo va por HTTPS) |
| ¿Qué formas de crear cuenta ofrece? | Nombre de usuario y otra autenticación: **documento + teléfono, o código personal** (sin contraseña). No hay inicio con Google/Apple. |
| ¿Ofrece una forma de solicitar que se borren los datos? | **Sí**: dentro de la app (Cuenta › Borrar mi cuenta) |
| URL para pedir el borrado de la cuenta | `https://portal.farmasalud.lat/privacidad#borrar-cuenta` |
| ¿Puede pedir que se borren algunos datos sin borrar la cuenta? | **Sí**: foto de perfil, correos guardados, permiso de avisos y de promociones |

**Compartidos con terceros: NINGUNO.** Expo, Sentry, Resend, Wompi y Supabase son
proveedores que procesan por cuenta nuestra (Google los excluye de «compartir»);
Google Wallet / Apple Wallet los activa el propio usuario.

Tipos recopilados (todos: **recopilado sí · compartido no · no efímero**):

| Categoría de Google | Tipo | ¿Obligatorio u opcional? | Finalidades |
|---|---|---|---|
| Información personal | **Nombre** | Obligatorio | Funcionalidad de la app · Administración de la cuenta |
| Información personal | **Dirección de correo electrónico** | Opcional | Funcionalidad de la app · Comunicaciones del desarrollador · Publicidad o marketing |
| Información personal | **IDs de usuario** | Obligatorio | Funcionalidad de la app · Administración de la cuenta · Prevención de fraudes, seguridad y cumplimiento |
| Información personal | **Dirección** | Opcional | Funcionalidad de la app |
| Información personal | **Número de teléfono** | Obligatorio | Funcionalidad de la app · Administración de la cuenta · Publicidad o marketing |
| Información personal | **Otra información** (fecha de nacimiento, NIT/NRC) | Opcional | Funcionalidad de la app · Personalización |
| Información personal | Raza, religión, orientación, opiniones políticas | No | |
| Información financiera | Información de pago del usuario | **No** (nota 1) | |
| Información financiera | **Historial de compras** | Obligatorio | Funcionalidad de la app · Personalización |
| Información financiera | Puntaje crediticio / Otra | No | |
| Salud y actividad física | **Información de salud** | Opcional | Funcionalidad de la app · Personalización |
| Salud y actividad física | Actividad física | No | |
| Mensajes | **Otros mensajes en la app** | Opcional | Funcionalidad de la app |
| Mensajes | Correos / SMS-MMS | No | |
| Fotos y videos | **Fotos** | Opcional | Funcionalidad de la app |
| Fotos y videos | Videos | No | |
| Audio | todos | No | |
| Archivos y documentos | Archivos y documentos | No | |
| Calendario | Eventos | No | |
| Contactos | Contactos | No | |
| Actividad en la app | **Interacciones con la app** | Obligatorio | Funcionalidad de la app · Estadísticas |
| Actividad en la app | **Otro contenido generado por el usuario** (encuestas, notas, calificaciones) | Opcional | Funcionalidad de la app · Estadísticas |
| Actividad en la app | Historial de búsqueda / Apps instaladas / Otras acciones | No | |
| Navegación web | Historial | No | |
| Información y rendimiento de la app | **Registros de fallas** | Obligatorio | Funcionalidad de la app · Estadísticas |
| Información y rendimiento de la app | **Diagnóstico** | Obligatorio | Funcionalidad de la app |
| Información y rendimiento de la app | Otros datos de rendimiento | No | |
| IDs de dispositivo u otros | **IDs de dispositivo u otros** | Obligatorio | Funcionalidad de la app · Prevención de fraudes, seguridad y cumplimiento · Publicidad o marketing |
| Ubicación | Aproximada / Precisa | **No** (se usa sólo en el teléfono) | |

«Obligatorio» quiere decir que el usuario no puede usar la app sin que se
recoja; «Opcional», que depende de una función que él elige usar.

### Notas — lo que no se pudo verificar o queda abierto

1. **Pago — RESUELTO el mismo día.** `wompi-pagos` guardaba en
   `app_reservas_pagos.detalle` la transacción completa de Wompi (que puede
   traer nombre, correo y tarjeta enmascarada del pagador). Ahora guarda sólo
   id, monto, estado, forma de pago, código de autorización y fecha. Ningún
   pago real había entrado todavía (5 filas, todas sin detalle), así que no hay
   nada viejo que limpiar. «Payment Info» queda en **No** con fundamento.
2. **IP — RESUELTO.** Cron `purge-puntos-consulta-intentos` (diario, 30 días),
   migración `20261017165857`.
3. **URL de borrado para Google — RESUELTO.** La cláusula 10 tiene el ancla
   `#borrar-cuenta` y dice cómo pedirlo sin la app (WhatsApp 2301-0013, medios
   de la cláusula 8, o una sala). URL para Play Console:
   `https://portal.farmasalud.lat/privacidad#borrar-cuenta`.
4. **Sentry y la IP.** Con `sendDefaultPii: false` el SDK no manda la IP, pero
   Sentry puede inferirla del envío según la configuración del proyecto. Activar
   en Sentry *Settings › Security & Privacy › Prevent Storing of IP Addresses*.
5. **Plazos** (el aviso dice «mientras dure la relación», cláusula 6.2).
   Decididos el 2026-10-29 (v2.1360.0): pre-registro no vinculado 60 días; chat 12
   meses sin mensajes, con sus archivos (`purgar-chat-clientes`); sesiones 30
   días después de cerrarse o vencer; Wallet al quitar la tarjeta; reservas y
   pagos **se conservan** (comprobantes de dinero cobrado). El cliente puede
   vaciar su chat, sólo para él (`cliente_vacio_hasta_id`). Siguen sin plazo:
   recetas, encargos, historias vistas, aceptaciones y encuestas.
6. **Versión del aviso aceptado.** El aviso subió a versión 2, pero
   `TEXTOS_CONSENTIMIENTO.aviso` (`supabase/functions/_shared/consentimientoPuntos.ts`)
   sigue en `aviso-2026-09-04`. Subirlo a `aviso-2026-10-17` hace que la app le
   vuelva a pedir la aceptación a todo el mundo y exige desplegar
   `app-clientes` y la función de `/mis-puntos`. No se cambió: es una decisión
   del usuario. El cambio no agrega finalidades sobre los datos de las salas;
   las de la app son las del servicio que el cliente pide.
7. **Accessed APIs.** El manifiesto declara sólo UserDefaults con `CA92.1` y
   `1C8F.1` (el App Group que comparte con el widget; `@bacons/apple-targets`
   no trae manifiesto propio). El resto (FileTimestamp, SystemBootTime,
   DiskSpace) lo ponen la plantilla de React Native y los pods de Expo, y el
   plugin de Expo los **une** (`mergePrivacyInfo`), no los pisa. Tras el próximo
   `eas build`, revisar el correo de App Store Connect: si llega un
   ITMS-91053, agregar ahí la API que nombre.
