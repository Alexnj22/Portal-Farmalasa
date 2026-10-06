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

## Lo que falta

1. **Enviar avisos**: la app ya registra el token del teléfono
   (`app_cliente_sesiones.push_token`, con `acepta_avisos`). Falta quién los
   manda —oferta nueva publicada, puntos por vencer— y necesita el `projectId`
   de EAS (`eas init` en `apps/clientes`).
2. **Inyecciones TRAÍDAS**: guardan sólo el nombre escrito, sin ficha. No
   aparecen en la app y no se adivinan por nombre.
3. **Pagos en línea**: fase aparte. Producto físico → Apple no cobra comisión y
   vale cualquier pasarela (Wompi, N1co, Serfinsa). Lo de receta no se vende en
   línea.
4. **Ficha en la tienda**: política de privacidad pública, capturas, cuenta
   de prueba para la revisión de Apple.
