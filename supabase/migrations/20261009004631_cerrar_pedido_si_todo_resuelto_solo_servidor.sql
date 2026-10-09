-- 01 · cerrar_pedido_si_todo_resuelto: sólo la puede llamar el servidor (2026-10-08).
--
-- Es SECURITY DEFINER, no chequea nada y FIRMA con `p_actor`, que manda quien
-- llama. Hasta hoy cualquier sesión (`authenticated`) podía ejecutarla con un
-- pedido cualquiera: lo pasaba a 'completado' y le ponía a la sala la
-- «corrección confirmada» a nombre de otra persona. La pantalla no la ofrece;
-- bastaba con mandar la petición a mano.
--
-- Quién la llama, medido el 2026-10-08:
--   · en la base, cinco funciones, las cinco SECURITY DEFINER:
--     resolve_pedido_item, decidir_diferencia_pedido, confirmar_llegada_diferencia,
--     cerrar_item_por_devolucion y cerrar_no_reenviadas. Como corren con el
--     dueño de la función, el REVOKE no las toca.
--   · en el frontend (`src/`, `apps/`) y en `supabase/functions/`: nadie.
--     Sólo aparece en `src/types/database.ts`, que es el contrato generado.
--   · ningún cron.
--
-- ⚠ gate:alcance: su firma es (p_pedido_id, p_suc_id, p_actor) y la regla del
-- gate busca `branch|sala|sucursal` en los argumentos — `p_suc_id` no
-- coincide, así que el gate no la ve y declararla en el manifiesto lo haría
-- FALLAR («declarada y ya no recibe sucursal»). Queda cubierta por el chequeo
-- general de EXECUTE, no por el manifiesto.
SET lock_timeout = '5s';

REVOKE EXECUTE ON FUNCTION public.cerrar_pedido_si_todo_resuelto(uuid, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.cerrar_pedido_si_todo_resuelto(uuid, integer, uuid) TO service_role;
