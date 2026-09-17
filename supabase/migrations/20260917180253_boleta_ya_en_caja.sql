SET lock_timeout = '5s';

-- ── ¿Ese número de boleta ya se anotó en esta sala? ────────────────────────
--
-- El gemelo de `boleta_ya_registrada`, que hace lo mismo para las bolsas. El
-- cajón no lo tenía, y por eso los duplicados de septiembre no chocaron con
-- nada: el aviso y el índice único viven en `bolsas_operaciones`, y el camino
-- del cajón escribe en otra tabla.
--
-- El número de boleta de un POS es el ID de la transacción: no se repite nunca
-- en el mismo aparato. Así que dos filas con el mismo número en la misma sala
-- hablan SIEMPRE de la misma operación — o es un duplicado, o es la corrección
-- deliberada de un movimiento anotado al revés (medido: las tres correcciones
-- reales son una ENTRADA contra una SALIDA).
--
-- Devuelve el `tipo` (ENTRADA/SALIDA) para que quien pregunta pueda distinguir
-- esos dos casos: mismo sentido = duplicado, sentido contrario = corrección.
--
-- Se comparan sólo los DÍGITOS y sin ceros de adelante: el mismo papel se
-- escribe «000467», «467» y «# 467».
--
-- INVOKER a propósito: que el RLS siga decidiendo qué salas puede mirar quien
-- pregunta, igual que su gemelo.
CREATE OR REPLACE FUNCTION public.boleta_ya_en_caja(p_branch_id bigint, p_numero_boleta text)
RETURNS json
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(json_agg(to_json(t)), '[]'::json)
  FROM (
    SELECT m.id, m.tipo, m.tipo_codigo, m.monto, m.concepto, m.numero_boleta,
           m.fecha, m.registrado_at
    FROM public.caja_movimientos_portal m
    WHERE m.branch_id = p_branch_id
      AND m.anulado_at IS NULL
      AND m.numero_boleta IS NOT NULL
      AND ltrim(regexp_replace(p_numero_boleta, '\D', '', 'g'), '0') <> ''
      AND ltrim(regexp_replace(m.numero_boleta, '\D', '', 'g'), '0')
        = ltrim(regexp_replace(p_numero_boleta, '\D', '', 'g'), '0')
    ORDER BY m.registrado_at DESC
    LIMIT 5
  ) t;
$function$;

REVOKE EXECUTE ON FUNCTION public.boleta_ya_en_caja(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.boleta_ya_en_caja(bigint, text) TO authenticated, service_role;
