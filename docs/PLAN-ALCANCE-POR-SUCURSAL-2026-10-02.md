# Plan — que nadie toque lo de otra sucursal cambiando un número (2026-10-02)

## De dónde sale

Al revisar Cuentas por cobrar apareció que `creditos-erp · pedir_correccion`
tomaba la sala del navegador y nunca la comparaba con la de quien llamaba. Se
cerró el mismo día (v2.1159.0). La pregunta siguiente fue si el patrón se
repetía, y se repetía.

**Por qué ninguna prueba lo había visto.** Las edge functions trabajan con la
llave del servidor, que salta el RLS, y las funciones `SECURITY DEFINER`
también. El único freno está en su código. Las pantallas no ofrecen la otra
sucursal, así que todo funciona bien hasta que alguien manda la petición a mano
con otro número. No hay error, no falta ninguna fila, y ninguna prueba que pase
por la interfaz lo puede ver.

**Cómo se midió.** Se leyeron las 84 edge functions y las 91 funciones de la
base que reciben una sucursal. Cada hallazgo se cruzó con `role_permissions` en
producción: un módulo que sólo tienen cargos de toda la red no puede filtrar
nada aunque no compare la sala. La gravedad depende de **quién** tiene el
módulo, no sólo del código.

## Lo que lo vigila desde hoy: `npm run gate:alcance`

`scripts/alcance-manifest.json` declara cómo se protege **cada** función:
`alcance`, `modulo-de-red`, `sin-sala`, `cron`, `publica`, `solo-servidor` o
`deuda`. El gate falla si:

- aparece una función sin declarar (edge function nueva, o función de la base
  nueva que recibe una sucursal y la ejecuta `authenticated`);
- una declarada `alcance` deja de contener el chequeo de sala;
- una declarada `cron` deja de validar su secreto;
- **un módulo de una `modulo-de-red` se le da a un cargo de una sola sala**. Es
  la protección a futuro: esas funciones no comparan la sala porque hoy no hace
  falta, y el día que haga falta no cambia ni una línea de código. En la
  primera corrida ya cazó cinco: Jefe/a de Compras tiene `minmax` con alcance
  de una sala y esas funciones le muestran todas;
- aparece una `deuda` que no estaba en `scripts/alcance-baseline.json`. El
  baseline **sólo baja**.

En el pre-commit corre sólo la parte local (`--hook`), cuando el commit toca
`supabase/functions/`. La de producción se corre al cerrar.

**Se le fabricaron siete regresiones antes de creerle:** una función sin
declarar, una que declara `alcance` sin tenerlo, un cron sin secreto, un módulo
de red que tienen cargos de sala, una deuda nueva, una `solo-servidor` que
`authenticated` puede ejecutar, y una función de la base sin declarar. Las cazó
todas.

**Lo que no ve.** Lee la edge function entera, no acción por acción.
`trasladar-pedido-erp` tiene el chequeo en `recibir` y le falta en `enviar`.
Por eso declarar `alcance` es una afirmación sobre **cada** acción, y una
función con un hueco en una sola acción va como `deuda` hasta que se cierra.
Tampoco ve el permiso equivocado: `pagar` con `can_view` no es un problema de
sala, y lo cazó la lectura, no el gate.

## Decisiones del usuario (2026-10-02)

1. **Pedidos: sólo Bodega crea y despacha.** Los cargos de sala trabajan con
   solicitudes y traslados, no generan pedidos. Hoy ya no ven la pestaña
   Generar —tienen `pedidos` sólo para Historial y Rutas, que es donde reciben
   sus cajas—, así que **no se les quita el módulo**: se cierra en la base.
   Crear y despachar exige alcance de red en `pedidos` (Auxiliar de Bodega y
   Jefe/a de Compras lo tienen); recibir y mover el estado, sólo la propia sala.
2. **Jefe/a de Compras y Logística ve MIN·MAX sólo de Bodega**, no sala por
   sala. Las otras salas las ve al desplegar un producto y dentro del pedido,
   donde puede ver y editar lo que no se envió por regla. O sea que el
   `minmax` en `BRANCH` es correcto, y lo que falta es el chequeo en las cinco
   funciones que hoy le dejan elegir otra sala. **Ojo al cerrarlo:** no romper
   el despliegue del producto ni la edición dentro del pedido — mirar qué
   función alimenta cada una antes de acotar.
3. **Encuestas sólo por permiso, y por ahora sólo administración.** Aplicado el
   mismo día: se le quitó `encuestas_aplicar` a Jefe/a de Sala (6 personas).
   `encuesta_cliente_entrevistar` pasa a `modulo-de-red` y el gate vigila que
   ningún cargo de sala lo vuelva a recibir.

## Las fases

Al cerrar cada ítem: cambiar su guarda en el manifiesto, `npm run gate:alcance`
y `npm run gate:alcance -- --update-baseline`.

### F1 — dinero, y puertas abiertas a internet (primero)

✅ **Cerrada el 2026-10-02.** Desplegadas `creditos-erp` (v30), `anotar-vales-caja`
(v8), `avisar-bultos-viejos` y `avisar-creditos-vencidos`. Verificado en vivo:
las dos de avisos contestan **401** a una llamada sin secreto, y siguen sin
verify_jwt porque su cron manda el secreto de invocación, no un JWT (desplegarlas
sin `--no-verify-jwt` las habría dejado en 401 para el propio cron). No se probó
una llamada válida porque reparte avisos de verdad: la confirmación es la corrida
del cron de mañana (14:00 y 15:00 UTC). Deuda de edge functions: 10 → 6.

| dónde | qué pasa | arreglo |
|---|---|---|
| `creditos-erp` · `pagar` | cobra con permiso de **lectura**; sólo `abonar` exige `can_edit`. Supervisor/a de Ventas (lectura en toda la red) puede cobrar en cualquier sala | `pagar` también con `can_edit` |
| `creditos-erp` · `aplicar_correccion`, `resolver_otro` | no comparan la sala de la solicitud con el alcance de quien aprueba. Latente: hoy aprueban sólo cargos de red | comparar `meta.branch_id` contra el alcance del aprobador |
| `anotar-vales-caja` | anota vales en la caja de **cualquier** sala; sin `sala` recorre las 7. Exige `caja_vales.can_edit`, que tienen 4 cargos de una sala | con alcance de una sala, sólo la propia |
| `avisar-bultos-viejos`, `avisar-creditos-vencidos` | ni sesión ni secreto, y desplegadas sin `verify_jwt`: **cualquiera en internet** las dispara y crea avisos | `requireInvokeSecret`. **Antes de agregarlo, mirar el `command` del cron**: si no manda el secreto, se rompe el cron |

### F2 — pedidos y traslados

✅ **Cerrada el 2026-10-02** (migración `20261003042423`, `trasladar-pedido-erp`).
Crear, confirmar el envío y despachar exigen Pedidos con alcance de red;
preparar, pausar, finalizar y corregir también. Llegada, recepción y
diferencias, sólo la propia sala. **Medido antes de cerrarlo:** en 90 días los
pasos de Bodega los hicieron sólo cargos de red, los de sala siempre en su
propia sala, y los 263 despachos registrados, cargos de red: no le quita nada a
nadie. **Probado en producción** haciéndose pasar por un Dependiente y por un
Auxiliar de Bodega, con pedidos inexistentes y dentro de transacciones que se
deshacen: el Dependiente no puede iniciar, crear ni recibir lo de otra sala, y sí
pasa el freno en la suya; Bodega crea. `BRANCH_SCOPE_DENIED` ahora tiene
traducción en pantalla.

`retiro_pendientes_en_sala` **no se cerró, a propósito**: la usa el recorrido de
entrega, que existe para ver lo pendiente de cada sala que se visita. Quedó
declarada `cruza-por-diseno` con su motivo.

Los pedidos guardan la sucursal **del origen** (`erp_sucursal_id`), no
`branches.id`. El ayudante que ya existe es `auth_employee_erp_sucursal_id()`,
junto con `auth_can_edit_scope_all(ARRAY['pedidos'])` (así lo hacen
`discard_stock_drafts` y `publish_stock_params`).

| dónde | qué pasa |
|---|---|
| `receive_pedido_sucursal` | marca recibido o con diferencias el pedido de cualquier sala. Lo pueden 34 personas de sala |
| `update_pedido_sucursal_lifecycle` | cambia el estado del pedido de cualquier sala |
| `confirmar_envio_pedido` | es de Bodega y lo puede ejecutar un cargo de sala: exigir Bodega |
| `trasladar-pedido-erp` · `enviar` | despacha desde Bodega sin exigir ser de Bodega (sus hermanas `devolver-…` y `no-reenviar-…` sí lo exigen) |
| `retiro_pendientes_en_sala` | lee los traslados pendientes de otra sala |
| `confirm_pedido` | crea un pedido para cualquier sala; lo puede un cargo de sala. Decisión 1: exigir alcance de red |

`pedido_items` y `pedido_sucursal_status` no están en la lista de tablas
calientes, pero **se prueba en el branch de pruebas con `execute_sql`** antes de
producción.

### F3 — datos personales y mensajes

| dónde | qué pasa | arreglo |
|---|---|---|
| `analyze-document`, `saly-ai` · `analyze-document` | descargan **cualquier** archivo de `documents`/`empleados`/`payment-proofs` con la llave del servidor. `analyze-document` ni siquiera exige empleado activo | firmar con el cliente del usuario (decide la policy del bucket) o exigir el módulo del dueño del archivo |
| `saly-ai` · `chat` | lee empleados, asistencia y turnos de toda la empresa, sin módulo | acotar a lo que el cargo puede ver |
| `generate-vacation-plan` | cualquier sesión regenera el plan de toda la empresa | exigir el módulo de vacaciones con edición |
| `encolar_impresion` | imprime contenido libre en la ticketera de cualquier sala | sala propia, o alcance |
| `avisar_a_empleados` | avisos push con texto libre a cualquier empleado; con `invoice_id` copia cliente y forma de pago de cualquier factura | acotar destinatarios a la sala, y la factura a la que el que llama puede ver |

### F4 — menores, y revocaciones

- `operar-caja` · `corregir`: el mismo caso que `pedir_correccion` (sólo crea
  una solicitud). `aplicar_correccion` compara contra lo que manda el
  navegador, no contra el alcance.
- `sync-wfm-sales`: cualquier sesión dispara lecturas al origen; exigir módulo.
- `registrar_bitacora`: la sala y el dispositivo los pone quien llama.
- `get_minmax_contexto_producto`, `contexto_de_solicitud_minmax`: ventas de
  otra sala sin chequeo.
- `get_draft_cost_estimate`: costo sin `auth_ve_costos()`, a diferencia de sus
  hermanas.
- Las cinco de MIN/MAX que cazó el gate (`audit_log_de_producto`,
  `get_minmax_solicitudes_de_producto`, `get_inventory_cost_summary`,
  `productos_parados_de_sala`, `get_stagnant_inventory`). Decisión 2: llevan
  el chequeo de sala (Jefe/a de Compras sólo Bodega).
- **Revocar a `authenticated`** (no las llama el portal):
  `save_pedido_snapshot`, `sincronizar_bitacora_dispensaciones`,
  `resumen_ventas_diario`, `verificar_hojas_pedido`, `destinatarios_de_modulo`.
  Pasan a `solo-servidor`. Antes de revocar, grep en `supabase/functions/`:
  `resumen_ventas_diario` la usa una edge function con service_role, que no
  necesita el permiso de `authenticated`.

## Lo que ya estaba bien

Recetas y dispensaciones (datos de pacientes, vía `bitacora_exigir_acceso`),
cortes de caja, traslados de inventario, descuentos, facturas de sala, libros
de IVA, el resto de Cuentas por cobrar, y todo lo de metas, promociones,
encuestas, facturación y personal, que hoy sólo tienen cargos de red (y que
desde hoy el gate vigila que siga así).
