SET lock_timeout = '5s';

-- ── El conteo se lee POR SUCURSAL, y la firma lleva cara ────────────────────
--
-- «necesito tener totales diario por sucursal, que esté seccionado por
-- sucursal, que SIEMPRE LA FOTO CON NOMBRE Y APELLIDO» (usuario, 2026-08-26).
--
-- El desglose «Por día» sumaba las seis salas en una cifra por fecha, que es la
-- pregunta de quien mira la tanda entera — pero el conteo se HACE sala por sala
-- y día por día (es el proceso que dictó el usuario el 24-ago), así que la
-- cifra contra la que se cuadra el trabajo real no estaba en ninguna parte.
--
-- `por_sala` la trae armada: cada sucursal con su total, sus días y sus bolsas
-- adentro. Se arma acá y no en el navegador porque la agrupación es la misma
-- que ya hace el resto de la pantalla y no puede quedar dicha dos veces.
--
-- Y las firmas dejan de ser texto: viajan con `photo_url` para que la pantalla
-- pinte la cara. Sale del padrón de empleados por RPC DEFINER, igual que
-- `get_bolsas_personas`; el navegador la firma con `signPhotosDeep` porque el
-- bucket es privado y la URL cruda expira (regla 10).
CREATE OR REPLACE FUNCTION public.get_conteos(p_desde date, p_hasta date)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE
    WHEN NOT (SELECT auth_has_module_permission('bolsas_conteo', 'can_view')) THEN NULL
    ELSE coalesce((
      SELECT json_agg(to_json(t) ORDER BY t.cerrado_at DESC, t.folio DESC)
      FROM (
        SELECT c.id, c.folio, c.fecha, c.cuantas,
               c.total_esperado, c.total_contado, c.diferencia, c.descuadradas,
               c.cerrado_at,
               -- Cuántas de las que no cuadraron ya tienen su causa anotada, y
               -- cuánto suma lo que NO la tiene.
               (SELECT count(*) FROM public.bolsas b
                 WHERE b.conteo_id = c.id AND b.dif_at IS NOT NULL)          AS resueltas,
               coalesce((SELECT sum(round(b.contado - public.bolsa_saldo(b.id), 2))
                           FROM public.bolsas b
                          WHERE b.conteo_id = c.id AND b.dif_at IS NULL), 0) AS pendiente,
               (SELECT e.name      FROM public.employees e WHERE e.id = c.cerrado_por) AS cerrado_por,
               (SELECT e.photo_url FROM public.employees e WHERE e.id = c.cerrado_por) AS cerrado_por_foto,
               (SELECT min(b.fecha) FROM public.bolsas b WHERE b.conteo_id = c.id) AS dia_desde,
               (SELECT max(b.fecha) FROM public.bolsas b WHERE b.conteo_id = c.id) AS dia_hasta,
               -- Quiénes contaron, sin repetir y CON su cara.
               coalesce((
                 SELECT json_agg(json_build_object('name', x.name, 'photo_url', x.photo_url)
                                 ORDER BY x.name)
                   FROM (SELECT DISTINCT e.name, e.photo_url
                           FROM public.bolsas b
                           JOIN public.employees e ON e.id = b.contado_por
                          WHERE b.conteo_id = c.id) x
               ), '[]'::json) AS contaron,
               -- ── Sucursal por sucursal: su total, sus días y sus bolsas ──
               coalesce((
                 SELECT json_agg(json_build_object(
                          'branch_id', s.branch_id, 'sala', s.sala,
                          'cuantas', s.cuantas, 'esperado', s.esperado,
                          'contado', s.contado, 'descuadradas', s.descuadradas,
                          'dias', s.dias, 'bolsas', s.bolsas)
                        ORDER BY s.sala)
                   FROM (
                     SELECT b.branch_id,
                            (SELECT br.name FROM public.branches br WHERE br.id = b.branch_id) AS sala,
                            count(*)                                AS cuantas,
                            sum(public.bolsa_saldo(b.id))           AS esperado,
                            sum(b.contado)                          AS contado,
                            count(*) FILTER (
                              WHERE abs(round(b.contado - public.bolsa_saldo(b.id), 2)) >= 0.01
                            )                                       AS descuadradas,
                            (SELECT json_agg(json_build_object(
                                       'fecha', d.fecha, 'cuantas', d.cuantas,
                                       'esperado', d.esperado, 'contado', d.contado)
                                     ORDER BY d.fecha)
                               FROM (SELECT b2.fecha, count(*) AS cuantas,
                                            sum(public.bolsa_saldo(b2.id)) AS esperado,
                                            sum(b2.contado) AS contado
                                       FROM public.bolsas b2
                                      WHERE b2.conteo_id = c.id
                                        AND b2.branch_id = b.branch_id
                                      GROUP BY b2.fecha) d)         AS dias,
                            (SELECT json_agg(json_build_object(
                                       'id', b3.id, 'folio', b3.folio,
                                       'fecha', b3.fecha, 'hora', b3.hora,
                                       'contado', b3.contado,
                                       'esperado', public.bolsa_saldo(b3.id),
                                       'contado_por', (SELECT e.name FROM public.employees e WHERE e.id = b3.contado_por),
                                       'contado_por_foto', (SELECT e.photo_url FROM public.employees e WHERE e.id = b3.contado_por),
                                       'dif_via', b3.dif_via, 'dif_causa', b3.dif_causa, 'dif_at', b3.dif_at,
                                       'dif_por', (SELECT e.name FROM public.employees e WHERE e.id = b3.dif_por))
                                     ORDER BY b3.fecha, b3.hora, b3.folio)
                               FROM public.bolsas b3
                              WHERE b3.conteo_id = c.id
                                AND b3.branch_id = b.branch_id)     AS bolsas
                       FROM public.bolsas b
                      WHERE b.conteo_id = c.id
                      GROUP BY b.branch_id
                   ) s
               ), '[]'::json) AS por_sala
          FROM public.bolsas_conteos c
         WHERE (p_desde IS NULL OR c.fecha >= p_desde)
           AND (p_hasta IS NULL OR c.fecha <= p_hasta)
      ) t
    ), '[]'::json)
  END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_conteos(date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_conteos(date, date) TO authenticated, service_role;


-- ── Una bolsa no nace: se guarda ───────────────────────────────────────────
--
-- «nació? que es un bebé?» (usuario, 2026-08-26). La nota decía «Nació al
-- confirmarse el corte», y el rótulo de esa misma línea ya dice «Se guardó»:
-- la metáfora no agregaba nada y sonaba a otra cosa. Es la voz del portal —
-- se habla del dinero, no del sistema que lo anota.
CREATE OR REPLACE FUNCTION public.crear_bolsa_al_confirmar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_monto numeric;
    v_bolsa public.bolsas;
BEGIN
    IF NEW.tipo <> 'C' THEN RETURN NEW; END IF;

    IF EXISTS (SELECT 1 FROM public.bolsas b
                WHERE b.corte_id = NEW.id AND b.estado <> 'ANULADA') THEN
        RETURN NEW;
    END IF;

    -- Nunca aborta la confirmacion por no tener nada que guardar.
    v_monto := public.bolsa_sugerida(NEW.id);
    IF v_monto IS NULL OR v_monto <= 0 THEN RETURN NEW; END IF;

    INSERT INTO public.bolsas
        (folio, branch_id, corte_id, origen, monto_inicial, fecha, hora, caja, cerrada_por)
    VALUES
        (public.nuevo_folio_de_bolsa(NEW.branch_id),
         NEW.branch_id, NEW.id, 'CORTE', v_monto,
         NEW.fecha, NEW.hora, NEW.empleado_texto, NEW.resuelto_por)
    RETURNING * INTO v_bolsa;

    INSERT INTO public.bolsas_eventos (bolsa_id, accion, estado_despues, monto, employee_id, nota)
    VALUES (v_bolsa.id, 'CREAR', 'ABIERTA', v_monto, NEW.resuelto_por,
            'Al confirmarse el corte.');

    RETURN NEW;
END;
$function$;

UPDATE public.bolsas_eventos
   SET nota = 'Al confirmarse el corte.'
 WHERE accion = 'CREAR' AND nota = 'Nació al confirmarse el corte.';
