SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- El autovacuum de una tabla de SEIS filas no tiene por qué correr cada 9 min
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Es lo único que quedó en pie del hallazgo «402 escrituras/h sobre 6 filas de
-- impresion_dispositivos» de la auditoría del 2026-08-23. Ese hallazgo estaba
-- mal concluido —el número era exacto y la comparación con el churn de
-- `inventory` no: son **100% HOT**, o sea que ninguna de esas escrituras rehace
-- una entrada de índice, y la tabla entera pesa 152 kB— pero al medirlo apareció
-- esto, que sí es real.
--
-- ── Qué se midió ────────────────────────────────────────────────────────────
--
-- | tabla                    | filas | updates/día | autovacuums/día | HOT  |
-- |--------------------------|------:|------------:|----------------:|-----:|
-- | `impresion_dispositivos` |     6 |       9.429 |         **159** | 100% |
-- | `session_activity`       |    22 |       1.096 |          **22** | 100% |
--
-- 683 autovacuums en 4,3 días sobre seis filas: uno cada nueve minutos.
--
-- ── Por qué pasa ────────────────────────────────────────────────────────────
-- El disparador por defecto es `threshold 50 + scale_factor 0.2 × filas`. Está
-- pensado para tablas grandes, donde el 20% es mucho. Sobre SEIS filas da
-- 50 + 1,2 = **51,2 tuplas muertas**, así que dispara cada 51 updates — medido:
-- uno cada 59. La tabla es el latido de las seis cajas de impresión, o sea que
-- se reescribe para siempre y el autovacuum la persigue sin nada que ganar.
--
-- Y con **100% HOT** el trabajo es todavía menos necesario: el «page pruning»
-- recupera el espacio de la versión vieja dentro de la propia página al leerla,
-- sin esperar al vacuum.
--
-- ── El número ───────────────────────────────────────────────────────────────
-- `threshold = 1000`, uniforme para las dos: deja el autovacuum en ~9/día en
-- impresión y ~1/día en sesiones, contra 159 y 22. Es una reducción del **94%**
-- sin dejar de correr — no se apaga, se le saca la prisa.
--
-- No se toca `scale_factor`: sobre seis filas aporta 1,2 y no cambia nada. Y no
-- se toca el congelado (`freeze_max_age`), que corre por su cuenta y es lo que
-- previene el wraparound: esto no lo afecta.
--
-- ── Lo que NO se toca, y por qué ────────────────────────────────────────────
-- El mismo patrón lo tienen `http_request_queue` (155/día) y `subscription`
-- (98/día), pero **ninguna de las dos es del portal**: son de `pg_net` y de
-- Realtime. Ajustarle los parámetros a una tabla de una extensión es pelearse
-- con quien la mantiene, y su rotación es por INSERT/DELETE, no por update.
--
-- ── Riesgo ──────────────────────────────────────────────────────────────────
-- `ALTER TABLE … SET (…)` de parámetros de almacenamiento **no reescribe la
-- tabla**: es un cambio de catálogo. Verificado en el entorno de pruebas — el
-- `relfilenode` no cambia. Toma un lock ACCESS EXCLUSIVE de un instante, y va
-- con `lock_timeout` igual, por la regla del incidente del 2026-07-08.

ALTER TABLE public.impresion_dispositivos SET (autovacuum_vacuum_threshold = 1000);
ALTER TABLE public.session_activity       SET (autovacuum_vacuum_threshold = 1000);

COMMENT ON TABLE public.impresion_dispositivos IS
'El latido de las cajas de impresión: cada una avisa que sigue viva. Seis filas que se reescriben ~9.400 veces al día, y es 100% HOT — ninguna de esas escrituras rehace una entrada de índice. Su autovacuum lleva `threshold = 1000` desde el 2026-08-24: con el default (50 + 20% de 6 filas) disparaba cada 51 updates, o sea 159 veces al día sobre 152 kB.';
