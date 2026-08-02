SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- Bloque A del PLAN-CONTABILIDAD-2026-08-02: los candados.
--
-- Va primero porque HOY la base está limpia (0 supplier_id duplicados, 0 NIT
-- duplicados, verificado al aplicar). Poner el candado ahora no requiere
-- reparar nada; cada semana que pasa es una oportunidad de que alguien haga el
-- clic que lo ensucia y entonces sí haya que limpiar antes.
--
-- Qué evita: `proveedores_maestro.supplier_id` no tenía índice único y los tres
-- RPC del libro de compras hacen LEFT JOIN por esa columna. Un solo duplicado
-- multiplica filas del libro. Simulado sobre junio 2026: 389 → 503 filas,
-- $203,947 → $295,805. Y por H10 el verificador de CSV lo declararía IDENTICO,
-- porque solo comprueba que cada línea del ERP esté en el portal, nunca que al
-- portal no le sobre nada.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── A3 (H1b) · Los lookups del upsert eran no deterministas ────────────────
-- Tres cambios, todos de la misma familia:
--
--   1. El lookup por NRC hacía `LIMIT 1` sin `ORDER BY`: con dos suppliers del
--      mismo NRC, cuál gana lo decide el plan de ejecución. Ahora `ORDER BY id`.
--   2. Un NRC que normaliza a cadena vacía (`'---'`, `'N/A'`) hacía match con
--      TODO supplier de NRC igualmente vacío. Ahora se exige que quede algo.
--   3. **El que importa para A1**: se exige que ese supplier no esté ya tomado
--      por otra ficha. Sin esto, el índice único de abajo haría fallar el INSERT
--      con 23505 y con eso se caería el sync de correos entero — el candado
--      rompería justo el camino automático que debía proteger. Prefiere dejar el
--      vínculo vacío (la vista lo muestra como pendiente) antes que romper.
--
-- Los dos lookups de `proveedores_maestro` llevan `ORDER BY id` por lo mismo:
-- `SELECT ... INTO` en plpgsql no falla con varias filas, se queda con una
-- cualquiera. Hoy no hay NIT ni DUI duplicados, así que no cambia ningún
-- resultado; cambia que mañana tampoco dependa de la suerte.
CREATE OR REPLACE FUNCTION public.upsert_proveedor_from_dte(p_data jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_nit         text := nullif(p_data->>'nit', '');
  v_dui         text := nullif(p_data->>'dui', '');
  v_nrc         text := nullif(p_data->>'nrc', '');
  v_nrc_norm    text;
  v_fecha       date := (p_data->>'fecha_emision')::date;
  v_tipo_dte    text := p_data->>'tipo_dte';
  v_es_nc_nd    boolean := v_tipo_dte IN ('05', '06');
  v_supplier_id integer;
  v_id          bigint;
  v_out_supplier_id integer;
BEGIN
  IF v_nit IS NULL AND v_dui IS NULL THEN
    RAISE EXCEPTION 'nit o dui requerido';
  END IF;

  v_nrc_norm := regexp_replace(coalesce(v_nrc, ''), '[^0-9]', '', 'g');

  IF v_nrc_norm <> '' THEN
    SELECT s.id INTO v_supplier_id
      FROM public.suppliers s
     WHERE regexp_replace(coalesce(s.nrc, ''), '[^0-9]', '', 'g') = v_nrc_norm
       AND NOT EXISTS (
             SELECT 1 FROM public.proveedores_maestro pm
              WHERE pm.supplier_id = s.id)
     ORDER BY s.id
     LIMIT 1;
  END IF;

  IF v_nit IS NOT NULL THEN
    SELECT id INTO v_id FROM public.proveedores_maestro
      WHERE nit = v_nit ORDER BY id LIMIT 1;
  ELSE
    SELECT id INTO v_id FROM public.proveedores_maestro
      WHERE dui = v_dui AND nit IS NULL ORDER BY id LIMIT 1;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.proveedores_maestro (
      nit, dui, nrc, nombre, nombre_comercial, cod_actividad, desc_actividad,
      tipo_establecimiento, departamento, municipio, direccion, telefono, correo,
      percibe_1, retiene_renta, supplier_id, source,
      primera_vez_visto, ultima_vez_visto, docs_count
    ) VALUES (
      v_nit, v_dui, v_nrc, p_data->>'nombre', p_data->>'nombre_comercial',
      p_data->>'cod_actividad', p_data->>'desc_actividad', p_data->>'tipo_establecimiento',
      p_data->>'departamento', p_data->>'municipio', p_data->>'direccion',
      p_data->>'telefono', p_data->>'correo',
      coalesce((p_data->>'percibe_1')::boolean, false),
      coalesce((p_data->>'retiene_renta')::boolean, false),
      v_supplier_id, 'dte', v_fecha, v_fecha, CASE WHEN v_es_nc_nd THEN 0 ELSE 1 END
    )
    RETURNING id, supplier_id INTO v_id, v_out_supplier_id;
  ELSE
    UPDATE public.proveedores_maestro p SET
      nrc                   = coalesce(v_nrc, p.nrc),
      nombre                = coalesce(p_data->>'nombre', p.nombre),
      nombre_comercial      = coalesce(p_data->>'nombre_comercial', p.nombre_comercial),
      cod_actividad         = coalesce(p_data->>'cod_actividad', p.cod_actividad),
      desc_actividad        = coalesce(p_data->>'desc_actividad', p.desc_actividad),
      tipo_establecimiento  = coalesce(p_data->>'tipo_establecimiento', p.tipo_establecimiento),
      departamento          = coalesce(p_data->>'departamento', p.departamento),
      municipio             = coalesce(p_data->>'municipio', p.municipio),
      direccion             = coalesce(p_data->>'direccion', p.direccion),
      telefono              = coalesce(p_data->>'telefono', p.telefono),
      correo                = coalesce(p_data->>'correo', p.correo),
      percibe_1             = CASE
                                 WHEN p.percibe_1_override IS NOT NULL THEN p.percibe_1_override
                                 ELSE p.percibe_1 OR coalesce((p_data->>'percibe_1')::boolean, false)
                               END,
      retiene_renta         = p.retiene_renta OR coalesce((p_data->>'retiene_renta')::boolean, false),
      supplier_id           = coalesce(p.supplier_id, v_supplier_id),
      primera_vez_visto     = LEAST(p.primera_vez_visto, v_fecha),
      ultima_vez_visto      = CASE WHEN v_es_nc_nd THEN p.ultima_vez_visto ELSE GREATEST(p.ultima_vez_visto, v_fecha) END,
      docs_count            = p.docs_count + CASE WHEN v_es_nc_nd THEN 0 ELSE 1 END,
      updated_at            = now()
    WHERE p.id = v_id
    RETURNING p.supplier_id INTO v_out_supplier_id;
  END IF;

  RETURN json_build_object('id', v_id, 'supplier_id', v_out_supplier_id);
END;
$function$;

-- ── A1 (H1) · El candado ────────────────────────────────────────────────────
-- Parcial: `supplier_id` NULL significa "todavía no está vinculado a un
-- proveedor del ERP" y eso vale para muchas fichas a la vez — hoy 39, todas de
-- gastos y servicios que nunca pasan por el módulo de compras del ERP.
CREATE UNIQUE INDEX IF NOT EXISTS uq_proveedores_maestro_supplier_id
  ON public.proveedores_maestro (supplier_id)
  WHERE supplier_id IS NOT NULL;

COMMENT ON INDEX public.uq_proveedores_maestro_supplier_id IS
  'H1: dos fichas apuntando al mismo proveedor del ERP duplican el libro de compras (junio 2026: 389 -> 503 filas, $203,947 -> $295,805) y el verificador de CSV lo declara IDENTICO porque solo mira una direccion (H10). Parcial porque NULL = sin vincular, y eso se repite.';

-- ── A2 · El mensaje, en vez del error crudo ─────────────────────────────────
-- El select "Match ERP" de FormProveedorDetail llama a esta RPC sin ningún
-- chequeo. Con el índice de arriba, elegir un proveedor ya tomado devolvía un
-- 23505 que el traductor de errores convierte en "Ya existe un registro con
-- esos datos" — cierto y perfectamente inútil: no dice cuál, ni con quién
-- choca. El nombre del otro proveedor es lo único accionable.
--
-- La comprobación va en el manejador de la excepción y no antes del UPDATE a
-- propósito: chequear primero deja una ventana entre el SELECT y el UPDATE en
-- la que otra sesión puede tomar el mismo supplier. El índice es el árbitro; el
-- SELECT solo se corre cuando ya se sabe que hubo choque, para nombrarlo.
CREATE OR REPLACE FUNCTION public.set_proveedor_supplier(p_id bigint, p_supplier_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_otro text;
BEGIN
  IF NOT (SELECT auth_can_edit_any(ARRAY['proveedores'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  BEGIN
    UPDATE public.proveedores_maestro
      SET supplier_id = p_supplier_id, updated_at = now()
      WHERE id = p_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT nombre INTO v_otro
      FROM public.proveedores_maestro
     WHERE supplier_id = p_supplier_id AND id <> p_id
     ORDER BY id LIMIT 1;
    RAISE EXCEPTION 'SUPPLIER_YA_VINCULADO: Ese proveedor del ERP ya esta vinculado a %. Quita el vinculo alli antes de asignarlo aqui.',
      coalesce(nullif(btrim(v_otro), ''), 'otra ficha');
  END;
END;
$function$;

-- ── A5 (H8) · La función existía y nadie podía ejecutarla ───────────────────
-- `get_libro_sujeto_excluido` tenía EXECUTE solo para postgres y service_role,
-- así que la vista nunca pudo llamarla: hoy es código muerto que fallaría con
-- "permission denied" el día que alguien la recuelgue. Se le da el mismo trato
-- que a los otros seis RPC de libros — el gate de permisos ya lo lleva adentro,
-- en initplan `(SELECT auth_has_module_permission(...))`.
REVOKE EXECUTE ON FUNCTION public.get_libro_sujeto_excluido(date, date, bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_libro_sujeto_excluido(date, date, bigint) TO authenticated, service_role;

-- ── A7 (H7) · Por qué esta no lleva scope de sucursal ───────────────────────
-- La auditoría la marcó como "sin scope de sucursal" comparándola con los otros
-- RPC de libros. Hay motivo y no estaba escrito: `purchase_dte_documents` no
-- tiene columna de sucursal. Los DTE llegan por correo a una casilla de la
-- empresa (`account_id` es el buzón, no una sucursal), así que no hay por qué
-- filtrar. Escrito acá para que la próxima auditoría no lo levante de nuevo.
COMMENT ON FUNCTION public.get_notas_credito_compras(date, date) IS
  'H7 (PLAN-CONTABILIDAD-2026-08-02 A7): sin scope de sucursal A PROPOSITO. purchase_dte_documents no tiene columna de sucursal: los DTE llegan por correo a una casilla de la empresa (account_id es el buzon, no una sucursal). No hay nada por lo cual filtrar. El gate de permisos si esta, en initplan.';
