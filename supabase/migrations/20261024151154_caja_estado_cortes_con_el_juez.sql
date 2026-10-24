-- caja_estado: la lista de cortes viaja con las piezas del juez canónico.
-- Sin tk_*/cobros_portal_efectivo, `diferenciaDelCorte` caía a `diferencia_erp`,
-- la cifra cruda del origen (corte 161 de Salud 3: −$970.39 donde el juez dice
-- +$0.01). Se agrega además `diferencia` calculada por `corte_diferencia`.
-- Definición viva del 2026-10-24; único cambio: el SELECT de v_cortes.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.caja_estado(p_branch_id integer)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ap     public.cortes_caja_aperturas%ROWTYPE;
  v_dia    date;
  v_reg    numeric;
  v_quien  text;
  v_cortes json;
  v_pz     json;
BEGIN
  -- Los MISMOS dos frenos que `operar-caja` aplica a la acción `estado`:
  -- mirar la caja es `caja_vales can_view`, y sin alcance ALL sólo la propia.
  IF NOT public.auth_has_module_permission('caja_vales', 'can_view') THEN
    RETURN json_build_object('ok', false,
      'error', 'No tienes permiso para mirar la caja desde el portal.');
  END IF;
  IF public.auth_module_scope('caja_vales') IS DISTINCT FROM 'ALL'
     AND public.auth_employee_branch_id() IS DISTINCT FROM p_branch_id THEN
    RETURN json_build_object('ok', false,
      'error', 'Solo puedes mirar la caja de tu propia sala.');
  END IF;

  SELECT * INTO v_ap
    FROM public.cortes_caja_aperturas a
   WHERE a.branch_id = p_branch_id AND a.cerrada_at IS NULL
   ORDER BY a.abierta_el DESC, a.turno DESC
   LIMIT 1;

  v_dia := coalesce(v_ap.abierta_el, (now() - interval '6 hours')::date);

  -- Las piezas del juez viajan con cada corte: sin ellas `diferenciaDelCorte`
  -- cae a `diferencia_erp`, la cifra cruda del origen. `diferencia` es la del
  -- juez (NULL si el corte no contó el efectivo: «no se contó» no es «cuadró»).
  SELECT coalesce(json_agg(to_json(c) ORDER BY c.hora), '[]'::json) INTO v_cortes
    FROM (SELECT id, tipo, hora, total_declarado, esperado, diferencia_erp, estado,
                 tk_subtotal, tk_vales, tk_total_caja, tk_cobros_credito,
                 cobros_portal_efectivo,
                 CASE WHEN public.corte_no_conto_efectivo(tipo, total_declarado,
                                                          diferencia_erp, tk_total_caja)
                      THEN NULL
                      ELSE public.corte_diferencia(total_declarado, diferencia_erp,
                             tk_total_caja, tk_subtotal, tk_vales, tk_cobros_credito,
                             cobros_portal_efectivo)
                 END AS diferencia
            FROM public.cortes_caja
           WHERE branch_id = p_branch_id AND fecha = v_dia) c;

  IF v_ap.branch_id IS NULL THEN
    RETURN json_build_object(
      'ok', true, 'abierta', false, 'caja', NULL, 'turno', NULL,
      'turno_corriendo', false, 'registrado', NULL, 'apertura', NULL,
      'quien', NULL, 'desde', NULL, 'dia', v_dia, 'cortes', v_cortes,
      'efectivo', NULL, 'efectivo_piezas', NULL, 'frescura_seg', NULL,
      -- Sin apertura viva no hay día que cerrar, y la pantalla no ofrece el
      -- botón. `null` es «no aplica», que no es lo mismo que «no falta nada».
      'falta_por_contar', NULL);
  END IF;

  SELECT e.name INTO v_quien
    FROM public.caja_aperturas_del_portal p
    JOIN public.employees e ON e.id = p.abierta_por
   WHERE p.branch_id = p_branch_id AND p.erp_apertura_id = v_ap.erp_apertura_id;

  -- El «Monto Registrado» del panel, derivado: apertura más las ventas
  -- FINALIZADAS de la fecha, sin entradas ni salidas — así lo arma el origen.
  SELECT round(coalesce(v_ap.monto_apertura, 0)
              + coalesce(sum(s.total), 0), 2) INTO v_reg
    FROM public.sales_invoices s
   WHERE s.branch_id = p_branch_id AND s.fecha = v_dia AND public.venta_valida(s.estado);

  -- Cuánto de eso son BILLETES, y con qué piezas. La cuenta vive en UNA sola
  -- función: `operar-caja` llama a la misma, así que las dos pantallas que
  -- preguntan por el cajón no pueden contestar distinto.
  v_pz := public.caja_efectivo_piezas(p_branch_id, v_dia, coalesce(v_ap.monto_apertura, 0));

  RETURN json_build_object(
    'ok', true,
    'abierta', true,
    'caja', v_ap.caja_erp,
    'turno', v_ap.turno,
    'turno_corriendo', coalesce(v_ap.turno_corriendo, true),
    'registrado', v_reg,
    'apertura', v_ap.monto_apertura,
    'quien', v_quien,
    'desde', v_ap.abierta_a,
    'dia', v_dia,
    'cortes', v_cortes,
    'efectivo', (v_pz->>'efectivo')::numeric,
    'efectivo_piezas', v_pz,
    'frescura_seg', round(extract(epoch FROM now() - v_ap.vista_at)),
    -- Las piezas van ARMADAS: la suma ya se hizo dos líneas arriba y volver a
    -- pedirla duplicaría el trabajo de cada carga de Mi caja.
    'falta_por_contar', public.caja_falta_por_contar(p_branch_id, v_dia, v_pz));
END;
$function$;
