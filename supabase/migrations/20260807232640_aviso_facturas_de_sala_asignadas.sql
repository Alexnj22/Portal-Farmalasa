-- Aviso: llegó una factura que YA es de tu sala.
--
-- Las reglas con `asignacion = 'linea'` —hoy Movistar— traen el número de línea
-- adentro del documento, así que el portal sabe de quién es sin que nadie la
-- reclame. Pero nadie se entera: la factura se queda esperando a que alguien
-- abra el widget. Esto cierra ese hueco.
--
-- ── Por qué es un CRON y no un trigger al insertar ────────────────────────
-- El patrón de la casa es «la notificación nace con el hecho» (trigger AFTER
-- INSERT), y acá NO aplica: el hecho lo produce `sync-purchase-emails-daily`,
-- que corre `0 9 * * *` UTC = **3:00 de la mañana en El Salvador**. Un aviso
-- disparado ahí saldría con la sala cerrada y el push llegaría de madrugada, a
-- un teléfono apagado. La notificación quedaría en la campana, pero el push
-- —que es lo que hace que alguien VAYA a cargarla— se pierde.
--
-- Así que sale a las 08:30 SV, cuando hay gente en turno a quien avisarle.

SET lock_timeout = '5s';

-- ── La marca: una sola vez por documento ────────────────────────────────────
-- Sin esto el cron avisaría lo mismo cada mañana hasta que alguien la tomara.
-- Guarda `destinatarios` a propósito: un 0 quiere decir que el aviso se emitió y
-- no le llegó a nadie, y eso hay que poder verlo — «silencio» no es «éxito».
CREATE TABLE IF NOT EXISTS public.purchase_claim_avisos (
    document_id   bigint PRIMARY KEY REFERENCES public.purchase_dte_documents(id) ON DELETE CASCADE,
    branch_id     bigint NOT NULL REFERENCES public.branches(id),
    destinatarios integer NOT NULL DEFAULT 0,
    avisado_at    timestamptz NOT NULL DEFAULT now(),
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS purchase_claim_avisos_branch_idx
    ON public.purchase_claim_avisos (branch_id);

ALTER TABLE public.purchase_claim_avisos ENABLE ROW LEVEL SECURITY;

-- Sólo lectura, y sólo para quien administra las facturas de compra: es una
-- bitácora de envío. Escribe únicamente la función de abajo, que es DEFINER.
CREATE POLICY purchase_claim_avisos_select ON public.purchase_claim_avisos
    FOR SELECT TO authenticated
    USING (
        (SELECT public.auth_has_module_permission('compras', 'can_view'))
        OR (SELECT public.auth_has_module_permission('facturas_compra', 'can_view'))
    );

COMMENT ON TABLE public.purchase_claim_avisos IS
    'Qué documento de compra ya se avisó a su sala y a cuánta gente le llegó. Existe para que el aviso salga una sola vez por documento.';

-- ── El barrido ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.avisar_facturas_de_sala()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_sala     record;
  v_destinos uuid[];
  v_n        integer;
  v_titulo   text;
  v_cuerpo   text;
  v_total    integer := 0;
BEGIN
  FOR v_sala IN
    WITH nuevas AS (
      -- `DISTINCT ON (d.id)`: si dos reglas por línea llegaran a casar con el
      -- mismo documento, avisarlo dos veces sería avisar de más — y la marca
      -- es por documento, no por regla.
      SELECT DISTINCT ON (d.id)
             d.id, d.monto_total, d.fecha_emision, r.etiqueta, l.branch_id
        FROM public.purchase_dte_documents d
        JOIN public.purchase_claim_rules r
          ON r.activo AND r.asignacion = 'linea'
         AND (r.emisor_nit  IS NULL OR d.emisor_nit = r.emisor_nit)
         AND (r.item_patron IS NULL OR d.items_norm ILIKE '%' || r.item_patron || '%')
        JOIN public.purchase_claim_lines l
          ON l.rule_id = r.id
         AND l.linea   = public.linea_telefonica_de(d.items_text)
       WHERE NOT d.invalidado
         -- Ventana corta: la marca evita repetir, pero sin ventana el PRIMER
         -- barrido avisaría toda la historia de una vez.
         AND d.created_at >= now() - interval '7 days'
         -- Si alguien ya la tomó, no hay nada que avisar.
         AND NOT EXISTS (SELECT 1 FROM public.purchase_dte_claims c
                          WHERE c.document_id = d.id AND c.released_at IS NULL)
         AND NOT EXISTS (SELECT 1 FROM public.purchase_claim_avisos a
                          WHERE a.document_id = d.id)
       ORDER BY d.id, r.orden, r.id
    )
    -- Agrupado por sala: dos facturas el mismo día son UN aviso, no dos pings.
    SELECT branch_id,
           count(*)            AS cuantas,
           array_agg(id)       AS ids,
           string_agg(etiqueta || ' · $' || to_char(monto_total, 'FM999999990.00'),
                      '  ·  ' ORDER BY fecha_emision DESC) AS detalle
      FROM nuevas
     GROUP BY branch_id
  LOOP
    SELECT array_agg(t.employee_id) INTO v_destinos
      FROM public.empleados_en_turno(v_sala.branch_id::integer) t;

    v_titulo := CASE WHEN v_sala.cuantas = 1
                     THEN 'Llegó una factura para cargar'
                     ELSE v_sala.cuantas || ' facturas llegaron para cargar' END;
    v_cuerpo := v_sala.detalle || ' — tomala desde Facturas de mi Sala.';

    IF v_destinos IS NULL THEN
      -- Nadie en turno (feriado, antes de abrir, roster sin publicar). Va a la
      -- sala entera: un aviso que no le llega a nadie es peor que no mandarlo.
      v_n := public.notify_branch(
        v_sala.branch_id::integer, 'FACTURA_SALA', v_titulo, v_cuerpo, '/home',
        jsonb_build_object('document_ids', v_sala.ids, 'en_turno', false), true);
    ELSE
      v_n := public.notify_employees(
        v_destinos, 'FACTURA_SALA', v_titulo, v_cuerpo, '/home',
        jsonb_build_object('document_ids', v_sala.ids, 'en_turno', true), true,
        v_sala.branch_id::integer);
    END IF;

    -- La marca se escribe SIEMPRE, aunque no le haya llegado a nadie: si no,
    -- una sala sin personal activo haría reintentar el mismo aviso cada día
    -- para siempre. Cuántos lo recibieron queda guardado, que es lo que permite
    -- notar el caso en vez de suponerlo.
    INSERT INTO public.purchase_claim_avisos (document_id, branch_id, destinatarios)
    SELECT t.id, v_sala.branch_id, COALESCE(v_n, 0)
      FROM unnest(v_sala.ids) AS t(id)
    ON CONFLICT (document_id) DO NOTHING;

    v_total := v_total + COALESCE(v_n, 0);
  END LOOP;

  RETURN v_total;
END;
$$;

-- La corre el cron, no el navegador: escribe notificaciones y dispara push.
REVOKE EXECUTE ON FUNCTION public.avisar_facturas_de_sala() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.avisar_facturas_de_sala() TO service_role;

COMMENT ON FUNCTION public.avisar_facturas_de_sala() IS
    'Avisa a cada sala las facturas que ya le pertenecen por su línea y todavía nadie tomó. A quien esté en turno; si no hay nadie, a la sala entera.';

-- 08:30 en El Salvador (UTC-6). Después de que abren las salas y muy después
-- del sync de correos, que corre a las 3:00 SV.
SELECT cron.schedule(
    'avisar-facturas-de-sala-0830-sv',
    '30 14 * * *',
    $$ SELECT public.avisar_facturas_de_sala(); $$
);
