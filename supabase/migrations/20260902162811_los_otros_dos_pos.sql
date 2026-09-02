SET lock_timeout = '5s';

/* Los otros dos POS, dichos por el usuario (2-sep): Davivienda y Atlántida.
 *
 * `nombres_en_el_papel` lleva las formas en que el PROCESADOR se imprime arriba
 * del voucher, que no siempre es la marca con la que la empresa lo llama —
 * Davivienda estuvo en El Salvador como HSBC y después Banco Salvadoreño, y sus
 * terminales viejas todavía imprimen así. Se listan las variantes que se
 * conocen; el día que aparezca otra, es una fila y no un despliegue.
 *
 * ⚠️ Estos alias NO están verificados contra un voucher real de cada banco: son
 * los nombres esperables. Si un voucher bueno sale con «no se reconoció el
 * POS», la corrección es agregar acá lo que el papel dice de verdad — por eso
 * ese caso es un AVISO y no un freno. */
INSERT INTO public.pos_proveedores (codigo, nombre, nombres_en_el_papel, orden)
VALUES
  ('DAVIVIENDA', 'Davivienda', ARRAY['DAVIVIENDA', 'BANCO DAVIVIENDA'], 20),
  ('ATLANTIDA',  'Atlántida',  ARRAY['ATLANTIDA', 'BANCO ATLANTIDA'],   30)
ON CONFLICT (codigo) DO UPDATE
SET nombre = EXCLUDED.nombre,
    nombres_en_el_papel = EXCLUDED.nombres_en_el_papel,
    orden = EXCLUDED.orden,
    activo = true;
