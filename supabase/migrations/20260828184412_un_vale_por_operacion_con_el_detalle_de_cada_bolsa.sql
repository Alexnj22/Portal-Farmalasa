-- Un vale por OPERACION, no uno por bolsa.
--
-- Corregido por el usuario el 2026-08-28, mirando los cuatro papeles que salieron
-- de CMB-1032 ($2,000 de cuatro bolsas de La Popular): «salieron 4 vales, no
-- deberia de haber salido solo 1 vale especificando cuanto de cada bolsa? y si 1
-- tiket de bolsa para cada una de donde salio?». Y donde queda ese papel: «los
-- vales y demas se guardan aparte. asi que puede ser solo 1. eso si, debe
-- especificar de donde y cuanto salio».
--
-- Eso corrige una premisa del modulo, no un detalle de impresion: hasta hoy el
-- vale «quedaba DENTRO de la bolsa» —lo decia su propio pie— y por eso tenia que
-- haber uno por bolsa. Si los vales se archivan aparte, cuatro papeles casi
-- iguales son cuatro salidas aparentes de una sola operacion.
--
-- Para armar ese papel hace falta la operacion ENTERA, y `get_salidas_de_bolsa`
-- es por bolsa: devuelve una linea y no las cuatro. De ahi esta funcion.
--
-- `saldo_despues` se calcula por linea hasta el sello de ESE movimiento y no con
-- `bolsa_saldo` (que es el de hoy): asi una reimpresion dice lo mismo que dijo el
-- papel original, que es lo que permite leer dos vales de la misma bolsa en
-- orden. Es la misma cuenta que hacia `DetalleDeBolsa` en el navegador.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_operacion_de_bolsa(p_operacion_id bigint)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT to_json(x) FROM (
        SELECT o.id, o.folio, o.tipo, t.etiqueta, t.etiqueta_entidad, t.leyenda,
               o.monto, o.entidad, o.numero_boleta, o.nota,
               o.registrado_at, o.recibido_metodo,
               eq.name  AS registrado_nombre,
               er.name  AS recibido_nombre,
               br.name  AS sala,
               (SELECT coalesce(json_agg(to_json(l)
                                ORDER BY l.bolsa_fecha, l.bolsa_hora, l.bolsa_id), '[]'::json)
                  FROM (
                    SELECT m.id AS movimiento_id, m.vale_folio, m.monto,
                           m.anulado_at, m.impreso_at,
                           b.id AS bolsa_id, b.folio AS bolsa_folio,
                           b.fecha AS bolsa_fecha, b.hora AS bolsa_hora,
                           round(b.monto_inicial + coalesce((
                               SELECT sum(m2.monto)
                                 FROM public.bolsas_movimientos m2
                                WHERE m2.bolsa_id = b.id
                                  AND m2.anulado_at IS NULL
                                  AND m2.registrado_at <= m.registrado_at
                           ), 0), 2) AS saldo_despues
                      FROM public.bolsas_movimientos m
                      JOIN public.bolsas b ON b.id = m.bolsa_id
                     WHERE m.operacion_id = o.id
                  ) l) AS lineas
          FROM public.bolsas_operaciones o
          JOIN public.bolsas_tipos_salida t ON t.codigo = o.tipo
          LEFT JOIN public.branches  br ON br.id = o.branch_id
          LEFT JOIN public.employees er ON er.id = o.recibido_por
          LEFT JOIN public.employees eq ON eq.id = o.registrado_por
         WHERE o.id = p_operacion_id
           AND (SELECT auth_has_module_permission('bolsas','can_view'))
    ) x;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_operacion_de_bolsa(bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_operacion_de_bolsa(bigint) TO authenticated, service_role;
