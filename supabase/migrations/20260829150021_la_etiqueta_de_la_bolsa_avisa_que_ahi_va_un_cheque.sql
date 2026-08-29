-- La etiqueta de la bolsa avisa que ahi va un cheque.
--
-- Un cheque es un PAPEL que viaja con el dinero y que no esta en ningun numero
-- del corte: medido en el unico del mes, el del 27-ago en Salud 1 por $352.50,
-- `tk_venta` vale 1141.30 —los billetes del dia y nada mas— y el declarado
-- 1162.21. O sea que la bolsa S1-1165 dice $565.21 de efectivo y ademas lleva
-- un cheque de $352.50 del que su etiqueta no decia una palabra.
--
-- Quien cuenta la bolsa cuenta billetes: si el cheque esta adentro y el papel
-- no lo nombra, o se cuenta como faltante de nada o se traspapela. Son cuatro
-- en quince meses (mayo/25, octubre/25, junio/26 y agosto/26), y esa rareza es
-- justamente por que nadie lo noto antes.
--
-- ── A QUE BOLSA PERTENECE UN CHEQUE ─────────────────────────────────────────
-- A la PRIMERA bolsa viva de esa sala y ese dia cuya hora sea igual o posterior
-- a la de la venta; y si el cheque entro despues de la ultima —el corte ya
-- estaba hecho— a esa ultima. Es la misma ventana con la que `bolsa_sugerida`
-- reparte el efectivo del dia, pero escrita de forma que NO deje huecos: con un
-- rango abierto por arriba, un cheque cobrado despues del ultimo corte no
-- saldria en ninguna etiqueta, y desaparecer en silencio es exactamente el modo
-- de falla que esto viene a cerrar.
--
-- ── QUE PASA SI QUIEN LLAMA NO TIENE PERMISO ────────────────────────────────
-- Devuelve `[]`, igual que `get_operacion_de_bolsa`. Se puede porque quien
-- imprime la etiqueta ya leyo la fila de `bolsas` a traves del RLS, que exige
-- el MISMO permiso: sin el no hay bolsa que imprimir, asi que la lista vacia
-- por falta de permiso no es alcanzable desde la unica puerta que existe.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_cheques_de_bolsa(p_bolsa_id bigint)
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
    WITH b AS (
        SELECT x.id, x.branch_id, x.fecha
          FROM public.bolsas x
         WHERE x.id = p_bolsa_id
           AND (SELECT auth_has_module_permission('bolsas','can_view'))
           AND ((SELECT auth_module_scope('bolsas')) = 'ALL'
                OR x.branch_id = (SELECT auth_employee_branch_id()))
    ),
    hermanas AS (
        SELECT h.id, h.hora
          FROM public.bolsas h
          JOIN b ON h.branch_id = b.branch_id AND h.fecha = b.fecha
         WHERE h.estado <> 'ANULADA'
    ),
    cheques AS (
        SELECT si.hora, si.cliente, si.correlativo, si.total,
               coalesce(
                   (SELECT z.id FROM hermanas z
                     WHERE z.hora >= si.hora ORDER BY z.hora, z.id LIMIT 1),
                   (SELECT z.id FROM hermanas z ORDER BY z.hora DESC, z.id DESC LIMIT 1)
               ) AS bolsa_id
          FROM public.sales_invoices si
          JOIN b ON si.branch_id = b.branch_id AND si.fecha = b.fecha
         WHERE si.estado = 'FINALIZADA'
           AND lower(btrim(si.tipo_pago)) = 'cheque'
    )
    SELECT coalesce(json_agg(to_json(t) ORDER BY t.hora), '[]'::json)
      FROM (
        SELECT c.hora, c.cliente, c.correlativo AS documento, c.total
          FROM cheques c
         WHERE c.bolsa_id = p_bolsa_id
      ) t;
$$;

COMMENT ON FUNCTION public.get_cheques_de_bolsa(bigint) IS
    'Los cheques que viajan con una bolsa. No estan en ningun numero del corte: la etiqueta los nombra aparte.';

REVOKE EXECUTE ON FUNCTION public.get_cheques_de_bolsa(bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_cheques_de_bolsa(bigint) TO authenticated, service_role;
