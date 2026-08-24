# Solicitudes — quién decide, quién lo ve, y las tres veces que la bandeja quedó vacía

**Escrito el 2026-08-24**, durante la auditoría completa del portal.
Solicitudes era una de las once áreas sin documento propio, y es la que reúne el
patrón de falla más caro de todo el portal:

> **Cero filas y «no hay solicitudes» se ven idénticos.** Un recorte de más no
> da error, no deja rastro y nadie lo reporta como bug.

Pasó **tres veces** en este mismo archivo, por tres puertas distintas. Este
documento existe para que no haya una cuarta.

---

## 1. Una sola tabla, muchas familias

Todo vive en `approval_requests`: descartes, cargas, traslados entre salas,
Min·Máx, facturación, vacaciones, anticipos, cambios de turno. Los distingue
`type`, y el permiso se cobra **por familia** (`can_approve` del módulo que le
corresponde), no por solicitud.

Las piezas:

| pieza | qué hace |
|---|---|
| `src/data/requests.js` | la capa de datos y **el enrutador de aprobadores** |
| `src/hooks/useDecidirSolicitud.js` | aprobar o rechazar — **una** definición, dos pantallas |
| `src/views/RequestsView.jsx` + `src/views/solicitudes/` | el centro de la sala y el de la persona |
| `src/store/slices/requestsSlice.js` | el estado y los avisos |

---

## 2. La regla: **quién ve qué lo decide el RLS, no el navegador**

Las tres veces que la bandeja quedó vacía fue por lo mismo — un recorte del
navegador **más angosto** que el del servidor. Vale la pena verlas juntas
porque la forma se repite:

### 2.a — El filtro por `approver_id`

La consulta pedía «lo que me tocaba a MÍ»: `approver_id = yo`, sin asignar, o
mía. Pero **`approver_id` es a quién enrutó la jerarquía, no quién puede
decidir**: la policy de UPDATE cobra `can_approve` de la familia y no mira ese
sello, y el aviso lo reparte `notificar_solicitud_creada` entre **todos** los
que pueden aprobar esa familia. Había tres definiciones de «esto es tuyo» y la
más angosta era la única que decidía qué se veía.

Medido en producción el 2026-08-17 con la sesión de Talento Humano —alcance
`ALL`, `can_approve` en las cuatro familias—: **35 solicitudes en la tabla, 5
pendientes, la consulta devolvía 0.** Recibía la notificación de cada una y
llegaba a una pantalla vacía; ni el enlace `?solicitud=` abría nada, porque
busca dentro de una lista que nunca la trajo.

### 2.b — El recorte por la sala de quien pidió

`employee_id IN (los de mi sala)` parece obvio y descarta **siempre** un tipo:
el traslado. Es el único donde quien pide y quien contesta están en salas
distintas —pide la sala que no tiene, confirma la que sí—, así que su
`employee_id` es de la otra sala **por definición**.

Medido el mismo día con la sesión de Bodega (alcance `BRANCH`): la policy le
dejaba ver **4 traslados pendientes** y el filtro dejaba **0**. El aviso le
llegaba igual, así que el traslado existía en la campana y en ninguna pantalla.

La policy mira tres cosas que ese filtro no puede reproducir: ser la sala de
**origen**, ser la de **destino**, o **cubrir a la de origen mientras está
cerrada** — la sala de respaldo.

### 2.c — `metadata.destinatarios` como si fuera un permiso

Era una cuarta condición y se quitó el 2026-08-21. **La lista se graba al crear
la solicitud y no caduca**, así que le dejaba a la sala de respaldo el historial
entero de Bodega para siempre. Una lista de destinatarios sirve para **avisar**,
no para **autorizar**.

### La regla que quedó

**El servidor recorta; la vista ordena.** `fetchApprovalRequestsList` trae lo
que el RLS deja pasar y `visible()` de la vista decide qué se muestra primero.
Por eso tampoco hace falta pasar el propio id: lo propio pasa la policy por
`employee_id`.

---

## 3. Y traer todo obliga a paginar

Al sacar el filtro de `approver_id`, la consulta pasó a traer todo lo que el RLS
permite. `approval_requests` **sólo crece**: sin paginar, el día que cruce las
1000 filas PostgREST corta ahí sin error — el **mismo fallo mudo** que se acababa
de arreglar, reaparecido por la puerta de al lado.

**El desempate por `id` es la otra mitad de paginar.** `range()` corta por
posición, así que necesita un orden total. Hoy `created_at` no empata —36 filas,
36 instantes— pero eso es una propiedad de los datos de hoy, no una garantía: el
default es `now()`, el instante de la **transacción**, así que dos filas
insertadas juntas nacerían con el mismo sello.

---

## 4. El enrutador de aprobadores

Sube recursivamente por la jerarquía de roles (`roles.parent_role_id` y
`secondary_parent_role_id`) buscando a alguien activo, de la sala que
corresponda, que no sea quien pidió.

Cada función de búsqueda está separada aunque se parezcan: **difieren en qué
filtros son fijos y cuáles condicionales**, y unificarlas cambiaría el
enrutamiento, no sólo movería un query.

### Los fallbacks estuvieron rotos

Las tres consultas de «quién es admin» —el último recurso cuando no hay jefe ni
supervisor— pedían `employees.is_admin`, **una columna que no existe**. Un
`.eq()` contra una columna inexistente devuelve error, el llamador lo trata como
«no hay nadie», y la solicitud se queda **sin aprobador**. El criterio correcto
es `system_role` (`ADMIN` y `SUPERADMIN`), que es el que ya usaba el resto del
código.

### La disponibilidad se **pregunta**, no se pide

`empleado_no_disponible(p_employee_id)` devuelve un sí/no. Antes el navegador se
traía los eventos **de otra persona** y decidía acá, lo que obligaba a tener
`employee_events` abierta a cualquiera.

Y cerrar esa tabla con la versión vieja habría sido un fallo **callado**: la
lectura devolvería cero filas, `isUnavailable` diría «disponible» sin error, y
la solicitud se iría a alguien de vacaciones.

---

## 5. Decidir

`useDecidirSolicitud` es **una** definición usada por la vista y por la campana.
Vivía dentro de `RequestsView`, y mientras la campana sólo sabía llevar a esa
pantalla alcanzaba; desde que decide en el sitio, copiarla habría significado dos
versiones de tres cosas que no se ven hasta semanas después:

1. Un Min·Máx aprobado escribe en la bitácora **con las claves que lee el
   historial del producto**.
2. Hay que avisarle a quien lo propuso.
3. El aviso propio se apaga a mano, para no seguir ofreciendo «Aprobar» sobre lo
   ya resuelto.

Lo que **no** entra ahí es lo que cada pantalla hace después —cerrar su modal,
parchar su lista—: eso va por `onAplicado`.

**Un rechazo sin motivo no se acepta.** Lo frena el servidor; acá se evita el
viaje.

**El alcance «sólo míos» son DOS cosas**: las que mandé y las que me toca
contestar como compañero — el primer nivel de un cambio de turno lo responde el
otro, no una jefatura. Sin la segunda mitad, encender ese alcance apagaba los
cambios de turno sin decirlo.

---

## 6. Antes de tocar algo en Solicitudes

1. **No agregar filtros de visibilidad en el navegador.** Si hace falta recortar,
   se recorta en la policy. Un filtro del cliente que sea más angosto que el RLS
   es indetectable desde adentro.
2. **Al agregar un tipo nuevo, preguntarse si quien pide y quien contesta están
   en la misma sala.** Si no, cualquier recorte por sala lo va a descartar.
3. **Una lista guardada en `metadata` no autoriza.** No caduca.
4. **Toda consulta a `approval_requests` va por `fetchAllRows` y con desempate
   por `id`.**
5. **Verificar en producción con la sesión de quien va a usarlo**, no con la de
   administración: las tres bandejas vacías se veían perfectas desde una sesión
   con alcance `ALL`.
