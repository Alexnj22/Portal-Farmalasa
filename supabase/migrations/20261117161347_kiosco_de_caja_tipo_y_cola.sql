-- Kiosco de caja, fase 1 (docs/PLAN-KIOSCO-DE-CAJA-2026-11-17.md).
--
-- 1. `kiosk_devices.tipo`: 'marcacion' (los de hoy) o 'caja'. Tope por tipo,
--    decidido por el usuario el 2026-11-17: hasta 3 marcadores y 1 caja por
--    sucursal. El tope ahora también vigila el UPDATE: reactivar un equipo
--    revocado o cambiarle el tipo pasaba sin contar.
-- 2. `kiosco_caja_cola`: la cola de preventas que esperan cobro en la sucursal
--    del equipo. Sólo lectura, sólo un kiosco de CAJA (un marcador no la ve).
--    RETURNS json: no cae bajo el techo de las 1000 filas.
SET lock_timeout = '5s';

ALTER TABLE public.kiosk_devices
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'marcacion';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kiosk_devices_tipo_check') THEN
    ALTER TABLE public.kiosk_devices
      ADD CONSTRAINT kiosk_devices_tipo_check CHECK (tipo IN ('marcacion', 'caja'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.kiosk_devices_tope()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_tope int := CASE NEW.tipo WHEN 'caja' THEN 1 ELSE 3 END;
BEGIN
  IF NEW.status = 'ACTIVE'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'ACTIVE' OR OLD.tipo IS DISTINCT FROM NEW.tipo) THEN
    PERFORM pg_advisory_xact_lock(hashtext('kiosk_devices_tope'), NEW.branch_id::int);
    IF (SELECT count(*) FROM public.kiosk_devices
         WHERE branch_id = NEW.branch_id AND status = 'ACTIVE' AND tipo = NEW.tipo
           AND id IS DISTINCT FROM NEW.id) >= v_tope THEN
      RAISE EXCEPTION '%', CASE NEW.tipo
          WHEN 'caja' THEN 'Límite alcanzado: esta sucursal ya tiene su kiosco de caja.'
          ELSE 'Límite alcanzado: ya hay 3 marcadores activos en esta sucursal.' END
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_kiosk_devices_tope ON public.kiosk_devices;
CREATE TRIGGER trg_kiosk_devices_tope
  BEFORE INSERT OR UPDATE OF status, tipo ON public.kiosk_devices
  FOR EACH ROW EXECUTE FUNCTION public.kiosk_devices_tope();

CREATE OR REPLACE FUNCTION public.kiosco_caja_cola(p_device_id uuid, p_device_token uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_branch bigint := public.kiosco_sucursal(p_device_id, p_device_token);
BEGIN
  IF v_branch IS NULL THEN
    RAISE EXCEPTION 'KIOSK_DEVICE_INVALID';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.kiosk_devices WHERE id = p_device_id AND tipo = 'caja') THEN
    RAISE EXCEPTION 'KIOSK_NO_ES_CAJA';
  END IF;

  UPDATE public.kiosk_devices SET last_active_at = now()
   WHERE id = p_device_id AND (last_active_at IS NULL OR last_active_at < now() - interval '1 minute');

  RETURN (
    SELECT coalesce(json_agg(to_json(t) ORDER BY t.enviada_at), '[]'::json)
      FROM (
        SELECT p.id,
               p.externo_ref                     AS referencia,
               p.venta->>'codigo'                AS codigo,
               p.estado,
               p.origen,
               p.total,
               p.enviada_at,
               p.venta->>'documento'             AS documento,
               p.venta->>'pago'                  AS pago,
               coalesce((p.venta->>'puntos')::int, 0) AS puntos,
               CASE WHEN coalesce((p.venta->'cliente'->>'generico')::boolean, false) OR c.id IS NULL
                    THEN NULL ELSE c.name END    AS cliente,
               e.id                              AS vendedor_id,
               e.name                            AS vendedor,
               (SELECT coalesce(json_agg(json_build_object(
                         'nombre', r->>'nombre',
                         'cantidad', (r->>'cantidad')::numeric,
                         'subtotal', (r->>'subtotal')::numeric)), '[]'::json)
                  FROM jsonb_array_elements(coalesce(p.venta->'renglones', '[]'::jsonb)) r) AS renglones
          FROM public.preventas p
          LEFT JOIN public.customers c ON c.id = p.customer_id
          LEFT JOIN public.employees e ON e.id = p.enviada_por
         WHERE p.branch_id = v_branch
           AND p.sistema = 'caja'
           AND p.estado IN ('viva', 'sin_enlace', 'enviando')
         ORDER BY p.enviada_at
         LIMIT 60
      ) t
  );
END;
$function$;

-- La cola cambia a cada envío: el kiosco la pide seguido, que sea barata.
CREATE INDEX IF NOT EXISTS idx_preventas_cola_de_caja
  ON public.preventas (branch_id, enviada_at)
  WHERE estado IN ('viva', 'sin_enlace', 'enviando');

REVOKE EXECUTE ON FUNCTION public.kiosco_caja_cola(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kiosco_caja_cola(uuid, uuid) TO anon, authenticated, service_role;
