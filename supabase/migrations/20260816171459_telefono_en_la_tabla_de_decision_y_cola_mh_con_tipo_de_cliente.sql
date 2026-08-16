-- El teléfono entra a la tabla de decisión, y la cola de Hacienda se puede
-- pintar con el tipo de cliente (2026-08-16).
--
-- Dos cambios que salen del mismo barrido fallido de anoche.
--
-- ── 1 · `fichas_para_corregir_dte` no miraba el teléfono ────────────────────
-- Hacienda rechazó la 0000068683_COF con «Campo #/receptor/telefono no cumple
-- el tamaño mínimo permitido». `clasificar_observacion_mh` la clasifica bien
-- —`campo_ficha = 'phone'`, `accionable = true`— pero esta función sólo admitía
-- distrito/municipio/departamento/dui, así que la ficha NUNCA llegaba a ser
-- candidata: la corrida de fichas informó «3 candidatos» sobre 4 rechazos y el
-- reenvío de la segunda vuelta recibió el mismo rechazo, palabra por palabra.
--
-- Es la trampa de siempre: la vista decía «accionable» y nadie actuaba. Peor
-- todavía, ese mismo `accionable` es el que dispara la segunda vuelta del
-- barrido — o sea que un rechazo sin regla hacía correr las dos funciones
-- encadenadas todas las noches para no cambiar nada.
--
-- ── 2 · La cola de Pendiente MH necesita el tipo de cliente ─────────────────
-- La vista pinta cada documento y quiere decir de qué cliente es: contribuyente
-- o consumidor cambia qué se puede hacer con él (a un contribuyente el circuito
-- automático NO le escribe la ficha, decisión del 2026-08-09).
--
-- No se resuelve embebiendo `customers` en el select del navegador: la policy de
-- esa tabla exige `clientes.can_view` **o** `cotizaciones.can_view`, y quien
-- trabaja Facturación puede no tener ninguna de las dos. PostgREST no falla en
-- ese caso — devuelve la fila con el embed en `null`, o sea «sin categoría»
-- indistinguible de «no tengo permiso para verla». Por eso va como RPC DEFINER
-- con su propia compuerta: o contesta con el dato, o dice que no.

SET lock_timeout = '5s';

-- ── 1 ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fichas_para_corregir_dte()
 RETURNS TABLE(customer_id bigint, name text, erp_id text, categoria text, origen text, campo text, motivo_mh text, puede_escribir boolean, ya_corregido boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH rechazados AS (
    SELECT DISTINCT ON (r.customer_id, r.campo_ficha)
           r.customer_id, r.cliente, r.erp_id, r.categoria,
           r.campo_ficha, r.motivo, r.ultimo_intento
    FROM public.dte_rechazos_vigentes r
    WHERE r.accionable
      -- `phone` se sumó el 2026-08-16. La lista es «qué campos sabe corregir
      -- la corrida de fichas», y tiene que coincidir con las ramas de su tabla
      -- de decisión: un campo de más deja una ficha dando vueltas sin que nadie
      -- la escriba, uno de menos la vuelve invisible para el proceso hecho para
      -- arreglarla — que fue exactamente lo que pasó con el teléfono.
      AND r.campo_ficha IN ('distrito','municipio','departamento','dui','phone')
      AND r.customer_id IS NOT NULL
    ORDER BY r.customer_id, r.campo_ficha, r.ultimo_intento DESC
  )
  SELECT rc.customer_id, rc.cliente, rc.erp_id, rc.categoria,
         'rechazo'::text, rc.campo_ficha, rc.motivo,
         (rc.categoria = 'Consumidor' OR rc.categoria IS NULL),
         EXISTS (
           SELECT 1 FROM public.dte_correcciones_ficha k
           WHERE k.customer_id = rc.customer_id
             AND k.campo IN (rc.campo_ficha, 'ubicacion')
             AND k.created_at < rc.ultimo_intento
         )
  FROM rechazados rc

  UNION ALL

  SELECT c.id, c.name, c.erp_id, c.categoria,
         'sin_distrito'::text, 'distrito'::text, NULL::text,
         true, false
  FROM public.clientes_sin_distrito_corregibles() c
  WHERE NOT EXISTS (SELECT 1 FROM rechazados rc WHERE rc.customer_id = c.id);
$function$;

-- ── 2 ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_pending_mh_invoices(p_branch_id bigint DEFAULT NULL)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v json;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('facturacion','can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN: sin permiso para ver Facturación';
  END IF;

  -- `RETURNS json` + `json_agg` (Patrón C de CLAUDE.md): el tope de 1000 filas
  -- de PostgREST no aplica a un único valor JSON, así que la cola entera viaja
  -- en un viaje y sin bucle de `.range()`. `json_agg`, NUNCA `jsonb_agg` —
  -- jsonb arma el binario completo en memoria y spillea a disco.
  SELECT coalesce(json_agg(to_json(t)), '[]'::json) INTO v FROM (
    SELECT si.id, si.branch_id, si.tipo_documento, si.correlativo,
           si.erp_invoice_id, si.cliente, si.fecha, si.hora, si.total,
           si.estado, si.recibido_mh, si.tipo_pago,
           c.categoria AS cliente_categoria
    FROM public.sales_invoices si
    LEFT JOIN public.customers c ON c.id = si.customer_id
    -- Un sello son 40 caracteres. `IS NOT NULL` daba por buena la cadena
    -- 'undefined' y por eso una factura del 16-may-2025 figuró un año como
    -- confirmada; ésta es la misma definición que usa el barrido nocturno.
    WHERE length(si.recibido_mh) IS DISTINCT FROM 40
    -- `<>` y no `IS DISTINCT FROM`: con `estado` en NULL la comparación da NULL
    -- y la fila queda afuera, que es lo que hacía el filtro del navegador. Esas
    -- facturas no se pierden — son de la pestaña de anuladas/estado nulo.
      AND si.estado <> 'NULA'
      AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
    ORDER BY si.branch_id, si.fecha, si.hora
  ) t;

  RETURN v;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_pending_mh_invoices(bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_pending_mh_invoices(bigint) TO authenticated, service_role;
