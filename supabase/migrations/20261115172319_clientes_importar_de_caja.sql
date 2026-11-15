-- Importar al portal las fichas de la caja que el portal no tiene (2026-11-15).
--
-- El barrido completo (`barrido-clientes-caja`) midió 63 fichas de la caja sin
-- gemelo en el portal: creadas allá y que no volvieron a comprar, así que
-- `sync-dte-sales` nunca las trajo. Con el portal como base de los clientes,
-- tienen que estar.
--
-- Por fila, en orden:
--   · su número ya está en el portal ........ nada (ya_estaba)
--   · hay una ficha con el MISMO nombre, sin número, no fusionada, y sin un
--     DUI distinto ............................ se le pone el número y se
--                                               llenan sus vacíos (vinculada)
--   · el nombre lo tiene otra con número ...... nada, se informa (nombre_ocupado):
--                                               son dos fichas de la caja con el
--                                               mismo nombre y eso lo decide una
--                                               persona
--   · si no ................................. se crea (creada)
-- Sólo `service_role` (la llama la función del barrido).

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.clientes_importar_de_caja(p_filas json)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  r record;
  c public.customers%ROWTYPE;
  v_nombre text;
  v_creadas int := 0; v_vinculadas int := 0; v_ya int := 0;
  v_ocupado jsonb := '[]'::jsonb;
BEGIN
  FOR r IN
    SELECT * FROM json_to_recordset(p_filas) AS x(
      erp_id text, name text, nit text, dui text, nrc text, phone text, telefono2 text,
      email text, direccion text, pasaporte text, departamento text, municipio text,
      distrito text, categoria text, giro text, retencion_pct smallint)
  LOOP
    CONTINUE WHEN coalesce(btrim(r.erp_id), '') = '' OR coalesce(btrim(r.name), '') = '';
    IF EXISTS (SELECT 1 FROM public.customers WHERE erp_id = r.erp_id) THEN
      v_ya := v_ya + 1; CONTINUE;
    END IF;
    v_nombre := upper(regexp_replace(btrim(r.name), '\s+', ' ', 'g'));

    SELECT * INTO c FROM public.customers WHERE upper(btrim(name)) = v_nombre LIMIT 1;
    IF FOUND THEN
      IF c.erp_id IS NULL AND c.fusionada_en_id IS NULL AND c.anonimizada_at IS NULL
         AND (c.dui IS NULL OR r.dui IS NULL
              OR regexp_replace(c.dui, '\D', '', 'g') = regexp_replace(r.dui, '\D', '', 'g')) THEN
        UPDATE public.customers SET
          erp_id = r.erp_id,
          nit = coalesce(nit, r.nit), dui = coalesce(dui, r.dui), nrc = coalesce(nrc, r.nrc),
          phone = coalesce(phone, r.phone), telefono2 = coalesce(telefono2, r.telefono2),
          email = coalesce(email, r.email), direccion = coalesce(direccion, r.direccion),
          pasaporte = coalesce(pasaporte, r.pasaporte), departamento = coalesce(departamento, r.departamento),
          municipio = coalesce(municipio, r.municipio), distrito = coalesce(distrito, r.distrito),
          categoria = coalesce(categoria, r.categoria), giro = coalesce(giro, r.giro),
          retencion_pct = coalesce(retencion_pct, r.retencion_pct), updated_at = now()
        WHERE id = c.id;
        v_vinculadas := v_vinculadas + 1;
      ELSE
        v_ocupado := v_ocupado || jsonb_build_object('erp_id', r.erp_id, 'nombre', v_nombre, 'customer_id', c.id, 'su_erp_id', c.erp_id);
      END IF;
      CONTINUE;
    END IF;

    INSERT INTO public.customers
      (name, erp_id, nit, dui, nrc, phone, telefono2, email, direccion, pasaporte,
       departamento, municipio, distrito, categoria, giro, retencion_pct)
    VALUES
      (v_nombre, r.erp_id, r.nit, r.dui, r.nrc, r.phone, r.telefono2, r.email, r.direccion, r.pasaporte,
       r.departamento, r.municipio, r.distrito, r.categoria, r.giro, r.retencion_pct);
    v_creadas := v_creadas + 1;
  END LOOP;

  RETURN json_build_object('creadas', v_creadas, 'vinculadas', v_vinculadas,
                           'ya_estaban', v_ya, 'nombre_ocupado', v_ocupado);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.clientes_importar_de_caja(json) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clientes_importar_de_caja(json) TO service_role;
