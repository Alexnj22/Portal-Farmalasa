-- Cuando el correo de un contribuyente no se arregla solo, se PIDE.
--
-- Regla del usuario, 2026-08-24: «si aun asi no pasa y es contribuyente, envias
-- una notificacion a la sucursal de la venta solicitando el correo correcto,
-- cuando solventan la solicitud, lo corriges y lo reenvias».
--
-- ── Por que no hizo falta construir el «reenviar» ─────────────────────────
-- Porque ya existe. En cuanto alguien arregla el correo en Clientes,
-- `pushClienteAlErp` lo manda a la ficha del sistema de origen —que es la que
-- viaja a Hacienda— y el barrido de las 22:30 vuelve a transmitir TODA factura
-- sin sello, sin preguntar por que quedo sin el. El lazo se cierra solo: lo
-- unico que faltaba era que alguien se enterara.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.pedir_correo_a_la_sala(
  p_customer_id bigint,
  p_motivo_mh   text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_cliente   text;
  v_branch    bigint;
  v_sala      text;
  v_corr      text;
  v_avisados  integer := 0;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role'
     AND NOT (SELECT public.auth_has_module_permission('facturacion','can_edit')) THEN
    RAISE EXCEPTION 'FORBIDDEN: sin permiso para pedir datos de facturacion';
  END IF;

  SELECT c.name INTO v_cliente FROM public.customers c WHERE c.id = p_customer_id;
  IF v_cliente IS NULL THEN RAISE EXCEPTION 'CLIENTE_NO_EXISTE'; END IF;

  -- La sucursal de la VENTA: la del documento que Hacienda rechazo, no una
  -- «sucursal del cliente», que no existe — un cliente compra en varias salas y
  -- la que puede averiguar el correo es la que lo tuvo enfrente.
  SELECT si.branch_id, si.correlativo INTO v_branch, v_corr
    FROM public.sales_invoices si
   WHERE si.customer_id = p_customer_id
     AND length(si.recibido_mh) IS DISTINCT FROM 40
     AND si.estado NOT IN ('NULA','DTE INVALIDADO EN MH')
   ORDER BY si.fecha DESC, si.hora DESC
   LIMIT 1;

  IF v_branch IS NULL THEN
    RETURN json_build_object('ok', false, 'avisados', 0,
                             'motivo', 'sin factura pendiente que ubique la sala');
  END IF;
  SELECT b.name INTO v_sala FROM public.branches b WHERE b.id = v_branch;

  -- El freno: si ya hay un aviso sin leer por este mismo cliente, no se repite.
  -- La corrida vuelve a detectar el caso cada noche hasta que se resuelva, y un
  -- aviso por persona por noche sobre lo mismo es como se ensena a no mirar la
  -- campana.
  IF EXISTS (SELECT 1 FROM public.notifications n
              WHERE n.type = 'DTE_CORREO_PEDIDO'
                AND n.metadata->>'customer_id' = p_customer_id::text
                AND n.read_at IS NULL) THEN
    RETURN json_build_object('ok', true, 'avisados', 0, 'motivo', 'ya avisado y sin leer');
  END IF;

  WITH destinatarios AS (
    -- La sala que hizo la venta.
    SELECT e.id FROM public.employees e
     WHERE e.branch_id = v_branch AND e.status = 'ACTIVE'
    UNION
    -- Y quien puede editar la ficha, porque las salas hoy no pueden:
    -- `clientes.can_edit` lo tienen Administrador, Gerente General, Jefe/a de
    -- Talento Humano y Supervisor/a de Ventas, y ningun cargo de sala. Avisarle
    -- solo a la sala seria pedirle que resuelva algo que el portal no le deja
    -- hacer — un aviso que no se puede atender ensena a ignorar los avisos.
    SELECT e.id FROM public.employees e
     WHERE e.status = 'ACTIVE'
       AND EXISTS (SELECT 1 FROM public.role_permissions rp
                    WHERE rp.module_key = 'clientes' AND rp.can_edit
                      AND rp.role_id IN (e.role_id, e.secondary_role_id))
  )
  INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata, branch_id)
  SELECT d.id, 'DTE_CORREO_PEDIDO',
         'Falta el correo de un cliente',
         'La venta ' || coalesce(nullif(btrim(v_corr), ''), 'de ' || v_sala) ||
         ' no puede completarse porque el correo de «' || v_cliente ||
         '» no es valido y no se puede corregir solo. Hay que averiguar el correo ' ||
         'correcto y escribirlo en su ficha.',
         '/clientes',
         jsonb_build_object('customer_id', p_customer_id, 'cliente', v_cliente,
                            'correlativo', v_corr, 'sala', v_sala,
                            'motivo_mh', p_motivo_mh),
         v_branch
  FROM destinatarios d;

  GET DIAGNOSTICS v_avisados = ROW_COUNT;

  RETURN json_build_object('ok', true, 'avisados', v_avisados,
                           'sala', v_sala, 'correlativo', v_corr);
END;
$function$;

COMMENT ON FUNCTION public.pedir_correo_a_la_sala(bigint, text) IS
  'Avisa a la sala de la venta (y a quien puede editar clientes) que falta el correo de un contribuyente. No repite mientras el aviso siga sin leer.';

REVOKE EXECUTE ON FUNCTION public.pedir_correo_a_la_sala(bigint, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.pedir_correo_a_la_sala(bigint, text) TO authenticated, service_role;
