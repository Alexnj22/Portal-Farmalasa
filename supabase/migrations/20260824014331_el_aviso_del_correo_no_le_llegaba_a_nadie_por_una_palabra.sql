-- `ACTIVE` no existe: el estado de un empleado es `ACTIVO`.
--
-- La version anterior filtraba `e.status = 'ACTIVE'`. La columna solo admite
-- ACTIVO / INACTIVO / BAJA / LIQUIDADO / SUSPENDIDO (CHECK
-- `chk_employees_status`), asi que el filtro no encontraba a nadie: la funcion
-- devolvia `ok: true, avisados: 0` y no insertaba una sola fila.
--
-- **Un aviso que no le llega a nadie se ve exactamente igual que uno que llego**
-- —el resultado dice `ok`— y esto es justo el circuito que se acaba de arreglar
-- por el mismo motivo: `clientes_por_revisar` llevaba 17 dias recibiendo nada
-- mientras el contador decia que si. Lo cazo probarla contra el caso real antes
-- de darla por buena, que es lo unico que la habria cazado.
--
-- El resto de la base escribe `status = 'ACTIVO'`. Esta era la unica que se lo
-- invento en ingles. Y ahora cero destinatarios devuelve `ok: false`: no es un
-- exito, es un pedido que no le llego a nadie.

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
     WHERE e.branch_id = v_branch AND e.status = 'ACTIVO'
    UNION
    -- Y quien puede editar la ficha, porque las salas hoy no pueden:
    -- `clientes.can_edit` lo tienen Administrador, Gerente General, Jefe/a de
    -- Talento Humano y Supervisor/a de Ventas, y ningun cargo de sala. Avisarle
    -- solo a la sala seria pedirle que resuelva algo que el portal no le deja
    -- hacer — un aviso que no se puede atender ensena a ignorar los avisos.
    SELECT e.id FROM public.employees e
     WHERE e.status = 'ACTIVO'
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

  -- Cero destinatarios NO es un exito: significa que el pedido no le llego a
  -- nadie y el documento se queda trabado sin que nadie lo sepa.
  IF v_avisados = 0 THEN
    RETURN json_build_object('ok', false, 'avisados', 0, 'sala', v_sala,
                             'motivo', 'no se encontro a quien avisarle');
  END IF;

  RETURN json_build_object('ok', true, 'avisados', v_avisados,
                           'sala', v_sala, 'correlativo', v_corr);
END;
$function$;

COMMENT ON FUNCTION public.pedir_correo_a_la_sala(bigint, text) IS
  'Avisa a la sala de la venta (y a quien puede editar clientes) que falta el correo de un contribuyente. No repite mientras el aviso siga sin leer.';

REVOKE EXECUTE ON FUNCTION public.pedir_correo_a_la_sala(bigint, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.pedir_correo_a_la_sala(bigint, text) TO authenticated, service_role;
