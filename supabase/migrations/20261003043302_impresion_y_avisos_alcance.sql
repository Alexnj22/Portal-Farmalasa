SET lock_timeout = '5s';

-- Plan de alcance por sucursal, F3 (2026-10-02): la ticketera de otra sala y
-- los avisos al teléfono.

CREATE OR REPLACE FUNCTION public.encolar_impresion(p_branch_id bigint, p_titulo text, p_contenido text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_id bigint; v_pendientes integer; v_bytes bytea;
BEGIN
    IF (SELECT auth_employee_id()) IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    IF p_branch_id IS NULL THEN RAISE EXCEPTION 'Falta decir en que sala se imprime.'; END IF;
    -- Sólo en la ticketera de la PROPIA sala, salvo quien administra la
    -- impresión en toda la red (2026-10-02). Hasta hoy bastaba con ser
    -- empleado para imprimir contenido libre en la caja de cualquier sucursal.
    -- Medido antes: de 2,293 impresiones, el personal de sala imprimió siempre
    -- en la suya.
    IF p_branch_id IS DISTINCT FROM (SELECT public.auth_employee_branch_id())
       AND NOT (SELECT public.auth_can_edit_scope_all(ARRAY['impresion'])) THEN
        RAISE EXCEPTION 'BRANCH_SCOPE_DENIED: sólo puedes imprimir en tu sucursal';
    END IF;

    BEGIN
        v_bytes := decode(coalesce(p_contenido, ''), 'base64');
    EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'El documento vino mal armado y no se puede imprimir.';
    END;

    IF octet_length(v_bytes) = 0 THEN
        RAISE EXCEPTION 'No hay nada que imprimir.';
    END IF;
    IF octet_length(v_bytes) > 60000 THEN
        RAISE EXCEPTION 'Ese documento es demasiado largo para un rollo.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.impresion_dispositivos d
                    WHERE d.branch_id = p_branch_id AND d.activo
                      AND d.vinculada_at IS NOT NULL) THEN
        RAISE EXCEPTION 'Esa sala no tiene una caja registrada para imprimir.';
    END IF;

    SELECT count(*) INTO v_pendientes FROM public.cola_impresion c
     WHERE c.branch_id = p_branch_id AND c.estado IN ('PENDIENTE','IMPRIMIENDO');
    IF v_pendientes >= 50 THEN
        RAISE EXCEPTION 'Esa caja tiene % documentos esperando: parece que la impresora no esta respondiendo.', v_pendientes;
    END IF;

    INSERT INTO public.cola_impresion (branch_id, titulo, contenido, creado_por)
    VALUES (p_branch_id, left(btrim(p_titulo), 120), v_bytes, (SELECT auth_employee_id()))
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.avisar_a_empleados(p_recipients uuid[], p_type text, p_title text, p_body text DEFAULT ''::text, p_link text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb, p_push boolean DEFAULT false, p_branch_id integer DEFAULT NULL::integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  -- Los tipos que `src/utils/notify.js` emite hoy vía `notifyEmployees`. Si
  -- aparece uno nuevo en el navegador, va acá — y que haya que agregarlo es el
  -- punto: un tipo nuevo pasa por una decisión y no por descuido.
  TIPOS constant text[] := ARRAY['REQUEST_DECIDED','REQUEST_PENDING','MINMAX_DECIDED','SYSTEM'];
  v_actor uuid := public.auth_employee_id();
  v_n     integer := coalesce(array_length(p_recipients, 1), 0);
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: solo un empleado puede emitir un aviso desde el portal';
  END IF;

  IF p_type IS NULL OR NOT (p_type = ANY (TIPOS)) THEN
    RAISE EXCEPTION 'FORBIDDEN: el portal no emite avisos de tipo %', coalesce(p_type, '(vacio)');
  END IF;

  IF v_n > 10 THEN
    RAISE EXCEPTION 'FORBIDDEN: un aviso del portal va a lo sumo a 10 personas (llegaron %)', v_n;
  END IF;

  -- El enlace del aviso es una ruta del PORTAL (2026-10-02). Con título,
  -- texto y enlace libres, cualquier empleado podía mandarle a otro un aviso
  -- push que lo llevara a un sitio de afuera. Medido antes: los 13,534 avisos
  -- de estos tipos tenían enlace interno.
  IF p_link IS NOT NULL AND p_link !~ '^/($|[^/\\])' THEN
    RAISE EXCEPTION 'FORBIDDEN: el enlace de un aviso tiene que ser una ruta del portal';
  END IF;

  -- La tarjeta de una decisión lleva la cara de quien decidió (24-sep). Se
  -- pone ACÁ y no en el navegador: quien decide es el que llama, así que la
  -- firma no se puede escribir a mano, y quien recibe el aviso —una sala— a
  -- veces no tiene a esa persona en su lista y la vería sin nombre.
  IF p_metadata ? 'decision' AND jsonb_typeof(p_metadata->'decision') = 'object' THEN
    p_metadata := jsonb_set(p_metadata, '{decision}',
      (p_metadata->'decision') || jsonb_strip_nulls(jsonb_build_object(
        'quien',      (SELECT e.name FROM public.employees e WHERE e.id = v_actor),
        'quien_id',   v_actor,
        'quien_foto', public.foto_de_empleado(v_actor))));

    -- Y la venta, para que se sepa CUÁL es: cliente, forma de pago y hora
    -- (usuario, 24-sep: «dame más info, no sé cuál es»). Sólo en una decisión.
    IF p_type = 'REQUEST_DECIDED' AND p_metadata->'decision'->>'invoice_id' ~ '^[0-9]+$' THEN
      p_metadata := jsonb_set(p_metadata, '{decision}',
        (p_metadata->'decision') || coalesce((
          SELECT jsonb_strip_nulls(jsonb_build_object(
                   'cliente', nullif(btrim(si.cliente), ''),
                   'pago',    nullif(si.tipo_pago, ''),
                   'hora',    to_char(si.hora, 'HH24:MI')))
            FROM public.sales_invoices si
           WHERE si.id = (p_metadata->'decision'->>'invoice_id')::bigint
             -- Sólo una venta que quien decide puede ver (2026-10-02): su sala,
             -- o facturación en toda la red. Antes copiaba cliente, pago y hora
             -- de CUALQUIER factura con sólo mandar su número.
             AND (si.branch_id = (SELECT public.auth_employee_branch_id())
                  OR ((SELECT public.auth_has_module_permission('facturacion', 'can_view'))
                      AND (SELECT public.auth_module_scope('facturacion')) = 'ALL'))), '{}'::jsonb));
    END IF;
  END IF;

  RETURN public.notify_employees(
    p_recipients, p_type, p_title, p_body, p_link, p_metadata, p_push, p_branch_id);
END;
$function$
;
