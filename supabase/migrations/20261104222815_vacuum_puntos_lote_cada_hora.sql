-- `puntos_lote` con el mapa de visibilidad viejo: el motor de puntos
-- (`puntos-motor-1min`, 1,264 corridas al día) pregunta en cada vuelta qué
-- facturas de los últimos 3 días todavía no tienen su lote, y ese anti-join
-- recorre el índice `puntos_lote_una_por_venta` entero. Con la mitad de las
-- páginas sin marcar como visibles, el index-only scan iba al heap 13,008
-- veces: 9,400 de los 14,623 bloques de `ventas_elegibles_puntos`.
--
-- Medido el 2026-11-04: un VACUUM a mano lo bajó a 5,266 bloques (−64%) y de
-- 35 a 29 ms, con la misma salida. `puntos_lote` recibe updates de `restantes`
-- (canjes, vencimientos) que vuelven a ensuciar páginas viejas, y el
-- autovacuum por inserción no las alcanza. Mismo patrón que
-- `vacuum-sales-invoice-items`, a los `:10` para no coincidir. VACUUM toma
-- SHARE UPDATE EXCLUSIVE: no frena lecturas ni las escrituras del motor.
SELECT cron.schedule(
  'vacuum-puntos-lote',
  '10 12-23,0-5 * * *',
  'VACUUM ANALYZE puntos_lote'
);
