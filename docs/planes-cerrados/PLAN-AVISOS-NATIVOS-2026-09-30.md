# Plan — avisos nativos modernos en la app (2026-09-30)

Pedido del usuario, en tres mensajes del 2026-09-29 y 30:

> «podríamos poner los botones de confirmar, rechazar ahí?»
> «quiero que la notificación se vea moderna, no solo texto»
> «tampoco se mandará un testamento de notificación, así que debemos ser eficientes»
> «definimos bien cómo funcionará todo lo de notificaciones, y luego mandamos esa
> update completa con todas las notificaciones a probar»

**Regla de la fase:** se diseña y se programa TODO lo de avisos, y se compila
la app UNA vez al cerrar la fase (memoria `feedback_compilar_la_app_por_fases`).
Lo del servidor se despliega en cuanto está listo, porque no necesita
compilación.

## Lo que ya existe (2026-09-30)

- `push_dispositivos` + `registrar_dispositivo_push` / `soltar_dispositivo_push`
  (migración `20260929231553`). El teléfono se liga a quien tiene la sesión.
- `send-push-notification` manda por los dos canales (navegador y app) con los
  mismos destinatarios y el mismo horario laboral.
- Traslado pendiente: el aviso del teléfono lista hasta 4 productos, trae
  `categoryId: 'traslado'` y los botones **Enviar todo** / **Rechazar…** ya
  están programados en la app (`componentes/avisos.js`). **Todavía no están en
  una compilación.**
- Arreglado de paso: el `tag` `ann-undefined` hacía que cada aviso borrara al
  anterior.

## Cómo se ve un aviso (todas las familias igual)

```
┌───────────────────────────────┐
│ (foto) Ana López · Salud 1     │  ← la foto de QUIEN lo origina
│ Pide un traslado a La Popular  │     (aviso de comunicación de iOS)
├───────────────────────────────┤
│ AMOXICILINA 500 MG     2 cajas │  ← tarjeta propia al mantener
│ GARGANTINAS MIEL       5 blíst.│     presionado: hasta 4 renglones
│ +2 productos · 58 unidades     │     y la cuenta del resto
├───────────────────────────────┤
│ [ Enviar todo ]  [ Rechazar… ] │  ← sólo si quien lo recibe puede
└───────────────────────────────┘
```

1. **Foto de quien lo origina** en lugar del ícono (aviso de *comunicación* de
   iOS, como Mensajes). Si el aviso lo origina el sistema (un cron), va el
   ícono de la app.
2. **Tarjeta propia** (Notification Content Extension, SwiftUI) al mantener
   presionado: renglones alineados, cifras, colores del sistema.
3. **Agrupados por tema** (`threadId`): traslados, solicitudes, caja, pedidos.
4. **Cortos:** título, una línea de contexto, hasta 4 renglones y «y N más».
5. **Urgentes** (`time-sensitive`) sólo lo que pide acción hoy.

En Android: foto grande de quien lo origina, lista expandible (InboxStyle),
color de marca y los mismos botones.

## Las familias

**Con botones** (el botón pide desbloquear con Face ID, aplica los permisos del
portal, y sólo aparece si quien recibe puede hacerlo):

| Aviso | Recibe | Tarjeta | Botones |
|---|---|---|---|
| Te piden un traslado | sala de origen | sala, productos, motivo | **Enviar todo** · **Rechazar…** (motivo de la lista) |
| Te envían producto | sala destino | quién, productos | **Aceptar todo** · **Devolver…** (motivo) |
| Solicitud personal (vacaciones, permiso, cambio de turno) | quien aprueba | quién, tipo, fechas | **Aprobar** · **Rechazar…** (nota) |
| Solicitud de sucursal (descarte, carga, corrección de caja, facturación) | quien aprueba | sala, tipo, productos o monto | **Aprobar** · **Rechazar…** (nota) |
| Min/Max | quien aprueba | producto, antes → después | **Aprobar** · **Rechazar…** |
| Diferencia de caja por decidir | jefatura | sala, monto | **Ver** (se decide mirando) |

**Sólo informan** (tocar abre el detalle): tu solicitud aprobada/rechazada (con
motivo), tu traslado enviado/rechazado/con faltante, pedidos (en camino,
llegó, problema), comunicados, caja (cortes pendientes, cierre), metas,
créditos vencidos, alertas del sistema.

## Fases

| | qué | dónde | compila |
|---|---|---|---|
| **N1** | **La tarjeta en el servidor.** `send-push-notification` arma, por familia, un objeto estructurado — `{ familia, quien: {nombre, foto}, sala, renglones[], resto, cifra, acciones[] }` — leyendo la fila que nombra la dirección del aviso (`?solicitud=`, `?envio=`, …). `threadId` por familia. Las acciones se calculan POR DESTINATARIO (puede aprobar o no). Si la lectura falla, sale el aviso de texto de siempre | servidor | no |
| **N2** | **Aprobar en el servidor.** Hoy las solicitudes personales y de sucursal se aprueban con lógica que corre en el navegador (`requestsSlice` `approveRequest`/`rejectRequest`, niveles con `resolveNextApprover`). Un botón de la notificación tiene que dar EXACTAMENTE el mismo resultado que el portal, así que esa lógica pasa a una función del servidor que usen las dos (portal y app). Es la parte grande y la que hay que medir con cuidado: el portal cambia de camino | servidor + portal | no |
| **N3** | **La app.** Extensión de servicio (foto de comunicación, descarga de imagen) y extensión de contenido (la tarjeta en SwiftUI) con `@bacons/apple-targets`; categorías por familia; lo que hace cada botón | app | — |
| **N4** | **Android.** Proyecto de Firebase (lo crea el usuario), `google-services.json`, canal con estilo, foto grande, botones | app | — |
| **N5** | **Una compilación** de iOS y Android, y un comando que manda un aviso de PRUEBA de cada familia (`data.prueba: true`: los botones responden sin tocar nada) para revisarlas todas en el teléfono | — | **sí, una** |

## Decidido

- **Enviar todo** despacha directo desde la notificación (usuario, 2026-09-30),
  sabiendo que el ticket de la bolsa no sale desde el teléfono: se reimprime
  desde la tarjeta del traslado en la computadora de la sala.
- **Rechazar** siempre pide motivo.
- Los avisos llegan a la app **y** al navegador: las computadoras de sala son
  compartidas y dependen del aviso del navegador.
