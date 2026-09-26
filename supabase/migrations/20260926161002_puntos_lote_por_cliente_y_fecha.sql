-- `puntos_panel_clientes` (la vista Puntos → Consulta) calcula la última
-- acumulación de CADA cuenta —`max(ganado_el)` en `puntos_lote`— aunque la
-- pantalla muestre 25, porque el total y el orden se sacan del mismo conjunto.
-- Con sólo el índice por `customer_id`, cada una de las 10,632 cuentas leía
-- todos sus lotes para encontrar la fecha mayor.
--
-- Con (customer_id, ganado_el) el máximo es la última entrada del índice.
-- Medido con BEGIN…ROLLBACK, la carga inicial del panel (sin búsqueda, por
-- saldo): 1,039 → 73 ms, lecturas de disco 2,706 → 425. La cantidad de
-- bloques casi no cambia (~33,000): sigue consultando todas las cuentas. Bajar
-- eso es calcular la fecha sólo para la página visible —un cambio a la
-- función, que se deja a quien la mantiene (trabajo de puntos en curso)—.

SET lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS puntos_lote_por_cliente_y_fecha
    ON public.puntos_lote (customer_id, ganado_el);