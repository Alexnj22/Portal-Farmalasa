# App Puntos Salud — respuestas de privacidad para las tiendas (2026-10-17)

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

## Cómo se decidió cada respuesta

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

## 1. App Store Connect — App Privacy

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

## 2. Google Play Console — Seguridad de los datos

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

## Notas — lo que no se pudo verificar o queda abierto

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
5. **Plazos sin purga** (el aviso dice «mientras dure la relación», cláusula
   6.2): sesiones, pre-registros, chat, recetas, reservas, encargos, pagos,
   historias vistas, aceptaciones, encuestas y `wallet_registros`.
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
