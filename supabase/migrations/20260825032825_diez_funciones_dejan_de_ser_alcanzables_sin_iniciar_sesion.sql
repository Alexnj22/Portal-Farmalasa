SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- Diez funciones dejan de ser alcanzables sin iniciar sesión
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Sale de la auditoría del 2026-08-23, que midió **24 funciones y 3 tablas**
-- alcanzables por `anon` cuando la regla escrita en CLAUDE.md decía que eran
-- cinco. Ninguna era un agujero —se verificaron una por una— pero la superficie
-- había crecido sola durante un mes y nada la miraba.
--
-- Todas nacieron con el GRANT por los **default privileges** de Supabase, que
-- conceden EXECUTE a `anon` sobre cada función nueva del esquema `public`. No es
-- que alguien las abriera: es que nadie las cerró.
--
-- ── Qué se revoca, y por qué es seguro ──────────────────────────────────────
--
-- **Seis funciones de TRIGGER.** Postgres no deja invocarlas directamente
-- («trigger functions can only be called as triggers»), así que el GRANT era
-- inerte. Y al dispararse por un trigger **no se comprueba el EXECUTE de quien
-- provocó la operación**: corre como parte de la escritura.
--
-- Eso último se probó en el entorno de pruebas antes de aplicar esto, porque de
-- una premisa así no alcanza con estar seguro: revocado el GRANT, una sesión
-- `authenticated` cambió `min_units` de una fila y el trigger escribió igual su
-- `manual_at` y su `manual_por`. (Los dos primeros intentos dieron «no escribió»
-- y eran un defecto de la PRUEBA: tomaba `LIMIT 1` sin orden y caía en una fila
-- pegada al CHECK `chk_min_lt_max`, así que el UPDATE ni llegaba a correr.)
--
-- **Tres funciones puras** —`nit_sv_valido`, `sello_mh_valido`,
-- `es_ultimo_dia_del_mes_sv`— que no leen ninguna tabla: validan un formato o
-- calculan una fecha. Se comprobó que no viven dentro de ningún CHECK, policy ni
-- índice; sólo las llaman `aplicar_barrido_proveedores` y
-- `completar_nit_proveedores`, que son SECURITY DEFINER y corren con los
-- permisos de su dueño.
--
-- **`update_proveedor_manual`, la de NUEVE argumentos.** Acá la auditoría se
-- equivocó de sobrecarga y conviene dejarlo escrito: decía que el GRANT lo tenía
-- «la sobrecarga vieja». Es al revés. La revocación del 2026-07-29 alcanzó a la
-- de ocho argumentos, y cuando se le agregó `p_retiene_renta` la **nueva** nació
-- con el GRANT otra vez. Las dos tienen su guarda `auth_can_edit_any`, así que
-- ninguna exponía nada — pero la que el portal usa hoy es ésta, y era la abierta.
--
-- ── Lo que NO se toca ───────────────────────────────────────────────────────
-- Las seis del kiosco (`kiosco_*`, `verify_kiosk_*`, `get_kiosk_*`) y las tres
-- de impresión (`reclamar_impresion`, `confirmar_impresion`,
-- `canjear_codigo_de_vinculacion`) **tienen que ser alcanzables sin sesión**:
-- son el pre-login de una tablet y de una caja, y se defienden solas validando
-- `device_token` adentro. Están declaradas en `auditoria/superficie-anon.json`
-- con su motivo, y `gate:auditoria` falla si producción expone algo que no esté
-- ahí.
--
-- Tampoco se tocan las de `pg_trgm`: revocarles EXECUTE rompe los índices de
-- trigram. Salen del namespace público moviendo la extensión, no revocando.

REVOKE EXECUTE ON FUNCTION public.asignar_aprobador_solicitud()   FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.expandir_lineas_envio()         FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.marcar_ajuste_manual_minmax()   FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notificar_decision_diferencia() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notificar_resolucion_envio()    FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.validar_envio_producto()        FROM anon, PUBLIC;

REVOKE EXECUTE ON FUNCTION public.es_ultimo_dia_del_mes_sv() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.nit_sv_valido(text)        FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sello_mh_valido(text)      FROM anon, PUBLIC;

REVOKE EXECUTE ON FUNCTION public.update_proveedor_manual(
  bigint, text, text, text, text, boolean, text, boolean, boolean) FROM anon, PUBLIC;
