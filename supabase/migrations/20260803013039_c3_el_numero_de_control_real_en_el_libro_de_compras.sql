SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- C3 — el número que identifica el documento, en pantalla.
--
-- `purchase_receipts.documento_numero` NO guarda un número de control: guarda un
-- **código de generación cortado a 20 caracteres** — `7EC4501D-6456-4E0D-A`.
-- Son 778 de 872 compras de junio en adelante. Ese string no identifica nada:
-- no se puede buscar el documento con él, ni reclamárselo a un proveedor.
--
-- El número de control real —`DTE-03-M001P001-000000000003484`— existe: está en
-- `purchase_dte_documents`, del lado de las facturas que llegan por correo. Se
-- recupera con el mismo cruce del Libro Completo (sello primero, que es exacto;
-- después el código truncado). Medido en julio 2026: **380 de 467 compras**.
--
-- ── Por qué esto NO cambia el CSV ──────────────────────────────────────────
-- El archivo se compara contra el reporte de referencia, y el número de
-- documento es su columna más discriminante: sin ella el cotejo queda cruzando
-- por fecha + proveedor + montos, que en un mes cargado colisiona de verdad.
-- Y el número de control **no es derivable** del código truncado: son campos
-- distintos, así que tampoco se puede normalizar uno al otro para comparar.
--
-- Entonces se separan los dos usos, que nunca fueron el mismo:
--   · el CSV replica el reporte de referencia y sirve para COTEJAR — lo arma
--     `generar_csv_libro`, directo de la tabla, y no toca esta función;
--   · la pantalla es el portal y tiene que ser CORRECTA — acá.
-- Quien quiera el número completo en un archivo lo tiene en el Libro Completo,
-- que existe justamente para eso.
-- ═══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.get_libro_compras(date, date, bigint);

CREATE FUNCTION public.get_libro_compras(
  p_desde date, p_hasta date, p_branch_id bigint DEFAULT NULL
)
 RETURNS TABLE(branch_id bigint, fecha date, documento_tipo text, documento_numero text,
               numero_control text, proveedor text, nrc text, nit text,
               compras_exentas numeric, compras_gravadas numeric, credito_fiscal numeric,
               total numeric, percepcion_iva numeric, retencion_iva numeric, anulada boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT pr.branch_id::bigint, pr.fecha, pr.documento_tipo, pr.documento_numero,
           d.numero_control,
           pr.proveedor,
           nullif(btrim(coalesce(s.nrc, pm.nrc, '')), ''),
           nullif(btrim(coalesce(pm.nit, '')), ''),
           0::numeric,
           coalesce(pr.subtotal, 0) - coalesce(pr.percepcion_iva, 0),
           coalesce(pr.iva, 0), coalesce(pr.total, 0),
           pr.percepcion_iva, pr.retencion_iva, pr.estado = 'anulada'
    FROM public.purchase_receipts pr
    LEFT JOIN public.suppliers           s  ON s.id  = pr.supplier_id
    LEFT JOIN public.proveedores_maestro pm ON pm.supplier_id = pr.supplier_id
    -- Mismo cruce que el Libro Completo, para que las dos pantallas no puedan
    -- discrepar sobre cuál documento es cuál.
    LEFT JOIN LATERAL (
      SELECT d.numero_control
        FROM public.purchase_dte_documents d
       WHERE (
               (pr.sello_recibido IS NOT NULL AND d.sello_recibido = pr.sello_recibido)
            OR upper(replace(replace(replace(btrim(pr.documento_numero),' ',''),'.',''),'O','0'))
               IN (left(upper(d.codigo_generacion::text), 20),
                   left(replace(upper(d.codigo_generacion::text), '-', ''), 20),
                   upper(d.codigo_generacion::text))
             )
         AND (pm.nit IS NULL OR d.emisor_nit = pm.nit)
         AND coalesce(d.invalidado, false) = false
         AND d.numero_control IS NOT NULL
       ORDER BY (d.sello_recibido = pr.sello_recibido) DESC NULLS LAST, d.id
       LIMIT 1
    ) d ON true
    WHERE (SELECT auth_has_module_permission('libros_iva', 'can_view'))
      AND ((SELECT auth_module_scope('libros_iva')) = 'ALL'
           OR pr.branch_id = (SELECT auth_employee_branch_id()))
      AND pr.fecha BETWEEN p_desde AND p_hasta
      AND (p_branch_id IS NULL OR pr.branch_id = p_branch_id)
    ORDER BY pr.branch_id, pr.fecha, pr.erp_purchase_id;
$function$;

COMMENT ON FUNCTION public.get_libro_compras(date, date, bigint) IS
  'Libro de compras Art. 86. `documento_numero` es lo que trae el origen —un codigo de generacion CORTADO a 20 caracteres, que no identifica el documento— y se conserva porque es la columna con la que se cotea el CSV. `numero_control` es el numero real, recuperado de purchase_dte_documents con el mismo cruce del Libro Completo (sello primero); NULL cuando no hay con que. La pantalla muestra el real, el CSV sigue llevando el del origen: cotejar y presentar no son el mismo uso.';

REVOKE EXECUTE ON FUNCTION public.get_libro_compras(date, date, bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_libro_compras(date, date, bigint) TO authenticated, service_role;
