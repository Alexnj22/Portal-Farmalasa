-- Facturas de mi Sala — el mapa línea→sala de Movistar, DEDUCIDO del dato.
--
-- No se preguntó a nadie: las recargas de Movistar ya estaban registradas como
-- compra con su sucursal, y el documento trae la línea adentro. Cruzando los dos
-- por monto exacto y fecha (+10 días) cada línea cayó en UNA sola sala:
--
--   78370041 → Salud 1   3 coincidencias, siempre $200.00
--   77097722 → Salud 2   2 coincidencias, siempre $99.99
--   61622865 → Salud 3   3 coincidencias, siempre $50.00
--
-- Ninguna línea apareció en dos sucursales, así que no hubo que desempatar.
--
-- ⚠ Por qué este cruce SÍ se puede creer acá y no sirve para el resto: cada
-- línea recarga un monto distinto y constante. Es exactamente la propiedad que
-- NO tienen el agua ni las recargas de Tigo/Claro —donde $184.68 se repite en 9
-- de 21 documentos— y por eso allá el reclamo tiene que ser manual. El mismo
-- método aplicado a esos daría emparejamientos falsos con la misma apariencia
-- de éxito.
--
-- Si mañana dos salas recargan el mismo monto, este mapa ya está escrito y no
-- depende del cruce: por eso se guarda como dato y no se recalcula.

SET lock_timeout = '5s';

INSERT INTO public.purchase_claim_lines (rule_id, linea, branch_id, nota)
SELECT r.id, v.linea, v.branch_id, v.nota
  FROM public.purchase_claim_rules r
  CROSS JOIN (VALUES
      ('78370041', 4::bigint,  'Deducido 2026-08-07: 3 recargas de $200.00 cruzadas contra compras de Salud 1.'),
      ('77097722', 25::bigint, 'Deducido 2026-08-07: 2 recargas de $99.99 cruzadas contra compras de Salud 2.'),
      ('61622865', 27::bigint, 'Deducido 2026-08-07: 3 recargas de $50.00 cruzadas contra compras de Salud 3.')
  ) AS v(linea, branch_id, nota)
 WHERE r.emisor_nit = '06142102971036' AND r.asignacion = 'linea'
ON CONFLICT (rule_id, linea) DO NOTHING;
