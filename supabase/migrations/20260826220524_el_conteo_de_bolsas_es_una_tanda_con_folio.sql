SET lock_timeout = '5s';

-- ── El conteo pasa a ser un HECHO con folio, como el depósito ───────────────
--
-- «el filtro no puede ser por conteos? así como los depósitos de banco? así se
-- ve más ordenado y más estructurado todo» (usuario, 2026-08-26).
--
-- Confirmar una tanda movía N bolsas a CONTADA y no dejaba nada que las uniera:
-- para saber qué se contó el lunes había que adivinar por `contado_at` y
-- agrupar de memoria. Un depósito sí es una fila con folio, monto y firma — y
-- por eso se puede mirar, cuadrar y auditar. El conteo no lo era.
--
-- Y es además donde vive la firma que faltaba: `bolsas.contado_por` dice quién
-- CONTÓ cada bolsa (una por una, puede ser gente distinta), y `cerrado_por` de
-- acá dice quién FIRMÓ la tanda. Son dos actos y hasta hoy sólo se guardaba uno
-- —«yo lo puedo recibir, pero no conté yo ni deposité yo» (usuario)—.
CREATE TABLE IF NOT EXISTS public.bolsas_conteos (
    id             bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    folio          text          NOT NULL UNIQUE,
    fecha          date          NOT NULL,
    cuantas        integer       NOT NULL DEFAULT 0,
    -- Los tres números del cuadre, congelados al firmar. No se derivan al leer
    -- a propósito: son contra lo que se firmó, y el saldo de una bolsa podría
    -- volver a moverse el día que se le anule un vale.
    total_esperado numeric(12,2) NOT NULL DEFAULT 0,
    total_contado  numeric(12,2) NOT NULL DEFAULT 0,
    diferencia     numeric(12,2) NOT NULL DEFAULT 0,
    descuadradas   integer       NOT NULL DEFAULT 0,
    cerrado_por    uuid          REFERENCES public.employees(id),
    cerrado_at     timestamptz   NOT NULL DEFAULT now(),
    created_at     timestamptz   NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.bolsas_conteos IS
    'Una tanda de conteo firmada: el hecho que une las bolsas que se cerraron juntas. cerrado_por es quien FIRMÓ; quién contó cada bolsa vive en bolsas.contado_por.';

ALTER TABLE public.bolsas_conteos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bolsas_conteos_select ON public.bolsas_conteos;
CREATE POLICY bolsas_conteos_select ON public.bolsas_conteos
    FOR SELECT TO authenticated
    USING ((SELECT auth_has_module_permission('bolsas_conteo', 'can_view')));

-- RESTRICTIVE, como en `bolsas`: sin él sería una segunda puerta abierta en vez
-- de un candado (las permisivas se suman con OR).
DROP POLICY IF EXISTS bloqueo_global ON public.bolsas_conteos;
CREATE POLICY bloqueo_global ON public.bolsas_conteos
    AS RESTRICTIVE FOR ALL TO public
    USING ((SELECT auth_no_bloqueado()));

-- No hay policy de INSERT/UPDATE/DELETE: la tanda la escribe `confirmar_conteo`,
-- que es DEFINER. Un conteo que se pudiera escribir desde el navegador no
-- probaría nada.

ALTER TABLE public.bolsas ADD COLUMN IF NOT EXISTS conteo_id bigint
    REFERENCES public.bolsas_conteos(id);
CREATE INDEX IF NOT EXISTS idx_bolsas_conteo ON public.bolsas(conteo_id);


-- ── Confirmar la tanda, ahora con su folio ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.confirmar_conteo(p_ids bigint[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_yo       uuid := (SELECT auth_employee_id());
    v_n        integer := 0;
    r          record;
    v_saldo    numeric;
    v_dif      numeric;
    b          record;
    v_hoy      date := (now() AT TIME ZONE 'America/El_Salvador')::date;
    v_folio    text;
    v_conteo   public.bolsas_conteos;
    v_esperado numeric := 0;
    v_contado  numeric := 0;
    v_desc     integer := 0;
    v_quien    text;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas_conteo'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    -- La cabecera se abre ANTES del recorrido porque cada bolsa necesita su id.
    -- Si al final no se cerró ninguna, el RAISE de abajo tira la transacción
    -- entera y esta fila no queda: un folio sin bolsas sería una tanda que nunca
    -- pasó.
    SELECT 'CNT-' || to_char(v_hoy, 'YYMMDD') || '-' || (count(*) + 1)
      INTO v_folio
      FROM public.bolsas_conteos WHERE fecha = v_hoy;

    INSERT INTO public.bolsas_conteos (folio, fecha, cerrado_por)
    VALUES (v_folio, v_hoy, v_yo)
    RETURNING * INTO v_conteo;

    FOR r IN SELECT * FROM public.bolsas
              WHERE id = ANY(p_ids) AND estado = 'RECIBIDA' AND conteo_marcado IS NOT NULL
              ORDER BY id FOR UPDATE
    LOOP
        IF (SELECT auth_module_scope('bolsas_conteo')) IS DISTINCT FROM 'ALL'
           AND r.branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
            RAISE EXCEPTION 'FORBIDDEN';
        END IF;

        v_saldo := public.bolsa_saldo(r.id);
        v_dif   := round(r.conteo_marcado - v_saldo, 2);

        v_esperado := v_esperado + v_saldo;
        v_contado  := v_contado  + r.conteo_marcado;
        IF abs(v_dif) >= 0.01 THEN v_desc := v_desc + 1; END IF;

        UPDATE public.bolsas
           SET estado      = 'CONTADA',
               contado     = r.conteo_marcado,
               contado_por = r.conteo_marcado_por,   -- quien CONTÓ, no quien confirma
               contado_at  = now(),
               conteo_id   = v_conteo.id,
               conteo_marcado = NULL, conteo_marcado_por = NULL, conteo_marcado_at = NULL,
               -- Una resolución sobre una bolsa que terminó cuadrando explica
               -- algo que no pasó: se borra, foto incluida.
               dif_via      = CASE WHEN abs(v_dif) < 0.01 THEN NULL ELSE dif_via      END,
               dif_causa    = CASE WHEN abs(v_dif) < 0.01 THEN NULL ELSE dif_causa    END,
               dif_por      = CASE WHEN abs(v_dif) < 0.01 THEN NULL ELSE dif_por      END,
               dif_at       = CASE WHEN abs(v_dif) < 0.01 THEN NULL ELSE dif_at       END,
               dif_foto_url = CASE WHEN abs(v_dif) < 0.01 THEN NULL ELSE dif_foto_url END,
               updated_at  = now()
         WHERE id = r.id;

        -- La bitácora nombra a quien CONTÓ esta bolsa, que puede no ser quien
        -- firma la tanda. Sin esto el único nombre del renglón era el del que
        -- apretó «Confirmar», y así es como el rastro termina diciendo que una
        -- sola persona hizo todo.
        SELECT e.name INTO v_quien FROM public.employees e WHERE e.id = r.conteo_marcado_por;

        INSERT INTO public.bolsas_eventos (bolsa_id, accion, estado_antes, estado_despues, monto, employee_id, nota)
        VALUES (r.id, 'CONTAR', 'RECIBIDA', 'CONTADA', v_dif, v_yo,
                CASE WHEN abs(v_dif) < 0.01 THEN 'Cuadró.' ELSE 'No cuadró.' END
                || CASE WHEN v_quien IS NOT NULL THEN ' La contó ' || v_quien || '.' ELSE '' END
                || ' Conteo confirmado en la tanda ' || v_conteo.folio || '.'
                || CASE WHEN abs(v_dif) >= 0.01 AND r.dif_at IS NOT NULL
                        THEN ' La causa ya estaba anotada.' ELSE '' END);

        v_n := v_n + 1;
    END LOOP;

    IF v_n = 0 THEN
        RAISE EXCEPTION 'No hay ninguna bolsa marcada para confirmar.';
    END IF;

    UPDATE public.bolsas_conteos
       SET cuantas        = v_n,
           total_esperado = round(v_esperado, 2),
           total_contado  = round(v_contado, 2),
           diferencia     = round(v_contado - v_esperado, 2),
           descuadradas   = v_desc
     WHERE id = v_conteo.id;

    FOR b IN
        SELECT s.branch_id,
               (SELECT name FROM public.branches WHERE id = s.branch_id) AS sala,
               count(*) AS cuantas,
               sum(s.dif) AS neto,
               string_agg(s.folio || ' ' ||
                          CASE WHEN s.dif < 0 THEN 'faltó ' ELSE 'sobró ' END ||
                          '$' || to_char(abs(s.dif), 'FM999,999,990.00'),
                          ', ' ORDER BY s.folio) AS detalle
          FROM (SELECT bo.branch_id, bo.folio,
                       round(bo.contado - public.bolsa_saldo(bo.id), 2) AS dif
                  FROM public.bolsas bo
                 WHERE bo.id = ANY(p_ids) AND bo.estado = 'CONTADA') s
         WHERE abs(s.dif) >= 0.01
         GROUP BY s.branch_id
    LOOP
        PERFORM public.notify_employees(
            public.destinatarios_de_modulo(b.branch_id::integer, 'bolsas'),
            'bolsa_no_cuadra',
            CASE WHEN b.cuantas = 1 THEN 'Una bolsa no cuadró en el conteo'
                 ELSE b.cuantas || ' bolsas no cuadraron en el conteo' END,
            format('%s · %s.', coalesce(b.sala, 'Sala'), b.detalle),
            '/bolsas?tab=finalizadas',
            jsonb_build_object('branch_id', b.branch_id, 'bolsas', b.cuantas, 'neto', b.neto),
            true,
            b.branch_id::integer
        );
    END LOOP;

    RETURN v_n;
END;
$function$;


-- ── El archivo de tandas, con sus bolsas y sus firmas ──────────────────────
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
               (SELECT e.name FROM public.employees e WHERE e.id = c.cerrado_por) AS cerrado_por,
               (SELECT min(b.fecha) FROM public.bolsas b WHERE b.conteo_id = c.id) AS dia_desde,
               (SELECT max(b.fecha) FROM public.bolsas b WHERE b.conteo_id = c.id) AS dia_hasta,
               -- Quiénes contaron, sin repetir. Es la respuesta a «¿lo conté
               -- yo?» y la razón de que la tanda sea una fila: una tanda la
               -- pueden contar entre varios y firmarla uno solo.
               coalesce((
                 SELECT json_agg(x.name ORDER BY x.name)
                   FROM (SELECT DISTINCT e.name
                           FROM public.bolsas b
                           JOIN public.employees e ON e.id = b.contado_por
                          WHERE b.conteo_id = c.id) x
               ), '[]'::json) AS contaron,
               coalesce((
                 SELECT json_agg(json_build_object('fecha', x.fecha, 'cuantas', x.cuantas, 'contado', x.contado)
                                 ORDER BY x.fecha)
                   FROM (SELECT b.fecha, count(*) AS cuantas, sum(b.contado) AS contado
                           FROM public.bolsas b WHERE b.conteo_id = c.id
                          GROUP BY b.fecha) x
               ), '[]'::json) AS por_dia,
               coalesce((
                 SELECT json_agg(json_build_object(
                          'id', b.id, 'folio', b.folio, 'branch_id', b.branch_id,
                          'fecha', b.fecha, 'hora', b.hora,
                          'contado', b.contado,
                          'esperado', public.bolsa_saldo(b.id),
                          'contado_por', (SELECT e.name FROM public.employees e WHERE e.id = b.contado_por),
                          'dif_via', b.dif_via, 'dif_causa', b.dif_causa,
                          'dif_por', (SELECT e.name FROM public.employees e WHERE e.id = b.dif_por))
                        ORDER BY b.branch_id, b.fecha, b.folio)
                   FROM public.bolsas b WHERE b.conteo_id = c.id
               ), '[]'::json) AS bolsas
          FROM public.bolsas_conteos c
         WHERE (p_desde IS NULL OR c.fecha >= p_desde)
           AND (p_hasta IS NULL OR c.fecha <= p_hasta)
      ) t
    ), '[]'::json)
  END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_conteos(date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_conteos(date, date) TO authenticated, service_role;


-- ── Las tandas que ya pasaron ──────────────────────────────────────────────
--
-- Se reconstruyen del `contado_at`, que es el timestamp de la transacción y por
-- eso es idéntico para todas las bolsas de una misma firma. Quién la firmó sale
-- de `bolsas_eventos`, que es donde ya estaba: la tanda del 21-ago no tiene
-- evento CONTAR —se cerró por otro camino— y su firma queda en NULL en vez de
-- inventarse un nombre.
WITH tandas AS (
    SELECT b.contado_at,
           (b.contado_at AT TIME ZONE 'America/El_Salvador')::date AS dia,
           count(*)                       AS cuantas,
           sum(public.bolsa_saldo(b.id))  AS esperado,
           sum(b.contado)                 AS contado,
           count(*) FILTER (WHERE abs(round(b.contado - public.bolsa_saldo(b.id), 2)) >= 0.01) AS descuadradas,
           -- `contado_at` y el `created_at` del evento son el MISMO sello: los
           -- escribe `now()` dentro de una transacción. Verificado sobre las
           -- tres tandas reales antes de escribir esto.
           (SELECT ev.employee_id FROM public.bolsas_eventos ev
             WHERE ev.accion = 'CONTAR' AND ev.estado_despues = 'CONTADA'
               AND ev.created_at = b.contado_at
             LIMIT 1) AS cerrado_por
      FROM public.bolsas b
     WHERE b.estado = 'CONTADA' AND b.conteo_id IS NULL AND b.contado_at IS NOT NULL
     GROUP BY b.contado_at
), numeradas AS (
    SELECT t.*, row_number() OVER (PARTITION BY t.dia ORDER BY t.contado_at) AS n
      FROM tandas t
), insertadas AS (
    INSERT INTO public.bolsas_conteos
        (folio, fecha, cuantas, total_esperado, total_contado, diferencia, descuadradas, cerrado_por, cerrado_at)
    SELECT 'CNT-' || to_char(n.dia, 'YYMMDD') || '-' || n.n,
           n.dia, n.cuantas, round(n.esperado, 2), round(n.contado, 2),
           round(n.contado - n.esperado, 2), n.descuadradas, n.cerrado_por, n.contado_at
      FROM numeradas n
    RETURNING id, cerrado_at
)
UPDATE public.bolsas b
   SET conteo_id = i.id
  FROM insertadas i
 WHERE b.estado = 'CONTADA' AND b.conteo_id IS NULL AND b.contado_at = i.cerrado_at;
