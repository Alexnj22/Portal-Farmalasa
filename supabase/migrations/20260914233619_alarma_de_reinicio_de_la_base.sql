SET lock_timeout = '5s';

-- El 10-sep a las 14:31 SV Postgres se cayó de golpe («database system was not
-- properly shut down; automatic recovery in progress») y NADIE se enteró: duró
-- ~2.5 min y ninguna pantalla lo dice. El 14-sep volvió a reiniciarse y la
-- estadística de consultas se perdió con él. Ver docs/INCIDENTE-CAIDA-2026-09-14.md.
--
-- Un renglón por cada arranque visto. No se purga: es un renglón por reinicio,
-- y la lista de reinicios es justo la historia que faltaba.
CREATE TABLE IF NOT EXISTS public.reinicios_de_la_base (
  arranco_at    timestamptz PRIMARY KEY,
  detectado_at  timestamptz NOT NULL DEFAULT now(),
  -- Cuántas personas recibieron el aviso. Un 0 queda escrito a propósito: sin
  -- nadie en el rol de alertas técnicas el aviso no llega, y eso tiene que verse.
  destinatarios integer,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reinicios_de_la_base ENABLE ROW LEVEL SECURITY;

CREATE POLICY bloqueo_global ON public.reinicios_de_la_base
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.auth_no_bloqueado()));

CREATE POLICY reinicios_de_la_base_select ON public.reinicios_de_la_base
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('sync_health', 'can_view')));

REVOKE ALL ON public.reinicios_de_la_base FROM anon;

-- Semilla: el arranque en curso y el del 10-sep, para que la primera corrida no
-- avise de un reinicio que ya se conoce. El del 10-sep va truncado al segundo
-- (así lo reportó `npm run portal:lento`); es historia, no la clave que se compara.
INSERT INTO public.reinicios_de_la_base (arranco_at, destinatarios)
VALUES ('2026-09-10 20:34:11+00', NULL), (pg_postmaster_start_time(), NULL)
ON CONFLICT (arranco_at) DO NOTHING;

CREATE OR REPLACE FUNCTION public.vigilar_reinicio_de_la_base()
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
  v_arranque timestamptz := pg_postmaster_start_time();
  v_dest     uuid[];
BEGIN
  INSERT INTO public.reinicios_de_la_base (arranco_at) VALUES (v_arranque)
  ON CONFLICT (arranco_at) DO NOTHING;
  -- Ya anotado: es el mismo arranque de la corrida anterior.
  IF NOT FOUND THEN RETURN; END IF;

  -- Mismo destinatario que check-sync-health-alerts: el rol de alertas técnicas,
  -- como cargo principal o secundario, y sólo fichas activas.
  SELECT array_agg(DISTINCT e.id) INTO v_dest
  FROM public.employees e
  JOIN public.roles r ON r.id IN (e.role_id, e.secondary_role_id)
  WHERE r.name = 'Sistema — Alertas Técnicas'
    AND e.status = 'ACTIVO';

  UPDATE public.reinicios_de_la_base
     SET destinatarios = coalesce(cardinality(v_dest), 0)
   WHERE arranco_at = v_arranque;

  IF coalesce(cardinality(v_dest), 0) = 0 THEN RETURN; END IF;

  PERFORM public.notify_employees(
    v_dest,
    'SISTEMA_REINICIO',
    'La base de datos del portal se reinició',
    'Volvió a arrancar a las '
      || to_char(v_arranque AT TIME ZONE 'America/El_Salvador', 'HH24:MI "del" DD/MM')
      || '. Si poco antes el portal estuvo lento o no dejaba entrar, fue esto.',
    '/actualizacion-de-datos',
    jsonb_build_object('arranco_at', v_arranque),
    true,
    NULL);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.vigilar_reinicio_de_la_base() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vigilar_reinicio_de_la_base() TO service_role;

SELECT cron.schedule(
  'vigilar-reinicio-de-la-base',
  '*/5 * * * *',
  $cron$SELECT public.vigilar_reinicio_de_la_base();$cron$
);
