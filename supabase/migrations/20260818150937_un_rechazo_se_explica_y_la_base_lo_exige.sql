SET lock_timeout = '5s';

-- Un rechazo se explica — y lo exige la BASE, no sólo la pantalla.
--
-- Ya existía `validar_rechazo_traslado`, que obliga a los traslados a elegir un
-- motivo de su catálogo. El resto de las familias no tenía nada: el motivo era
-- obligatorio en la pantalla y `approver_note` seguía siendo nullable, así que
-- cualquier camino que no pasara por ese botón cerraba la solicitud sin decir
-- por qué. Y había dos que hacían exactamente eso —el cambio de fechas de
-- vacaciones y el turno declarado de la auditoría de tiempos—: resolvían de un
-- clic y no escribían el campo. El empleado veía «rechazada» y no había forma de
-- saber la razón, ni preguntando a la base.
--
-- «Una validación que solo existe en la pantalla es una sugerencia» ya estaba
-- escrito en `src/data/traslados.js` para el catálogo de motivos. Esto es la
-- misma regla, aplicada a la pregunta anterior: que HAYA motivo.
--
-- El motivo puede venir en DOS campos y los dos valen:
--   · `approver_note`             — texto libre, el caso general
--   · `metadata.rejection_reason` — el motivo elegido de un catálogo (traslado)
-- Exigir `approver_note` a secas habría roto el traslado, cuyo texto libre es
-- opcional a propósito: el motivo ya está del otro lado.
--
-- Sólo corre en la TRANSICIÓN a rechazada. Las filas ya rechazadas no se tocan
-- —hay seis sin motivo, del tiempo en que no se pedía— y un UPDATE posterior
-- sobre una de ellas no debe rebotar por una regla que no existía cuando se
-- escribió.
--
-- Verificado en el branch `staging` antes de aplicarlo acá: rebota sin motivo,
-- rebota con sólo espacios, acepta el motivo que viene en `rejection_reason`
-- sin nota, y no afecta a las aprobaciones.
CREATE OR REPLACE FUNCTION public.validar_rechazo_con_motivo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    m        jsonb := coalesce(NEW.metadata, '{}'::jsonb);
    v_nota   text  := nullif(btrim(coalesce(NEW.approver_note, '')), '');
    v_motivo text  := nullif(btrim(coalesce(m->>'rejection_reason', '')), '');
BEGIN
    IF NEW.status <> 'REJECTED' OR OLD.status = 'REJECTED' THEN RETURN NEW; END IF;

    IF v_nota IS NULL AND v_motivo IS NULL THEN
        RAISE EXCEPTION 'Una solicitud se rechaza con motivo: escribí por qué.';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.validar_rechazo_con_motivo() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_validar_rechazo_con_motivo ON public.approval_requests;
CREATE TRIGGER trg_validar_rechazo_con_motivo
    BEFORE UPDATE OF status ON public.approval_requests
    FOR EACH ROW EXECUTE FUNCTION public.validar_rechazo_con_motivo();

-- ── Min/Max vive en otra tabla y se rechaza por su propia función ──────────
-- `minmax_change_requests` no pasa por `approval_requests`, así que el trigger
-- de arriba no la ve. Su RPC aceptaba `p_note` en NULL por defecto: la pantalla
-- lo exigía y la función no.
CREATE OR REPLACE FUNCTION public.reject_minmax_request(
    p_request_id bigint, p_decided_by text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions'
AS $$
DECLARE r public.minmax_change_requests%ROWTYPE;
BEGIN
  -- p_decided_by se recibe y se IGNORA (F4.2).

  -- Un rechazo se explica. Se comprueba ANTES del UPDATE para no consumir el
  -- candado de `status='pending'` con una llamada que no va a poder cerrar.
  IF nullif(btrim(coalesce(p_note, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Un ajuste de Min/Max se rechaza con motivo: escribí por qué.';
  END IF;

  UPDATE public.minmax_change_requests
  SET status='rejected', decided_by=(SELECT auth.email()), decided_at=now(), decision_note=btrim(p_note)
  WHERE id = p_request_id AND status = 'pending'
  RETURNING * INTO r;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND_OR_NO_PERMISSION';
  END IF;

  RETURN jsonb_build_object('ok', true, 'requested_by_id', r.requested_by_id, 'product_name', r.product_name);
END;
$$;
