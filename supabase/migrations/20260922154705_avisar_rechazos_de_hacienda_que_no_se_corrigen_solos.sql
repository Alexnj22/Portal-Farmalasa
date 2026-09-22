-- Un documento que Hacienda rechaza y el envío automático no puede corregir se
-- AVISA a quien lo puede resolver, una vez por documento.
--
-- Pasó del 7 al 22 de septiembre: la CCF 65 de Salud 2 (crédito fiscal a un
-- consumidor sin NRC) y la factura 62982 de La Popular (un total que no cuadra
-- al centavo) quedaron rechazadas todas las noches. El aviso que existía,
-- `alertar_barrido_dte`, salió 16 días seguidos —«el barrido de Hacienda
-- terminó con fallas»— a UNA sola persona, del rol técnico, que estaba de
-- vacaciones: 16 avisos, 0 leídos. La pestaña Pendiente MH los mostraba, pero
-- sólo a quien la abriera.
--
-- Decisión del usuario el 2026-09-22: un aviso diario, una vez por documento,
-- a quien tenga permiso de Facturación, cuando el documento lleve más de 2 días
-- rechazado. Si sigue rechazado después de dos noches, el circuito ya intentó
-- corregirlo (la corrida de fichas y la segunda vuelta son de la MISMA noche) y
-- no pudo: eso es «un motivo que el circuito no corrige», medido por el
-- resultado y no por una lista de motivos que se desactualiza.
--
-- La marca vive en su propia tabla y no en `notifications`: preguntar «¿ya
-- tiene el aviso?» a la campana hace que quien la vacía lo reciba de nuevo.
-- Sin FK a `sales_invoices` a propósito: crearla toma un lock sobre una tabla
-- caliente, y una marca no necesita integridad referencial.
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.dte_rechazos_avisados (
  invoice_id    bigint PRIMARY KEY,
  destinatarios integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.dte_rechazos_avisados IS
  'Marca de «ya se avisó» de un documento rechazado por Hacienda que el envío automático no corrige. La escribe avisar_rechazos_sin_arreglo(); se purga a los 180 días (si el documento sigue rechazado, se vuelve a avisar).';

ALTER TABLE public.dte_rechazos_avisados ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dte_rechazos_avisados_select ON public.dte_rechazos_avisados;
CREATE POLICY dte_rechazos_avisados_select ON public.dte_rechazos_avisados
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('facturacion', 'can_view')));
REVOKE ALL ON public.dte_rechazos_avisados FROM anon;

CREATE OR REPLACE FUNCTION public.avisar_rechazos_sin_arreglo()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_dest   uuid[];
  v_ids    bigint[];
  v_lista  text;
  v_cuantos integer;
  v_n      integer := 0;
  v_titulo text;
BEGIN
  -- Retención de la marca (regla 7 de CLAUDE.md).
  DELETE FROM public.dte_rechazos_avisados
   WHERE created_at < now() - interval '180 days';

  -- Quien lo puede resolver: edita Facturación y ve Pendiente MH, que es
  -- adonde lleva el aviso. Cargo principal o secundario.
  SELECT array_agg(DISTINCT e.id) INTO v_dest
    FROM public.employees e
   WHERE e.status = 'ACTIVO'
     AND EXISTS (SELECT 1 FROM public.role_permissions rp
                  WHERE rp.role_id IN (e.role_id, e.secondary_role_id)
                    AND rp.module_key = 'facturacion' AND rp.can_edit)
     AND EXISTS (SELECT 1 FROM public.role_permissions rp
                  WHERE rp.role_id IN (e.role_id, e.secondary_role_id)
                    AND rp.module_key = 'facturacion_tab_pendiente_mh' AND rp.can_view);

  -- Los documentos: rechazo vigente, sin sello VÁLIDO (40 caracteres: ver la
  -- regla del tipo en CLAUDE.md), no anulados, con más de 2 días, sin avisar.
  WITH nuevos AS (
    SELECT DISTINCT ON (si.id)
           si.id, b.name AS sala, si.tipo_documento, si.correlativo, si.fecha, si.total
      FROM public.dte_rechazos_vigentes r
      JOIN public.sales_invoices si ON si.id = r.invoice_id
      JOIN public.branches b ON b.id = si.branch_id
     WHERE si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
       AND length(si.recibido_mh) IS DISTINCT FROM 40
       AND si.fecha <= current_date - 2
       AND NOT EXISTS (SELECT 1 FROM public.dte_rechazos_avisados a WHERE a.invoice_id = si.id)
     ORDER BY si.id
  )
  SELECT count(*),
         array_agg(id ORDER BY fecha, id),
         string_agg(sala || ' · '
                    || CASE WHEN tipo_documento = 'CCF' THEN 'crédito fiscal ' ELSE 'factura ' END
                    || coalesce(nullif(ltrim(split_part(correlativo, '_', 1), '0'), ''), correlativo)
                    || ' · $' || to_char(total, 'FM999999990.00')
                    || ' (' || to_char(fecha, 'DD/MM') || ')',
                    '  ·  ' ORDER BY fecha, id)
    INTO v_cuantos, v_ids, v_lista
    FROM nuevos;

  IF coalesce(v_cuantos, 0) = 0 THEN RETURN 0; END IF;

  v_titulo := CASE WHEN v_cuantos = 1
                   THEN 'Hacienda rechaza un documento que no se corrige solo'
                   ELSE 'Hacienda rechaza ' || v_cuantos || ' documentos que no se corrigen solos' END;

  IF v_dest IS NOT NULL AND array_length(v_dest, 1) > 0 THEN
    v_n := public.notify_employees(
      v_dest, 'DTE_RECHAZO', v_titulo,
      v_lista || '. El envío automático ya lo intentó y no puede corregirlos: '
              || 'hay que resolverlos en Facturación, Pendiente MH.',
      '/facturacion?tab=pendiente_mh',
      jsonb_build_object('invoice_ids', v_ids), true, NULL);
  ELSE
    -- Nadie con el permiso: queda en la bitácora como crítico en vez de perderse.
    INSERT INTO public.audit_logs (action, target_id, user_name, source, severity, details)
    VALUES ('DTE_RECHAZO_SIN_DESTINATARIOS', 'avisar_rechazos_sin_arreglo', 'Vigilante', 'SYSTEM',
            'CRITICAL', jsonb_build_object('invoice_ids', v_ids));
  END IF;

  -- La marca se escribe SIEMPRE, aunque no le haya llegado a nadie: si no, el
  -- mismo aviso se reintentaría cada día para siempre. Cuántos lo recibieron
  -- queda guardado.
  INSERT INTO public.dte_rechazos_avisados (invoice_id, destinatarios)
  SELECT unnest(v_ids), coalesce(v_n, 0)
  ON CONFLICT (invoice_id) DO NOTHING;

  RETURN coalesce(v_n, 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.avisar_rechazos_sin_arreglo() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.avisar_rechazos_sin_arreglo() TO service_role;

-- 08:05 SV, cinco minutos después de `alerta-barrido-dte-8am-sv`: con la
-- corrida de la noche ya contada.
SELECT cron.schedule('avisar-rechazos-mh-8am-sv', '5 14 * * *',
                     $$SELECT public.avisar_rechazos_sin_arreglo();$$);
