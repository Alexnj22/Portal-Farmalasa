# Notas de crédito de venta → descontar puntos (propuesta, 2026-10-09)

**No aplicada.** Hoy no se emiten notas de crédito de venta (0 en 17 meses), así
que no hay prisa. Probada en el branch de pruebas con un escenario completo
(NC 40 % → quita 25 de 62; re-corrida → 0; NC 30 % → 19; invalidar la primera
devuelve 25; anular la factura quita sólo lo que queda).

- `migracion.sql`: tabla `ventas_nota_credito` (no columna en `sales_invoices`,
  tabla caliente), `venta_valida(estado, tipo_documento)` con lista blanca COF/CCF,
  salida `nota_credito`, `puntos_descontar_notas_credito` (idempotente) y
  `puntos_anular_venta` que resta lo ya quitado por NC. Aplicar entre
  06:00 y 11:59 UTC (FK a `sales_invoices`).
- `sync-dte-sales.patch`: `relacionDeNota` toma la factura de origen del
  `documentoRelacionado` del DTE. El formato real de una NC en el listado del
  origen todavía no se ha visto: revisar con la primera que llegue.

Al aplicar falta además: llamar a `puntos_descontar_notas_credito` desde
`puntos-motor` después de las anulaciones, y `AND g.no_recuperados > 0` en
`puntos_panel_avisos` y `puntos_vigilar_irregularidades`. Las otras ~55
funciones que usan `venta_valida(estado)` sin tipo se migran por tandas.
