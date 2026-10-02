SET lock_timeout = '5s';

-- ════════════════════════════════════════════════════════════════════════════
-- Una salida que sale de la BOLSA y, lo que falta, del CAJÓN (2026-10-02).
--
-- Reportado en Salud 4: una remesa de $150 no se podía entregar. La bolsa de la
-- sala tenía $133.58 —$130 en billetes de $10— y el cajón tenía el resto, pero
-- la regla era «el cajón entra ENTERO o no entra». Pedido del usuario:
--
--   «primero la bolsa y luego de caja. el vale sale 1 solo, y explica de donde
--    salió [...] si se anula se anula de ambas»
--
-- Las dos mitades se escriben en dos lugares distintos —la bolsa en
-- `bolsas_operaciones`, el cajón en `caja_movimientos_portal` y en el sistema de
-- la caja— y lo que las hace UNA salida es esta columna: el movimiento de caja
-- apunta a la operación de bolsa de la que es el resto.
--
-- La anulación no puede ser simétrica y no lo es: anular la parte de la bolsa es
-- inmediato, pero borrar un movimiento de la caja pasa por una corrección
-- aprobada (`CAJA_MOVIMIENTO_CHANGE`). Así que una salida mixta se anula ENTERA
-- por ese camino: al aprobarse, `operar-caja` borra el movimiento de la caja y
-- llama a `anular_salida_de_bolsa_desde_caja`. Anularla directo desde la bolsa
-- dejaría $20 fuera del cajón sin papel que los respalde.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.caja_movimientos_portal
    ADD COLUMN IF NOT EXISTS bolsa_operacion_id bigint
        REFERENCES public.bolsas_operaciones(id);

COMMENT ON COLUMN public.caja_movimientos_portal.bolsa_operacion_id IS
  'Si este movimiento es la parte del cajón de una salida que salió primero de una bolsa: esa operación. Las dos son UNA salida, con un solo vale, y se anulan juntas.';

-- Una operación de bolsa tiene a lo sumo UNA parte de caja viva.
CREATE UNIQUE INDEX IF NOT EXISTS caja_mov_portal_una_parte_por_operacion
    ON public.caja_movimientos_portal (bolsa_operacion_id)
 WHERE bolsa_operacion_id IS NOT NULL AND anulado_at IS NULL;

-- ── El núcleo de la anulación, sin el permiso ──────────────────────────────
-- Lo comparten la anulación de la sala y la que dispara una corrección de caja
-- aprobada. Escrito dos veces, el día que una cambie la otra anularía distinto.
CREATE OR REPLACE FUNCTION public.bolsa_anular_operacion_nucleo(
    p_operacion_id bigint, p_motivo text, p_por uuid)
 RETURNS bolsas_operaciones
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_oper public.bolsas_operaciones;
    r      record;
BEGIN
    IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
        RAISE EXCEPTION 'Anular una salida exige decir por qué.';
    END IF;

    SELECT * INTO v_oper FROM public.bolsas_operaciones WHERE id = p_operacion_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Esa salida no existe.'; END IF;
    IF v_oper.anulada_at IS NOT NULL THEN RAISE EXCEPTION 'Esa salida ya está anulada.'; END IF;

    -- Solo mientras las bolsas sigan en la sala: si ya se entregaron, el dinero
    -- lo tiene otro y la correccion es del conteo, no de aca.
    FOR r IN SELECT b.folio, b.estado FROM public.bolsas_movimientos m
              JOIN public.bolsas b ON b.id = m.bolsa_id
             WHERE m.operacion_id = p_operacion_id AND m.anulado_at IS NULL LOOP
        IF r.estado <> 'ABIERTA' THEN
            RAISE EXCEPTION 'La bolsa % ya salió de la sala: esta salida no se puede anular.', r.folio;
        END IF;
    END LOOP;

    UPDATE public.bolsas_movimientos
       SET anulado_at = now(), anulado_por = p_por, anulado_motivo = btrim(p_motivo)
     WHERE operacion_id = p_operacion_id AND anulado_at IS NULL;

    UPDATE public.bolsas_operaciones
       SET anulada_at = now(), anulada_por = p_por, anulada_motivo = btrim(p_motivo),
           updated_at = now()
     WHERE id = p_operacion_id
     RETURNING * INTO v_oper;

    -- Un intento de parte de caja que nunca llegó a la caja (sin
    -- `erp_movimiento_id`) no movió dinero: se anula con la operación para que
    -- no quede una fila viva apuntando a una salida anulada.
    UPDATE public.caja_movimientos_portal
       SET anulado_at = now(), anulado_por = p_por,
           anulado_motivo = btrim(p_motivo), updated_at = now()
     WHERE bolsa_operacion_id = p_operacion_id
       AND anulado_at IS NULL AND erp_movimiento_id IS NULL;

    INSERT INTO public.bolsas_eventos (bolsa_id, accion, motivo, monto, employee_id, nota)
    SELECT m.bolsa_id, 'ANULAR_SALIDA', btrim(p_motivo), -m.monto, p_por, v_oper.folio
      FROM public.bolsas_movimientos m WHERE m.operacion_id = p_operacion_id;

    RETURN v_oper;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.bolsa_anular_operacion_nucleo(bigint, text, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bolsa_anular_operacion_nucleo(bigint, text, uuid)
    TO service_role;

-- ── La anulación de la sala ────────────────────────────────────────────────
-- Igual que antes, más un freno: si la salida tiene una parte de caja que SÍ
-- llegó a la caja, no se anula desde acá.
CREATE OR REPLACE FUNCTION public.anular_salida_de_bolsa(p_operacion_id bigint, p_motivo text)
 RETURNS bolsas_operaciones
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_oper  public.bolsas_operaciones;
    v_scope text := (SELECT auth_module_scope('bolsas'));
    v_caja  numeric;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    SELECT * INTO v_oper FROM public.bolsas_operaciones WHERE id = p_operacion_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Esa salida no existe.'; END IF;

    IF v_scope IS DISTINCT FROM 'ALL'
       AND v_oper.branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    SELECT c.monto INTO v_caja FROM public.caja_movimientos_portal c
     WHERE c.bolsa_operacion_id = p_operacion_id
       AND c.anulado_at IS NULL AND c.erp_movimiento_id IS NOT NULL
     LIMIT 1;
    IF v_caja IS NOT NULL THEN
        RAISE EXCEPTION 'Esta salida también sacó % de la caja: se anula entera pidiendo la corrección, y al aprobarse se anulan las dos partes.',
            to_char(v_caja, 'FM999,999,990.00');
    END IF;

    RETURN public.bolsa_anular_operacion_nucleo(p_operacion_id, p_motivo, (SELECT auth_employee_id()));
END;
$function$;

-- ── La anulación que dispara una corrección de caja aprobada ───────────────
-- La llama `operar-caja` (service_role) DESPUÉS de borrar el movimiento en la
-- caja. Sin permiso de sala que comprobar: quien aprobó ya pasó por el de
-- `caja_vales`, y el aprobador queda como autor.
CREATE OR REPLACE FUNCTION public.anular_salida_de_bolsa_desde_caja(
    p_operacion_id bigint, p_motivo text, p_por uuid)
 RETURNS bolsas_operaciones
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT public.bolsa_anular_operacion_nucleo(p_operacion_id, p_motivo, p_por);
$function$;

REVOKE EXECUTE ON FUNCTION public.anular_salida_de_bolsa_desde_caja(bigint, text, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anular_salida_de_bolsa_desde_caja(bigint, text, uuid)
    TO service_role;

-- ── ¿Se puede anular? Para preguntarlo ANTES de borrar en la caja ──────────
-- Devuelve el motivo por el que NO, o NULL. Lo consulta `operar-caja` antes de
-- tocar el sistema de la caja: si la bolsa ya se entregó, borrar allá y fallar
-- acá dejaría la salida a medio anular.
CREATE OR REPLACE FUNCTION public.bolsa_operacion_no_anulable(p_operacion_id bigint)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT CASE
        WHEN o.id IS NULL THEN 'Esa salida no existe.'
        WHEN o.anulada_at IS NOT NULL THEN NULL
        ELSE (SELECT 'La bolsa ' || b.folio || ' ya salió de la sala: esta salida no se puede anular.'
                FROM public.bolsas_movimientos m
                JOIN public.bolsas b ON b.id = m.bolsa_id
               WHERE m.operacion_id = o.id AND m.anulado_at IS NULL AND b.estado <> 'ABIERTA'
               LIMIT 1)
    END
      FROM (SELECT p_operacion_id AS pid) p
      LEFT JOIN public.bolsas_operaciones o ON o.id = p.pid;
$function$;

REVOKE EXECUTE ON FUNCTION public.bolsa_operacion_no_anulable(bigint)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bolsa_operacion_no_anulable(bigint) TO service_role;

-- ── El vale dice de dónde salió TODO ───────────────────────────────────────
-- `caja` es la parte del cajón (la viva, o la última anulada si no hay viva).
CREATE OR REPLACE FUNCTION public.get_operacion_de_bolsa(p_operacion_id bigint)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT to_json(x) FROM (
        SELECT o.id, o.folio, o.tipo, t.etiqueta, t.etiqueta_entidad, t.leyenda,
               o.monto, o.entidad, o.numero_boleta, o.nota,
               o.registrado_at, o.recibido_metodo, o.branch_id, o.anulada_at,
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
                  ) l) AS lineas,
               (SELECT to_json(c) FROM (
                    SELECT cm.id AS movimiento_id, cm.monto, cm.erp_movimiento_id,
                           cm.anulado_at, cm.branch_id
                      FROM public.caja_movimientos_portal cm
                     WHERE cm.bolsa_operacion_id = o.id
                     ORDER BY (cm.anulado_at IS NULL) DESC, cm.id DESC
                     LIMIT 1) c) AS caja
          FROM public.bolsas_operaciones o
          JOIN public.bolsas_tipos_salida t ON t.codigo = o.tipo
          LEFT JOIN public.branches  br ON br.id = o.branch_id
          LEFT JOIN public.employees er ON er.id = o.recibido_por
          LEFT JOIN public.employees eq ON eq.id = o.registrado_por
         WHERE o.id = p_operacion_id
           AND (SELECT auth_has_module_permission('bolsas','can_view'))
    ) x;
$function$;

-- Índice para la FK (regla 2): la consulta del vale y la anulación buscan por ella.
-- (Cubierto por el índice único parcial de arriba sólo para las filas vivas.)
CREATE INDEX IF NOT EXISTS caja_mov_portal_bolsa_operacion_idx
    ON public.caja_movimientos_portal (bolsa_operacion_id)
 WHERE bolsa_operacion_id IS NOT NULL;
