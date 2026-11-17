-- Kiosco de caja: lo que la pantalla de inicio necesita saber para sugerir
-- qué toca (pedido del usuario, 2026-11-17: «si no hay apertura que salga
-- para hacerlo»). Sin sesión, con la credencial del equipo, como la cola.
-- Sólo estado, NUNCA montos: quien mira el kiosco sin carné no ve dinero.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.kiosco_caja_estado(p_device_id uuid, p_device_token uuid)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_branch bigint := public.kiosco_sucursal(p_device_id, p_device_token);
  v_ap     public.cortes_caja_aperturas%ROWTYPE;
  v_dia    date;
BEGIN
  IF v_branch IS NULL THEN
    RAISE EXCEPTION 'KIOSK_DEVICE_INVALID';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.kiosk_devices WHERE id = p_device_id AND tipo = 'caja') THEN
    RAISE EXCEPTION 'KIOSK_NO_ES_CAJA';
  END IF;

  SELECT * INTO v_ap
    FROM public.cortes_caja_aperturas a
   WHERE a.branch_id = v_branch AND a.cerrada_at IS NULL
   ORDER BY a.abierta_el DESC, a.turno DESC
   LIMIT 1;

  -- El mismo día que usa `caja_estado`.
  v_dia := coalesce(v_ap.abierta_el, (now() - interval '6 hours')::date);

  RETURN json_build_object(
    'abierta', v_ap.branch_id IS NOT NULL,
    'turno', v_ap.turno,
    'turno_corriendo', CASE WHEN v_ap.branch_id IS NULL THEN false ELSE coalesce(v_ap.turno_corriendo, true) END,
    'dia', v_dia,
    'cerrado', EXISTS (SELECT 1 FROM public.cortes_caja c
                        WHERE c.branch_id = v_branch AND c.fecha = v_dia AND c.tipo = 'Z'),
    'cortes', (SELECT count(*) FROM public.cortes_caja c
                WHERE c.branch_id = v_branch AND c.fecha = v_dia AND c.tipo <> 'Z'));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.kiosco_caja_estado(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kiosco_caja_estado(uuid, uuid) TO anon, authenticated, service_role;
