-- Branch 3 (sin historial) ahora devuelve alert_status='dead_stock' e is_dead_stock=true.
-- Antes devolvía 'out_of_stock'/'ok' y false, por eso el filtro "Sin historial"
-- siempre mostraba 0 — el status 'no_data' nunca era emitido.
-- Ahora estos productos aparecen junto a los de Branch 2 bajo "Sin movimiento".

-- (SQL completo de la función en la migración apply_migration correspondiente)
