SET lock_timeout = '5s';

-- Una ficha del portal sin número del ERP y SIN ninguna factura no se puede
-- resolver: no hay documento del cual deducir a qué cliente del ERP pertenece.
-- Hasta ahora terminaba en un `continue` mudo — sin contador y sin destino— así
-- que la corrida decía «92 candidatos, 0 acciones» y parecía no hacer nada.
-- Es el mismo error que veníamos corrigiendo todo el día: el silencio se lee
-- igual que el éxito. Medido: 14 fichas pasaron de invisibles a «Por revisar».
ALTER TABLE public.clientes_por_revisar
  DROP CONSTRAINT IF EXISTS clientes_por_revisar_motivo_check;
ALTER TABLE public.clientes_por_revisar
  ADD CONSTRAINT clientes_por_revisar_motivo_check
  CHECK (motivo = ANY (ARRAY[
    'fiscal_congelado'::text, 'nombre_repetido'::text, 'dui_repetido'::text,
    'nit_repetido'::text, 'fusion_dudosa'::text, 'rechazo_persistente'::text,
    'erp_id_inexistente'::text, 'erp_rechaza_duplicado'::text,
    'sin_numero_erp'::text]));
