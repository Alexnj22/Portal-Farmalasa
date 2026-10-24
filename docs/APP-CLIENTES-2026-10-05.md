# App de clientes «Puntos Salud» (2026-10-05)

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
