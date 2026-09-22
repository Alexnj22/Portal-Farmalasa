-- Protección de datos · El plazo de una solicitud AVISA solo.
--
-- La Ley (Art. 20) da 20 días hábiles para responderle a una persona sobre sus
-- propios datos, 40 si se prorroga. El portal ya contaba el plazo y pintaba
-- cuáles apremian… **en la pantalla**. O sea que la alarma esperaba a que
-- alguien abriera la vista, que es el patrón que este proyecto ya pagó caro: si
-- nadie entra, el plazo se vence sin que nadie se entere y no hay error que lo
-- delate. Hoy son 3 solicitudes; el día que sean treinta, la pantalla no
-- alcanza.
--
-- Dos avisos por solicitud y una sola vez cada uno: cuando entra en los últimos
-- 3 días hábiles («apremia») y cuando se pasa («vencida»). La marca vive en su
-- propia tabla y no en `notifications` — preguntarle a la campana «¿ya avisé?»
-- hace que quien la vacía lo reciba de nuevo.
--
-- ⚠️ La cuenta de días hábiles de acá cuenta desde la FECHA del acuse, y la de
-- la pantalla (`diasHabilesEntre`, en JavaScript) desde su HORA. Cuando
-- difieren, ésta cuenta UN día de más — nunca de menos. Es a propósito y es la
-- única dirección aceptable: el aviso llega antes, jamás después. La pantalla
-- sigue siendo la que manda sobre el número que se muestra.
--
-- Probado con rollback sobre producción: con una solicitud recibida hace 25
-- días, la primera corrida avisó a las 4 personas con permiso de edición
-- («vence en 3 día(s) hábil(es)») y la segunda no repitió.
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.solicitudes_datos_avisos (
  solicitud_id  uuid NOT NULL REFERENCES public.solicitudes_datos(id) ON DELETE CASCADE,
  etapa         text NOT NULL CHECK (etapa IN ('apremia', 'vencida')),
  destinatarios integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (solicitud_id, etapa)
);
COMMENT ON TABLE public.solicitudes_datos_avisos IS
  'Marca de «ya se avisó» del plazo de una solicitud de datos personales. La escribe avisar_solicitudes_datos_por_vencer(). No se purga: es la evidencia de que el plazo se vigiló, y las solicitudes tampoco se purgan.';

ALTER TABLE public.solicitudes_datos_avisos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS solicitudes_datos_avisos_select ON public.solicitudes_datos_avisos;
CREATE POLICY solicitudes_datos_avisos_select ON public.solicitudes_datos_avisos
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('datos_personales', 'can_view')));
REVOKE ALL ON public.solicitudes_datos_avisos FROM anon;

CREATE INDEX IF NOT EXISTS idx_solicitudes_datos_avisos_solicitud
  ON public.solicitudes_datos_avisos (solicitud_id);

CREATE OR REPLACE FUNCTION public.avisar_solicitudes_datos_por_vencer()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_dest  uuid[];
  v_fila  record;
  v_n     integer := 0;
  v_total integer := 0;
BEGIN
  -- Quien puede resolverla: edita el módulo de datos personales.
  SELECT array_agg(DISTINCT e.id) INTO v_dest
    FROM public.employees e
   WHERE e.status = 'ACTIVO'
     AND EXISTS (SELECT 1 FROM public.role_permissions rp
                  WHERE rp.role_id IN (e.role_id, e.secondary_role_id)
                    AND rp.module_key = 'datos_personales' AND rp.can_edit);

  FOR v_fila IN
    WITH viva AS (
      SELECT s.id, s.folio_txt, s.solicitante_nombre, s.recibida_at,
             CASE WHEN s.prorrogada_at IS NOT NULL THEN 40 ELSE 20 END AS total,
             -- Días hábiles desde el acuse: lunes a viernes, sin descontar
             -- asuetos. Es la MISMA regla del portal, y por el mismo motivo:
             -- sin una tabla de asuetos mantenida, descontarlos daría un plazo
             -- más largo que el real.
             (SELECT count(*) FROM generate_series(s.recibida_at::date + 1, CURRENT_DATE, interval '1 day') d
               WHERE extract(isodow FROM d) < 6) AS usados
        FROM public.solicitudes_datos s
       WHERE s.recibida_at IS NOT NULL
         AND s.estado NOT IN ('RESUELTA', 'ANULADA')
    )
    SELECT v.*, (v.total - v.usados) AS restan,
           CASE WHEN v.total - v.usados < 0 THEN 'vencida' ELSE 'apremia' END AS etapa
      FROM viva v
     WHERE v.total - v.usados <= 3
       AND NOT EXISTS (
             SELECT 1 FROM public.solicitudes_datos_avisos a
              WHERE a.solicitud_id = v.id
                AND a.etapa = CASE WHEN v.total - v.usados < 0 THEN 'vencida' ELSE 'apremia' END)
     ORDER BY v.total - v.usados
  LOOP
    v_n := 0;
    IF v_dest IS NOT NULL AND array_length(v_dest, 1) > 0 THEN
      v_n := public.notify_employees(
        v_dest, 'DATOS_PLAZO',
        CASE WHEN v_fila.etapa = 'vencida'
             THEN 'Se venció el plazo de una solicitud de datos'
             ELSE 'Una solicitud de datos vence en ' || v_fila.restan || ' día(s) hábil(es)' END,
        'Solicitud ' || coalesce(v_fila.folio_txt, '(sin folio)')
          || ' de ' || coalesce(v_fila.solicitante_nombre, 'una persona')
          || CASE WHEN v_fila.etapa = 'vencida'
                  THEN '. La ley da ' || v_fila.total || ' días hábiles desde el acuse y ya pasaron '
                       || v_fila.usados || '.'
                  ELSE '. Quedan ' || v_fila.restan || ' de los ' || v_fila.total
                       || ' días hábiles que da la ley.' END,
        '/solicitudes-datos',
        jsonb_build_object('solicitud_id', v_fila.id, 'etapa', v_fila.etapa,
                           'check_key', 'datos_plazo:' || v_fila.id || ':' || v_fila.etapa),
        true, NULL);
    ELSE
      -- Nadie con el permiso: queda en la bitácora como crítico en vez de
      -- perderse. Un plazo legal sin destinatario es peor que uno sin aviso.
      INSERT INTO public.audit_logs (action, target_id, user_name, source, severity, details)
      VALUES ('DATOS_PLAZO_SIN_DESTINATARIOS', v_fila.id::text, 'Vigilante', 'SYSTEM', 'CRITICAL',
              jsonb_build_object('folio', v_fila.folio_txt, 'etapa', v_fila.etapa,
                                 'restan', v_fila.restan));
    END IF;

    -- La marca se escribe SIEMPRE, aunque no le haya llegado a nadie: si no, el
    -- mismo aviso se reintentaría cada día para siempre.
    INSERT INTO public.solicitudes_datos_avisos (solicitud_id, etapa, destinatarios)
    VALUES (v_fila.id, v_fila.etapa, coalesce(v_n, 0))
    ON CONFLICT (solicitud_id, etapa) DO NOTHING;

    v_total := v_total + coalesce(v_n, 0);
  END LOOP;

  RETURN v_total;
END;
$function$;

REVOKE ALL ON FUNCTION public.avisar_solicitudes_datos_por_vencer() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.avisar_solicitudes_datos_por_vencer() TO service_role;

-- 08:10 SV, cinco minutos después del aviso de Hacienda: las dos alarmas de la
-- mañana juntas, y ninguna pisa a la otra.
SELECT cron.schedule('avisar-plazo-datos-8am-sv', '10 14 * * *',
                     $$SELECT public.avisar_solicitudes_datos_por_vencer();$$);
