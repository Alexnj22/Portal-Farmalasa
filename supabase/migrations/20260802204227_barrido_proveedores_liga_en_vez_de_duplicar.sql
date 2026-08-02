SET lock_timeout = '5s';

-- Tercera version del barrido. Dos capacidades nuevas, las dos nacidas de mirar
-- los datos reales y no de imaginarse el caso:
--
-- 1) LIGAR EN VEZ DE DUPLICAR. Al traer los proveedores del ERP sin compras
--    aparecieron DIALCA y BANCO PROMERICA, que el portal YA conoce por DTE pero
--    sin vinculo al ERP. Crearles ficha nueva habria dejado dos fichas del mismo
--    contribuyente, y el libro habria usado la que tuviera `supplier_id` — la
--    del ERP, con su NIT sin respaldo — en vez de la del DTE firmado. Ahora,
--    antes de crear, se busca ficha existente por NIT y por NRC normalizado:
--      · si existe y no tiene supplier_id -> se le pone el vinculo (no se crea)
--      · si existe y tiene OTRO supplier_id -> se reporta y no se toca nada
--    Sirvio de inmediato: MIO PHARMA (erp 106) comparte NIT con GENACOL LATIN
--    AMERICA (erp 99) y quedo reportado como conflicto en vez de duplicar.
--
-- 2) VALIDAR EL NIT ANTES DE CREER. El catalogo del ERP tiene `PROVEEDOR PRUEBA`
--    con NIT 43532453245325 y `CACELA` con 0614160758 (10 digitos). Es la misma
--    disciplina que H19 pide para el sello — copiar un identificador sin medirlo
--    es como no tenerlo.
--    (`nit_sv_valido` se define aca por primera vez con una regla equivocada
--    —departamento 01-14— que 20260802204347 y 20260802204432 corrigen. Ver alli.)
--
-- `p_crear_supplier` existe porque pre-crear la fila de `suppliers` solo tiene
-- sentido para el barrido del catalogo completo. `sync_suppliers_batch` upserta
-- por `erp_supplier_id` con ON CONFLICT, asi que cuando llegue la primera compra
-- la encuentra y la actualiza — no duplica.
CREATE OR REPLACE FUNCTION public.nit_sv_valido(p_nit text)
 RETURNS boolean
 LANGUAGE sql IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT p_nit ~ '^[0-9]{14}$'
     AND substring(p_nit, 1, 2)::int BETWEEN 1 AND 14;
$function$;

COMMENT ON FUNCTION public.nit_sv_valido(text) IS
  'Forma de un NIT salvadoreno: 14 digitos, y los dos primeros son el departamento (01-14). No valida el digito verificador — descarta basura evidente (PROVEEDOR PRUEBA = 43532453245325), no certifica al contribuyente.';

CREATE OR REPLACE FUNCTION public.aplicar_barrido_proveedores(
  p_rows jsonb,
  p_crear_supplier boolean DEFAULT false
)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_creadas    int := 0;
  v_llenadas   int := 0;
  v_ligadas    int := 0;
  v_suppliers  int := 0;
  v_sin_supplier int := 0;
  v_omitidas   jsonb := '[]'::jsonb;
  v_conflictos jsonb := '[]'::jsonb;
  v_detalle    jsonb := '[]'::jsonb;
  r            jsonb;
  v_sid        integer;
  v_pm         public.proveedores_maestro%ROWTYPE;
  v_campos     text[];
  v_nit        text;
  v_nrc        text;
  v_nrc_norm   text;
  v_dui        text;
BEGIN
  IF NOT (SELECT auth_can_edit_any(ARRAY['proveedores'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  LOOP
    v_nit := nullif(btrim(r->>'nit'), '');
    v_nrc := nullif(btrim(r->>'nrc'), '');
    v_dui := nullif(btrim(r->>'dui'), '');
    v_nrc_norm := nullif(regexp_replace(coalesce(v_nrc, ''), '[^0-9]', '', 'g'), '');

    -- Un NIT con forma invalida no es un NIT.
    IF v_nit IS NOT NULL AND NOT public.nit_sv_valido(v_nit) THEN
      v_omitidas := v_omitidas || jsonb_build_object(
        'erp_supplier_id', (r->>'erp_supplier_id')::int, 'nombre', r->>'nombre',
        'motivo', 'nit con forma invalida', 'valor', v_nit);
      v_nit := NULL;
    END IF;

    SELECT s.id INTO v_sid FROM public.suppliers s
     WHERE s.erp_supplier_id = (r->>'erp_supplier_id')::int;

    IF v_sid IS NULL THEN
      IF NOT p_crear_supplier THEN
        v_sin_supplier := v_sin_supplier + 1;
        CONTINUE;
      END IF;
      -- Sin ninguna identificacion fiscal no se crea nada: ni supplier ni ficha.
      IF v_nit IS NULL AND v_dui IS NULL THEN
        v_omitidas := v_omitidas || jsonb_build_object(
          'erp_supplier_id', (r->>'erp_supplier_id')::int, 'nombre', r->>'nombre',
          'motivo', 'sin NIT ni DUI utilizables');
        CONTINUE;
      END IF;
      INSERT INTO public.suppliers (erp_supplier_id, nombre, nrc)
        VALUES ((r->>'erp_supplier_id')::int, nullif(btrim(r->>'nombre'),''), v_nrc)
        RETURNING id INTO v_sid;
      v_suppliers := v_suppliers + 1;
    END IF;

    SELECT * INTO v_pm FROM public.proveedores_maestro WHERE supplier_id = v_sid;

    IF NOT FOUND THEN
      -- ¿El portal ya lo conoce por otro camino (un DTE)? Se busca por NIT y por
      -- NRC normalizado antes de crear nada.
      SELECT * INTO v_pm FROM public.proveedores_maestro pm
       WHERE (v_nit IS NOT NULL AND pm.nit = v_nit)
          OR (v_nrc_norm IS NOT NULL
              AND regexp_replace(coalesce(pm.nrc,''), '[^0-9]', '', 'g') = v_nrc_norm)
       ORDER BY pm.id LIMIT 1;

      IF FOUND THEN
        IF v_pm.supplier_id IS NOT NULL AND v_pm.supplier_id <> v_sid THEN
          v_conflictos := v_conflictos || jsonb_build_object(
            'erp_supplier_id', (r->>'erp_supplier_id')::int, 'nombre', r->>'nombre',
            'ficha_portal', v_pm.nombre, 'ya_vinculada_a', v_pm.supplier_id);
          CONTINUE;
        END IF;
        UPDATE public.proveedores_maestro SET supplier_id = v_sid, updated_at = now()
         WHERE id = v_pm.id;
        v_ligadas := v_ligadas + 1;
        v_detalle := v_detalle || jsonb_build_object(
          'erp_supplier_id', (r->>'erp_supplier_id')::int,
          'nombre', v_pm.nombre, 'accion', 'ligada');
        -- Y a continuacion se le llenan los huecos como a cualquier existente.
        SELECT * INTO v_pm FROM public.proveedores_maestro WHERE id = v_pm.id;
      ELSE
        IF v_nit IS NULL AND v_dui IS NULL THEN
          v_omitidas := v_omitidas || jsonb_build_object(
            'erp_supplier_id', (r->>'erp_supplier_id')::int, 'nombre', r->>'nombre',
            'motivo', 'sin NIT ni DUI utilizables');
          CONTINUE;
        END IF;
        INSERT INTO public.proveedores_maestro (
          nit, dui, nrc, nombre, direccion, telefono, telefono2, correo,
          contacto_nombre, nombre_cheques, departamento, municipio, pais,
          percibe_1, retiene_renta, supplier_id, source, activo,
          primera_vez_visto, ultima_vez_visto, docs_count
        )
        SELECT
          v_nit, v_dui, v_nrc, nullif(btrim(r->>'nombre'), ''),
          nullif(btrim(r->>'direccion'), ''), nullif(btrim(r->>'telefono'), ''),
          nullif(btrim(r->>'telefono2'), ''), nullif(btrim(r->>'correo'), ''),
          nullif(btrim(r->>'contacto_nombre'), ''), nullif(btrim(r->>'nombre_cheques'), ''),
          nullif(btrim(r->>'departamento'), ''), nullif(btrim(r->>'municipio'), ''),
          nullif(btrim(r->>'pais'), ''),
          coalesce((r->>'percibe_1')::boolean, false), false,
          v_sid, 'erp', true,
          (SELECT min(pr.fecha) FROM public.purchase_receipts pr WHERE pr.supplier_id = v_sid),
          (SELECT max(pr.fecha) FROM public.purchase_receipts pr WHERE pr.supplier_id = v_sid),
          0;
        v_creadas := v_creadas + 1;
        v_detalle := v_detalle || jsonb_build_object(
          'erp_supplier_id', (r->>'erp_supplier_id')::int,
          'nombre', r->>'nombre', 'accion', 'creada');
        CONTINUE;
      END IF;
    END IF;

    v_campos := ARRAY[]::text[];
    IF v_pm.direccion       IS NULL AND nullif(btrim(r->>'direccion'),'')       IS NOT NULL THEN v_campos := v_campos || 'direccion'::text; END IF;
    IF v_pm.telefono        IS NULL AND nullif(btrim(r->>'telefono'),'')        IS NOT NULL THEN v_campos := v_campos || 'telefono'::text; END IF;
    IF v_pm.telefono2       IS NULL AND nullif(btrim(r->>'telefono2'),'')       IS NOT NULL THEN v_campos := v_campos || 'telefono2'::text; END IF;
    IF v_pm.correo          IS NULL AND nullif(btrim(r->>'correo'),'')          IS NOT NULL THEN v_campos := v_campos || 'correo'::text; END IF;
    IF v_pm.contacto_nombre IS NULL AND nullif(btrim(r->>'contacto_nombre'),'') IS NOT NULL THEN v_campos := v_campos || 'contacto_nombre'::text; END IF;
    IF v_pm.nombre_cheques  IS NULL AND nullif(btrim(r->>'nombre_cheques'),'')  IS NOT NULL THEN v_campos := v_campos || 'nombre_cheques'::text; END IF;
    IF v_pm.departamento    IS NULL AND nullif(btrim(r->>'departamento'),'')    IS NOT NULL THEN v_campos := v_campos || 'departamento'::text; END IF;
    IF v_pm.municipio       IS NULL AND nullif(btrim(r->>'municipio'),'')       IS NOT NULL THEN v_campos := v_campos || 'municipio'::text; END IF;
    IF v_pm.pais            IS NULL AND nullif(btrim(r->>'pais'),'')            IS NOT NULL THEN v_campos := v_campos || 'pais'::text; END IF;
    IF v_pm.nrc             IS NULL AND v_nrc                                   IS NOT NULL THEN v_campos := v_campos || 'nrc'::text; END IF;
    IF v_pm.dui             IS NULL AND v_dui                                   IS NOT NULL THEN v_campos := v_campos || 'dui'::text; END IF;
    IF v_pm.percibe_1_override IS NULL AND NOT v_pm.percibe_1
       AND coalesce((r->>'percibe_1')::boolean, false) THEN v_campos := v_campos || 'percibe_1'::text; END IF;

    IF array_length(v_campos, 1) IS NULL THEN CONTINUE; END IF;

    UPDATE public.proveedores_maestro p SET
      direccion       = coalesce(p.direccion,       nullif(btrim(r->>'direccion'),'')),
      telefono        = coalesce(p.telefono,        nullif(btrim(r->>'telefono'),'')),
      telefono2       = coalesce(p.telefono2,       nullif(btrim(r->>'telefono2'),'')),
      correo          = coalesce(p.correo,          nullif(btrim(r->>'correo'),'')),
      contacto_nombre = coalesce(p.contacto_nombre, nullif(btrim(r->>'contacto_nombre'),'')),
      nombre_cheques  = coalesce(p.nombre_cheques,  nullif(btrim(r->>'nombre_cheques'),'')),
      departamento    = coalesce(p.departamento,    nullif(btrim(r->>'departamento'),'')),
      municipio       = coalesce(p.municipio,       nullif(btrim(r->>'municipio'),'')),
      pais            = coalesce(p.pais,            nullif(btrim(r->>'pais'),'')),
      nrc             = coalesce(p.nrc,             v_nrc),
      dui             = coalesce(p.dui,             v_dui),
      percibe_1       = CASE WHEN p.percibe_1_override IS NOT NULL THEN p.percibe_1
                             ELSE p.percibe_1 OR coalesce((r->>'percibe_1')::boolean, false) END,
      updated_at      = now()
    WHERE p.id = v_pm.id;

    v_llenadas := v_llenadas + 1;
    v_detalle := v_detalle || jsonb_build_object(
      'erp_supplier_id', (r->>'erp_supplier_id')::int,
      'nombre', v_pm.nombre, 'accion', 'llenada', 'campos', to_jsonb(v_campos));
  END LOOP;

  RETURN json_build_object(
    'creadas', v_creadas, 'llenadas', v_llenadas, 'ligadas', v_ligadas,
    'suppliers_creados', v_suppliers, 'sin_supplier_omitidas', v_sin_supplier,
    'omitidas', v_omitidas, 'conflictos', v_conflictos, 'detalle', v_detalle);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.aplicar_barrido_proveedores(jsonb, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.aplicar_barrido_proveedores(jsonb, boolean) TO authenticated, service_role;
-- La firma de un argumento queda huerfana: un overload que nadie llama es deuda
-- que algun dia alguien invoca sin el flag y se lleva otro comportamiento.
DROP FUNCTION IF EXISTS public.aplicar_barrido_proveedores(jsonb);
