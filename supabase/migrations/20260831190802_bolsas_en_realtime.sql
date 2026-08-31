SET lock_timeout = '5s';

/* ── Las bolsas de efectivo, en vivo ────────────────────────────────────────
 *
 * «en el conteo de bolsas de efectivo, debe actualizarse solo, si estamos 2 o 3
 * personas contando, debo actualizar para ver cuáles faltan» (usuario,
 * 2026-08-31). El sondeo cada 20 s de v2.884.0 ya lo resolvía; esto lo vuelve
 * instantáneo y baja el sondeo a red de seguridad.
 *
 * Se publica UNA tabla y alcanza: las trece funciones que mueven el circuito
 * escriben en `bolsas` —doce con UPDATE, `cerrar_bolsa_de_corte` con INSERT—,
 * incluida `registrar_salida_de_bolsa`, que toca `updated_at` a propósito
 * aunque el monto viva en `bolsas_movimientos`. La única que no la toca es
 * `anular_salida_de_bolsa`: esa sigue llegando por el sondeo, y como la hace
 * quien tiene el diálogo abierto, su propia pantalla se recarga igual.
 *
 * Riesgo de bloqueo: bajo. `bolsas` pesa 280 kB con 189 filas y NINGÚN cron le
 * escribe — no es de las tablas calientes del incidente del 2026-07-08. El
 * `lock_timeout` va igual, que es la regla.
 *
 * `REPLICA IDENTITY` se queda en el default (la PK): sólo hace falta saber QUE
 * algo cambió para volver a leer, no el valor viejo. Y la RLS de `bolsas` tiene
 * la misma forma que la de `pedidos` —`auth_has_module_permission` +
 * `auth_module_scope`, las dos envueltas en `(SELECT …)`—, que ya se evalúa
 * bien desde realtime en el módulo de Pedidos.
 */
ALTER PUBLICATION supabase_realtime ADD TABLE public.bolsas;
