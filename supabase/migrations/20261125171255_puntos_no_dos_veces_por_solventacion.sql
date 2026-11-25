-- La venta que solventa a otra no vuelve a dar puntos (2026-11-25).
--
-- Una venta de un mes ya declarado se repone con una venta de hoy
-- (`solventar-venta`). Es la MISMA compra: si la original ya dio puntos, la
-- nueva no da. Si la original no dio, la nueva da, una vez. Regla del usuario:
-- «solo se da la primera vez si ya se dieron».
--
-- La venta nueva se reconoce por su número en la caja (`externo_id`), que la
-- solventación anota ANTES de cobrarla: la factura todavía no existe y el
-- motor corre cada minuto, así que esperar a `nueva_invoice_id` dejaba un hueco.
-- Definición VIVA de `puntos_acumular` + el salto.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.puntos_acumular(p_desde date, p_hasta date, p_margen numeric DEFAULT 0.02, p_tope integer DEFAULT 20000, p_simular boolean DEFAULT true)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_leidas integer := 0; v_nuevas integer := 0; v_puntos bigint := 0;
  v_ya integer := 0; v_sin_ficha integer := 0; v_solventa integer := 0;
  r record; v_lote bigint;
  v_nivel public.puntos_niveles; v_pts integer;
  v_sin_precio jsonb := '[]'::jsonb;
BEGIN
  p_desde := public.puntos_desde_efectivo(p_desde);
  IF p_desde > p_hasta THEN
    RETURN json_build_object('simulado', p_simular, 'desde', p_desde, 'hasta', p_hasta,
      'leidas', 0, 'nuevas', 0, 'puntos', 0, 'ya_tenian_lote', 0, 'sin_ficha', 0,
      'tope_alcanzado', false, 'antes_del_inicio', true);
  END IF;

  FOR r IN
    SELECT * FROM json_to_recordset(
      public.ventas_elegibles_puntos(p_desde, p_hasta, p_margen, p_tope)
    ) AS x(invoice_id bigint, sucursal text, erp_invoice_id text, correlativo text,
           customer_id bigint, cod_vendedor int, total numeric, fecha date, puntos int,
           regla text, rango text, puntos_mayoreo int, sin_precio int, productos_sin_precio bigint[])
  LOOP
    v_leidas := v_leidas + 1;
    IF r.customer_id IS NULL THEN v_sin_ficha := v_sin_ficha + 1; CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.puntos_lote WHERE invoice_id = r.invoice_id) THEN
      v_ya := v_ya + 1; CONTINUE;
    END IF;
    -- La venta que solventa a otra que ya dio puntos: es la misma compra.
    IF EXISTS (
      SELECT 1
        FROM public.solventaciones s
        JOIN public.sales_invoices si ON si.id = r.invoice_id
       WHERE s.estado <> 'cancelada'
         AND s.branch_id = si.branch_id
         AND s.externo_id = si.erp_invoice_id
         AND EXISTS (SELECT 1 FROM public.puntos_lote pl WHERE pl.invoice_id = s.invoice_id)
    ) THEN
      v_solventa := v_solventa + 1; CONTINUE;
    END IF;
    IF r.regla IN ('mayorista', 'personal') THEN
      -- El personal: siempre 1 punto por $1, sin factor de nivel (2026-11-03).
      v_nivel := NULL;
      v_pts := r.puntos;
    ELSE
      -- Desde el 2026-10-24 el nivel se pide CON la fecha de la factura: los
      -- niveles rigen desde `reglas_v2_desde()` (antes, todos en el de entrada).
      v_nivel := public.puntos_nivel_de(public.puntos_compra_12m(r.customer_id, r.fecha, r.invoice_id), r.fecha);
      v_pts := greatest(floor(r.puntos * coalesce(v_nivel.factor, 1))::int, r.puntos);
    END IF;

    v_nuevas := v_nuevas + 1;
    v_puntos := v_puntos + v_pts;
    CONTINUE WHEN p_simular;

    INSERT INTO public.puntos_cuenta (customer_id) VALUES (r.customer_id)
      ON CONFLICT (customer_id) DO NOTHING;

    INSERT INTO public.puntos_lote
      (customer_id, origen, invoice_id, sucursal, puntos, restantes, ganado_el, vence_el, puntos_base, nivel, motivo)
    VALUES (r.customer_id, 'venta', r.invoice_id, r.sucursal, v_pts, v_pts,
            r.fecha, public.puntos_vence_el(r.fecha), r.puntos,
            CASE WHEN r.regla = 'mayorista' THEN NULL ELSE coalesce(v_nivel.clave, 'vip') END,
            nullif(concat_ws('. ',
            CASE r.regla WHEN 'mayorista' THEN 'Cliente Mayorista ' || CASE r.rango WHEN 'rubi' THEN 'Rubí' WHEN 'zafiro' THEN 'Zafiro' WHEN 'diamante' THEN 'Diamante' ELSE 'Jade' END
                           || ': ' || coalesce(r.puntos_mayoreo, 0) || ' pts a precio de mayoreo'
                         WHEN 'personal' THEN 'Personal: 1 punto por $1 en cualquier compra' END,
            -- El producto sin precio que no sumó queda dicho en el lote (2026-11-10).
            CASE WHEN coalesce(r.sin_precio, 0) > 0
                 THEN r.sin_precio || ' producto(s) sin precio no sumaron' END), ''))
    RETURNING id INTO v_lote;

    IF coalesce(r.sin_precio, 0) > 0 THEN
      v_sin_precio := v_sin_precio || jsonb_build_object(
        'invoice_id', r.invoice_id, 'sucursal', r.sucursal, 'documento', r.correlativo,
        'productos', to_jsonb(r.productos_sin_precio), 'puntos', v_pts);
    END IF;

    UPDATE public.puntos_cuenta
       SET saldo = saldo + v_pts, ganados = ganados + v_pts, updated_at = now()
     WHERE customer_id = r.customer_id;
  END LOOP;

  RETURN json_build_object(
    'simulado', p_simular, 'desde', p_desde, 'hasta', p_hasta,
    'leidas', v_leidas, 'nuevas', v_nuevas, 'puntos', v_puntos,
    'ya_tenian_lote', v_ya, 'sin_ficha', v_sin_ficha,
    -- Las que solventan a una venta que ya dio puntos (2026-11-25).
    'solventan_otra', v_solventa,
    'tope_alcanzado', v_leidas >= p_tope,
    -- Las compras que acumularon SIN un producto que no tenía precio: el motor avisa.
    'sin_precio', v_sin_precio
  );
END;
$function$;
