-- Facturas de mi Sala — los RPC y las reglas sembradas.
--
-- Todo pasa por acá: `purchase_dte_documents` está cerrada al personal de sala
-- (su RLS pide el módulo de Facturas de Compra, que es de contabilidad), así que
-- estas funciones son DEFINER y hacen ellas el control de permiso y de alcance.

SET lock_timeout = '5s';

-- ── El número de línea que trae el documento ────────────────────────────────
-- Movistar escribe "Artículo: RECARGA ELECTRONICA. Núm. Teléfono: 61622865".
-- Se ancla en la palabra Teléfono a propósito: agarrar "el primer número de 8
-- dígitos" levantaría lotes, códigos de producto y fechas.
CREATE OR REPLACE FUNCTION public.linea_telefonica_de(p_texto text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT NULLIF(
    regexp_replace(
      COALESCE((regexp_match(COALESCE(p_texto, ''), 'Tel[eé]fono[^0-9]*([0-9][0-9 -]{6,})'))[1], ''),
      '[^0-9]', '', 'g'
    ), '');
$$;

REVOKE EXECUTE ON FUNCTION public.linea_telefonica_de(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.linea_telefonica_de(text) TO authenticated, service_role;

-- ── Guarda de permiso y de alcance ──────────────────────────────────────────
-- Una sala con alcance BRANCH no puede pedir —ni tomar— las facturas de otra.
-- El `p_branch_id` que manda el navegador es un FILTRO, no una identidad: quién
-- es sale del JWT y acá se comprueba que tenga derecho a esa sala.
CREATE OR REPLACE FUNCTION public.facturas_sala_guarda(p_branch_id bigint, p_accion text)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.auth_has_module_permission('dash_facturas_sala', p_accion) THEN
    RAISE EXCEPTION 'No tenés permiso para ver las facturas de la sala.';
  END IF;

  IF public.auth_module_scope('dash_facturas_sala') <> 'ALL'
     AND p_branch_id IS DISTINCT FROM public.auth_employee_branch_id()::bigint THEN
    RAISE EXCEPTION 'Solo podés trabajar con las facturas de tu propia sala.';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.facturas_sala_guarda(bigint, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.facturas_sala_guarda(bigint, text) TO authenticated, service_role;

-- ── Los documentos que le corresponden a una sala ───────────────────────────
-- Es una LISTA, no un buscador a ciegas. El filtro de fecha y monto del widget
-- acota esto; nunca es la única forma de llegar a una fila. El motivo está
-- medido: con una búsqueda por monto ±$X, "no hay resultados" y "el monto que
-- recordás está mal" se ven exactamente igual, y la sala concluye que la factura
-- no llegó. Con una lista, vacío significa vacío.
--
-- Volumen real (60 días): 22 documentos de agua + 21 de recargas = ~3 por sala
-- al mes. La lista entra en pantalla sin paginar nada.
CREATE OR REPLACE FUNCTION public.get_facturas_sala(
    p_branch_id        bigint,
    p_dias             integer DEFAULT 45,
    p_incluir_tomadas  boolean DEFAULT false
)
RETURNS TABLE (
    document_id      bigint,
    fecha_emision    date,
    etiqueta         text,
    emisor_nombre    text,
    monto_total      numeric,
    items_text       text,
    numero_control   text,
    codigo_generacion text,
    json_path        text,
    pdf_path         text,
    estado           text,
    linea            text,
    claim_id         bigint,
    tomada_por       text,
    tomada_sala      text,
    tomada_at        timestamptz,
    registrada       boolean
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
  -- ofrecer la misma factura dos veces en la lista.
  candidatos AS (
      SELECT DISTINCT ON (d.id)
             d.id, d.fecha_emision, d.emisor_nombre, d.monto_total, d.items_text,
             d.numero_control, d.codigo_generacion, d.json_path, d.pdf_path,
             r.id AS rule_id, r.etiqueta, r.asignacion,
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
           WHEN r.por_linea                                      THEN 'mia_linea'
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

-- ── El número de la baldosa ─────────────────────────────────────────────────
-- Cuántas hay esperando que esta sala las tome. Sin número, una puerta cerrada
-- no da ningún motivo para abrirla.
CREATE OR REPLACE FUNCTION public.contar_facturas_sala(p_branch_id bigint, p_dias integer DEFAULT 45)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT count(*)::integer
    FROM public.get_facturas_sala(p_branch_id, p_dias, false) f
   WHERE f.estado IN ('disponible', 'mia_linea');
$$;

REVOKE EXECUTE ON FUNCTION public.contar_facturas_sala(bigint, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.contar_facturas_sala(bigint, integer) TO authenticated, service_role;

-- ── Tomar una factura ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reclamar_factura_compra(
    p_document_id bigint,
    p_branch_id   bigint
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_emp     uuid;
  v_nombre  text;
  v_rule    bigint;
  v_origen  text;
  v_claim   bigint;
BEGIN
  PERFORM public.facturas_sala_guarda(p_branch_id, 'can_edit');

  -- Empleado ACTIVO, resuelto del JWT. Nunca de un parámetro.
  SELECT e.id, e.name INTO v_emp, v_nombre
    FROM public.employees e
   WHERE e.id = public.auth_employee_id() AND e.status = 'ACTIVE';
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'Tu usuario no está activo.';
  END IF;

  -- Solo se puede tomar un documento que alguna regla habilite. Sin esto, el
  -- widget sería una puerta para apropiarse de cualquier factura de la empresa.
  SELECT r.id,
         CASE WHEN r.asignacion = 'linea'
                   AND EXISTS (SELECT 1 FROM public.purchase_claim_lines l
                                WHERE l.rule_id = r.id
                                  AND l.linea = public.linea_telefonica_de(d.items_text)
                                  AND l.branch_id = p_branch_id)
              THEN 'linea' ELSE 'reclamo' END
    INTO v_rule, v_origen
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
-- Dos caminos, a propósito distintos:
--   · la propia sala puede soltar la que tomó por error, mientras nadie la haya
--     registrado como compra todavía;
--   · contabilidad puede soltar cualquiera, siempre.
-- La fila NO se borra: se cierra con quién y por qué. Un reclamo borrado es un
-- reclamo que nunca ocurrió, y entonces no se puede auditar el error.
CREATE OR REPLACE FUNCTION public.soltar_factura_compra(
    p_claim_id bigint,
    p_motivo   text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_emp        uuid;
  v_branch     bigint;
  v_registrada boolean;
  v_contab     boolean;
BEGIN
  SELECT e.id INTO v_emp
    FROM public.employees e
   WHERE e.id = public.auth_employee_id() AND e.status = 'ACTIVE';
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

  v_contab := public.auth_can_edit_any(ARRAY['facturas_compra']);

  IF NOT v_contab THEN
    PERFORM public.facturas_sala_guarda(v_branch, 'can_edit');
    IF v_registrada THEN
      RAISE EXCEPTION 'Esta factura ya quedó registrada como compra: pedí a contabilidad que la libere.';
    END IF;
  END IF;

  UPDATE public.purchase_dte_claims
     SET released_at = now(), released_by = v_emp, released_motivo = p_motivo
   WHERE id = p_claim_id AND released_at IS NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.soltar_factura_compra(bigint, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.soltar_factura_compra(bigint, text) TO authenticated, service_role;

-- ── Las reglas de arranque ──────────────────────────────────────────────────
-- Decididas con el usuario el 2026-08-07. Los recibos de línea fija de Claro y
-- CTE (18 documentos, $452.92 en 60 días) quedan FUERA: son el servicio del
-- local, los paga administración, no son una compra de la sala.
--
-- `item_patron` va en minúsculas y sin puntuación porque así se guarda
-- `items_norm`: "RECARGA CLARO $1.00" queda como "recarga claro $100".
INSERT INTO public.purchase_claim_rules (etiqueta, emisor_nit, item_patron, asignacion, orden, notas)
VALUES
  ('Agua', '04361012241019', NULL, 'reclamo', 10,
   'Envasadora Agua Fría. El renglón dice "4 GARRAFA DE AGUA" y nada más: no hay ninguna seña de a qué sala le toca, por eso se reclama.'),

  ('Recarga Tigo', '06140312700042', 'recarga tigo', 'reclamo', 20,
   'Viene como renglón dentro de una factura de COFARSAL, que también es el proveedor de medicamento más grande. Verificado 2026-08-07: de sus 202 facturas del bimestre, 21 traen recargas y ninguna las mezcla con medicamento.'),

  ('Recarga Claro', '06140312700042', 'recarga claro', 'reclamo', 30,
   'Igual que la de Tigo: renglón dentro de factura de COFARSAL.'),

  ('Recarga Movistar', '06142102971036', NULL, 'linea', 40,
   'El documento trae el número de línea adentro ("Núm. Teléfono: 78370041"). Cargando el mapa línea→sala en purchase_claim_lines se asignan solas. Mientras una línea no esté mapeada, su documento cae al modo reclamo y lo ven todas las salas — nunca desaparece.')
ON CONFLICT DO NOTHING;
