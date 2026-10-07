SET lock_timeout = '5s';
-- El nivel de varios clientes en una llamada (2026-10-07): para el aviso
-- «subiste de nivel» y para la oferta temprana de Platino.
CREATE OR REPLACE FUNCTION public.app_niveles_de(p_clientes bigint[])
RETURNS TABLE (customer_id bigint, clave text, nombre text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT c, n.clave, n.nombre
    FROM unnest(p_clientes) c,
         LATERAL public.puntos_nivel_de(public.puntos_compra_12m(c, (now() AT TIME ZONE 'America/El_Salvador')::date, NULL)) n;
$$;
REVOKE EXECUTE ON FUNCTION public.app_niveles_de(bigint[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_niveles_de(bigint[]) TO service_role;

-- Quien ya tiene la app y ya está en Plata/Oro/Platino no recibe un «subiste»
-- retroactivo: se anota su nivel actual como ya avisado.
INSERT INTO public.app_cliente_avisos (customer_id, tipo, ref, titulo, cuerpo, enviado, leido_at)
SELECT n.customer_id, 'nivel', 'nivel:' || n.clave, 'Nivel ' || n.nombre, 'Nivel vigente al activar el aviso.', true, now()
  FROM public.app_niveles_de(ARRAY(SELECT DISTINCT s.customer_id FROM public.app_cliente_sesiones s WHERE s.revocada_at IS NULL)) n
 WHERE n.clave <> 'vip'
ON CONFLICT DO NOTHING;
