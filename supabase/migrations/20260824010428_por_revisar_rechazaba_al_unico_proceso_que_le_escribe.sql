-- «Por revisar» rechazaba, desde hacía 17 días, al único proceso que le escribe.
--
-- `upsert_clientes_por_revisar` exige `auth_can_edit_any('clientes')`. Quien la
-- llama es `sincronizar-fichas-clientes`, que corre con `service_role` y por
-- tanto NO tiene sesión ni empleado: `auth_can_edit_any` da false y la función
-- lanza «sin permiso para revisar clientes». Del otro lado, la Edge Function
-- hacía `if (error) console.error(...)` y seguía.
--
-- O sea que cada dato que el circuito no puede arreglar solo —una ficha
-- duplicada que el ERP se niega a guardar, un número interno inexistente, un
-- rechazo que ya se corrigió y volvió— se anunciaba a una tabla que rechazaba la
-- escritura, y el motivo terminaba en un log que no lee nadie. El contador de la
-- corrida decía `a_revisar: N` y en la tabla no entraba nada: **el número y la
-- pantalla decían cosas distintas y ninguna de las dos fallaba.**
--
-- Medido el 2026-08-24: 150 filas, la más nueva del **7 de agosto**, último
-- `updated_at` del 7 de agosto. La corrida corrió todas las noches desde
-- entonces. Diecisiete días de hallazgos perdidos.
--
-- Lo destapó JOSE MARDOQUEO RAMIREZ MEJIA (erp 16421): su factura
-- 0000065095_COF de Salud 2 llevaba cinco noches rebotando porque el ERP se
-- niega a guardar su ficha —hay dos con el mismo nombre—, la corrida lo detecta
-- y lo manda a «Por revisar»… y ahí se perdía. Al aplicar esto, la primera fila
-- nueva en 17 días fue exactamente ésa: «distrito: Ya se registro un cliente con
-- estos datos!».
--
-- El arreglo es el mismo idioma que ya usan `fusionar_cliente_duplicado` y
-- `calculate_stock_params`: `service_role` es el proceso automático, ya es de
-- confianza y no tiene empleado que resolver. Para cualquier otro, el permiso de
-- siempre.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.upsert_clientes_por_revisar(p_filas json)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_n integer;
BEGIN
  -- `service_role` es el proceso automático: ya es de confianza y no tiene
  -- empleado que resolver. Sin esta salida, el ÚNICO proceso que alimenta esta
  -- tabla es también el único que no puede escribirla.
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role'
     AND NOT (SELECT public.auth_can_edit_any(ARRAY['clientes'])) THEN
    RAISE EXCEPTION 'sin permiso para revisar clientes';
  END IF;

  WITH filas AS (
    SELECT * FROM json_to_recordset(p_filas) AS x(
        erp_id text, name text, motivo text, detalle text, datos jsonb)
  )
  INSERT INTO public.clientes_por_revisar
      (erp_id, name, motivo, detalle, datos, customer_id)
  SELECT f.erp_id, f.name, f.motivo, f.detalle, f.datos,
         (SELECT c.id FROM public.customers c WHERE c.erp_id = f.erp_id)
  FROM filas f
  ON CONFLICT (erp_id, motivo) DO UPDATE SET
      name        = EXCLUDED.name,
      detalle     = EXCLUDED.detalle,
      datos       = EXCLUDED.datos,
      customer_id = EXCLUDED.customer_id,
      updated_at  = now()
  -- Sin este guard, repoblar reescribe las 150 filas cada vez aunque nada haya
  -- cambiado: es el mismo churn de WAL que el proyecto prohíbe en los syncs.
  WHERE (public.clientes_por_revisar.name, public.clientes_por_revisar.detalle,
         public.clientes_por_revisar.datos, public.clientes_por_revisar.customer_id)
        IS DISTINCT FROM
        (EXCLUDED.name, EXCLUDED.detalle, EXCLUDED.datos, EXCLUDED.customer_id);

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;
