-- Facturas de mi Sala — la reserva vuelve a existir, y la etiqueta nombra todo
-- lo que trae la factura.
--
-- Auditoría del widget del 2026-08-16. Cuatro defectos, y el primero explica por
-- qué la tabla `purchase_dte_claims` tenía CERO filas desde que el módulo se
-- publicó (2026-08-07):
--
--   1. **«Tu usuario no está activo.», siempre.** `reclamar_factura_compra` y
--      `soltar_factura_compra` buscaban al empleado con `e.status = 'ACTIVE'`.
--      El dominio real de esa columna lo fija `chk_employees_status` y es
--      ACTIVO / INACTIVO / BAJA / LIQUIDADO / SUSPENDIDO: las 49 filas de
--      producción dicen `ACTIVO`, así que la comparación no devolvía «este
--      empleado no está activo» — devolvía NINGÚN empleado, para cualquiera.
--      Toda sala que apretó «Es de mi sala» en nueve días recibió ese aviso, y
--      como el error se leía como un problema de la cuenta, nadie lo reportó
--      como defecto del portal. Reproducido en el entorno de pruebas antes de
--      corregirlo, y verificado después: la factura pasa a «Tuyas».
--
--   2. **La etiqueta nombraba una sola cosa.** `DISTINCT ON (d.id) … ORDER BY
--      r.orden` elige la regla de menor orden y su etiqueta era el título de la
--      tarjeta. La factura 5213 de COFARSAL (10/08/26, $662.25) trae 16
--      recargas Tigo de $25 Y 300 de Claro de $1, y se llamaba «Recarga Tigo» a
--      secas: la mitad de lo que la sala está por cargar no figuraba. La regla
--      elegida sigue siendo una —es la que se guarda en el reclamo— pero la
--      etiqueta se arma con TODAS las que casan.
--
--   3. **`mia_linea` no miraba de qué sala era la línea.** Se calculaba con
--      `r.por_linea` a secas, así que un documento atado a la línea de otra
--      sala se anunciaba como «De tu línea».
--
--   4. **Y tomarlo tampoco estaba frenado.** `reclamar_factura_compra`
--      comprobaba que alguna regla habilitara el documento y nada más. Hoy el
--      widget no pide `p_incluir_tomadas`, así que esa fila no llega a
--      pintarse — pero el RPC es llamable por su cuenta, y una sala podía
--      quedarse con la factura de la línea de otra. El criterio que ya usaba la
--      lista ahora también se aplica donde se decide.
--
-- DDL sobre funciones únicamente: no toma lock sobre ninguna tabla caliente.

SET lock_timeout = '5s';

-- ── La etiqueta, completa ───────────────────────────────────────────────────
-- Una sola definición para las dos pantallas: el widget de la sala y el panel
-- de contabilidad. Escrita aparte y no repetida adentro de cada RPC porque el
-- día que se agregue una regla, las dos tienen que decir lo mismo.
CREATE OR REPLACE FUNCTION public.etiquetas_factura_sala(p_emisor_nit text, p_items_norm text)
RETURNS text
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  SELECT string_agg(s.etiqueta, ' · ' ORDER BY s.orden, s.id)
    FROM (
      -- `DISTINCT ON (etiqueta)`: dos reglas que se llamen igual son un solo
      -- rótulo, no dos.
      SELECT DISTINCT ON (r.etiqueta) r.etiqueta, r.orden, r.id
        FROM public.purchase_claim_rules r
       WHERE r.activo
         AND (r.emisor_nit  IS NULL OR p_emisor_nit = r.emisor_nit)
         AND (r.item_patron IS NULL OR p_items_norm ILIKE '%' || r.item_patron || '%')
       ORDER BY r.etiqueta, r.orden, r.id
    ) s;
$$;

REVOKE EXECUTE ON FUNCTION public.etiquetas_factura_sala(text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.etiquetas_factura_sala(text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.etiquetas_factura_sala(text, text) IS
    'Rótulo de un documento para Facturas de Sala: TODAS las reglas activas que casan, no solo la de menor orden. Una factura con recargas Tigo y Claro se llama «Recarga Tigo · Recarga Claro».';

-- ── La lista de la sala ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_facturas_sala(
    p_branch_id bigint,
    p_dias integer DEFAULT 45,
    p_incluir_tomadas boolean DEFAULT false)
RETURNS TABLE (
    document_id       bigint,
    fecha_emision     date,
    etiqueta          text,
    emisor_nombre     text,
    monto_total       numeric,
    items_text        text,
    numero_control    text,
    codigo_generacion text,
    json_path         text,
    pdf_path          text,
    estado            text,
    linea             text,
    claim_id          bigint,
    tomada_por        text,
    tomada_sala       text,
    tomada_at         timestamptz,
    registrada        boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- La guarda va como sentencia propia y no como CTE: un `WITH guarda AS
  -- (SELECT fn())` solo levanta la excepción si el planificador decide ejecutar
  -- esa rama, y un control de acceso no puede depender de eso.
  PERFORM public.facturas_sala_guarda(p_branch_id, 'can_view');

  RETURN QUERY
  WITH
  -- Un documento puede casar con más de una regla (una factura de COFARSAL con
  -- recargas Tigo Y Claro). Se queda con una sola —la de menor `orden`— para no
  -- ofrecer la misma factura dos veces en la lista. Lo que NO se queda con una
  -- sola es la etiqueta: esa las nombra a todas, porque es el título de lo que
  -- la sala está por cargar.
  candidatos AS (
      SELECT DISTINCT ON (d.id)
             d.id, d.fecha_emision, d.emisor_nombre, d.monto_total, d.items_text,
             d.numero_control, d.codigo_generacion, d.json_path, d.pdf_path,
             r.id AS rule_id, r.asignacion,
             COALESCE(public.etiquetas_factura_sala(d.emisor_nit, d.items_norm),
                      r.etiqueta) AS etiqueta,
             public.linea_telefonica_de(d.items_text) AS linea
        FROM public.purchase_dte_documents d
        JOIN public.purchase_claim_rules r
          ON r.activo
         AND (r.emisor_nit  IS NULL OR d.emisor_nit = r.emisor_nit)
         AND (r.item_patron IS NULL OR d.items_norm ILIKE '%' || r.item_patron || '%')
       WHERE NOT d.invalidado
         AND d.fecha_emision >= current_date - p_dias
       ORDER BY d.id, r.orden, r.id
  ),
  -- La línea manda solo si está mapeada. Si Movistar factura una línea que nadie
  -- cargó todavía, el documento NO desaparece: cae al modo reclamo y lo ven
  -- todas. Un documento que no le aparece a nadie es un documento perdido.
  resueltos AS (
      SELECT c.*,
             l.branch_id AS branch_de_linea,
             (c.asignacion = 'linea' AND l.branch_id IS NOT NULL) AS por_linea
        FROM candidatos c
        LEFT JOIN public.purchase_claim_lines l
               ON l.rule_id = c.rule_id AND l.linea = c.linea
  )
  SELECT r.id, r.fecha_emision, r.etiqueta, r.emisor_nombre, r.monto_total,
         r.items_text, r.numero_control, r.codigo_generacion, r.json_path, r.pdf_path,
         CASE
           WHEN cl.id IS NOT NULL AND cl.branch_id = p_branch_id THEN 'mia'
           WHEN cl.id IS NOT NULL                                THEN 'tomada'
           -- `mia_linea` exige que la línea sea DE ESTA SALA. Sin la segunda
           -- mitad, la factura de la línea de otra sala se anunciaba como «De
           -- tu línea» — solo visible con `p_incluir_tomadas`, que hoy el
           -- widget no pide, pero el rótulo estaba mal escrito igual.
           WHEN r.por_linea AND r.branch_de_linea = p_branch_id  THEN 'mia_linea'
           WHEN r.por_linea                                      THEN 'otra_sala'
           ELSE 'disponible'
         END::text,
         r.linea,
         cl.id,
         cl.claimed_by_name,
         b.name,
         cl.claimed_at,
         (cl.receipt_id IS NOT NULL)
    FROM resueltos r
    LEFT JOIN public.purchase_dte_claims cl
           ON cl.document_id = r.id AND cl.released_at IS NULL
    LEFT JOIN public.branches b ON b.id = cl.branch_id
   WHERE (
          -- Ya es mía, por reclamo o porque la línea es de esta sala.
          (cl.id IS NOT NULL AND cl.branch_id = p_branch_id)
          OR (cl.id IS NULL AND r.por_linea AND r.branch_de_linea = p_branch_id)
          -- Libre: nadie la tomó y no está atada a la línea de otra sala.
          OR (cl.id IS NULL AND NOT r.por_linea)
          -- Las de otras salas, solo si se piden. Sirven para responder
          -- «¿por qué no me aparece la mía?» sin llamar a nadie.
          OR (p_incluir_tomadas AND cl.id IS NOT NULL AND cl.branch_id <> p_branch_id)
          OR (p_incluir_tomadas AND cl.id IS NULL AND r.por_linea AND r.branch_de_linea <> p_branch_id)
     )
   ORDER BY r.fecha_emision DESC, r.id DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_facturas_sala(bigint, integer, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_facturas_sala(bigint, integer, boolean) TO authenticated, service_role;

-- ── El panel de contabilidad ────────────────────────────────────────────────
-- Mismo rótulo que ve la sala. Antes leía la etiqueta de la regla GUARDADA en
-- el reclamo, así que las dos pantallas podían nombrar distinto a la misma
-- factura.
CREATE OR REPLACE FUNCTION public.get_facturas_sala_panel(p_dias integer DEFAULT 90)
RETURNS TABLE (
    claim_id        bigint,
    document_id     bigint,
    fecha_emision   date,
    etiqueta        text,
    emisor_nombre   text,
    monto_total     numeric,
    items_text      text,
    sala            text,
    tomada_por      text,
    tomada_at       timestamptz,
    origen          text,
    registrada      boolean,
    dias_sin_cargar integer,
    liberada_at     timestamptz,
    liberada_motivo text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT (public.auth_has_module_permission('facturas_sala', 'can_view')
          OR public.auth_has_module_permission('compras', 'can_view')
          OR public.auth_has_module_permission('facturas_compra', 'can_view')) THEN
    RAISE EXCEPTION 'No tenés permiso para ver este panel.';
  END IF;

  RETURN QUERY
  SELECT c.id, c.document_id, d.fecha_emision,
         COALESCE(public.etiquetas_factura_sala(d.emisor_nit, d.items_norm), r.etiqueta),
         d.emisor_nombre,
         d.monto_total, d.items_text, b.name, c.claimed_by_name, c.claimed_at,
         c.origen, (c.receipt_id IS NOT NULL),
         CASE WHEN c.receipt_id IS NULL AND c.released_at IS NULL
              THEN (current_date - c.claimed_at::date) END,
         c.released_at, c.released_motivo
    FROM public.purchase_dte_claims c
    JOIN public.purchase_dte_documents d ON d.id = c.document_id
    LEFT JOIN public.purchase_claim_rules r ON r.id = c.rule_id
    LEFT JOIN public.branches b ON b.id = c.branch_id
   WHERE c.claimed_at >= now() - make_interval(days => p_dias)
   ORDER BY c.claimed_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_facturas_sala_panel(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_facturas_sala_panel(integer) TO authenticated, service_role;

-- ── Tomar la factura ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reclamar_factura_compra(p_document_id bigint, p_branch_id bigint)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_emp          uuid;
  v_nombre       text;
  v_rule         bigint;
  v_asignacion   text;
  v_linea        text;
  v_branch_linea bigint;
  v_origen       text;
  v_claim        bigint;
BEGIN
  PERFORM public.facturas_sala_guarda(p_branch_id, 'can_edit');

  -- Empleado ACTIVO, resuelto del JWT. Nunca de un parámetro.
  --
  -- `'ACTIVO'`, no `'ACTIVE'`. El valor lo fija `chk_employees_status`
  -- (ACTIVO/INACTIVO/BAJA/LIQUIDADO/SUSPENDIDO), así que `'ACTIVE'` no puede
  -- existir en ninguna fila: la comparación no devolvía «este empleado no está
  -- activo», devolvía NINGÚN empleado, siempre.
  SELECT e.id, e.name INTO v_emp, v_nombre
    FROM public.employees e
   WHERE e.id = public.auth_employee_id() AND e.status = 'ACTIVO';
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'Tu usuario no está activo.';
  END IF;

  -- Solo se puede tomar un documento que alguna regla habilite. Sin esto, el
  -- widget sería una puerta para apropiarse de cualquier factura de la empresa.
  SELECT r.id, r.asignacion, public.linea_telefonica_de(d.items_text)
    INTO v_rule, v_asignacion, v_linea
    FROM public.purchase_dte_documents d
    JOIN public.purchase_claim_rules r
      ON r.activo
     AND (r.emisor_nit  IS NULL OR d.emisor_nit = r.emisor_nit)
     AND (r.item_patron IS NULL OR d.items_norm ILIKE '%' || r.item_patron || '%')
   WHERE d.id = p_document_id AND NOT d.invalidado
   ORDER BY r.orden, r.id
   LIMIT 1;

  IF v_rule IS NULL THEN
    RAISE EXCEPTION 'Esa factura no está habilitada para tomarse desde la sala.';
  END IF;

  -- La línea mapeada es la dueña del documento. La lista ya no se lo muestra a
  -- nadie más, pero el RPC es llamable por su cuenta: sin esta guarda, una sala
  -- podía quedarse con la factura de la línea de otra y el error solo se veía
  -- días después, cuando la dueña no encontraba la suya.
  IF v_asignacion = 'linea' AND v_linea IS NOT NULL THEN
    SELECT l.branch_id INTO v_branch_linea
      FROM public.purchase_claim_lines l
     WHERE l.rule_id = v_rule AND l.linea = v_linea;
  END IF;

  IF v_branch_linea IS NOT NULL AND v_branch_linea <> p_branch_id THEN
    RAISE EXCEPTION 'Esta factura es de la línea de otra sala.';
  END IF;

  v_origen := CASE WHEN v_branch_linea IS NOT NULL THEN 'linea' ELSE 'reclamo' END;

  -- El candado es el índice único parcial, no este INSERT. Si otra sala entró
  -- primero —aunque haya sido en el mismo segundo— Postgres levanta 23505 acá.
  BEGIN
    INSERT INTO public.purchase_dte_claims
           (document_id, rule_id, branch_id, origen, claimed_by, claimed_by_name)
    VALUES (p_document_id, v_rule, p_branch_id, v_origen, v_emp, v_nombre)
    RETURNING id INTO v_claim;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Otra sala tomó esta factura primero.';
  END;

  RETURN v_claim;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reclamar_factura_compra(bigint, bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.reclamar_factura_compra(bigint, bigint) TO authenticated, service_role;

-- ── Soltarla ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.soltar_factura_compra(p_claim_id bigint, p_motivo text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_emp        uuid;
  v_branch     bigint;
  v_registrada boolean;
  v_admin      boolean;
BEGIN
  -- `'ACTIVO'`: ver el comentario de `reclamar_factura_compra`. Acá el efecto
  -- era el mismo — «Soltar» y «Liberar» fallaban siempre —, sólo que nadie
  -- llegó a verlo porque no se podía tomar ninguna factura para soltarla.
  SELECT e.id INTO v_emp
    FROM public.employees e
   WHERE e.id = public.auth_employee_id() AND e.status = 'ACTIVO';
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'Tu usuario no está activo.';
  END IF;

  SELECT c.branch_id, c.receipt_id IS NOT NULL
    INTO v_branch, v_registrada
    FROM public.purchase_dte_claims c
   WHERE c.id = p_claim_id AND c.released_at IS NULL;

  IF v_branch IS NULL THEN
    RAISE EXCEPTION 'Esa factura ya no está tomada.';
  END IF;

  v_admin := public.auth_can_edit_any(ARRAY['facturas_sala', 'compras', 'facturas_compra']);

  IF NOT v_admin THEN
    PERFORM public.facturas_sala_guarda(v_branch, 'can_edit');
    IF v_registrada THEN
      RAISE EXCEPTION 'Esta factura ya quedó registrada como compra: pedí que la liberen desde Facturas de Sala.';
    END IF;
  END IF;

  UPDATE public.purchase_dte_claims
     SET released_at = now(), released_by = v_emp, released_motivo = p_motivo
   WHERE id = p_claim_id AND released_at IS NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.soltar_factura_compra(bigint, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.soltar_factura_compra(bigint, text) TO authenticated, service_role;
