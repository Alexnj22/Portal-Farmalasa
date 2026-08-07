-- Un motivo más: la ficha suelta que parece duplicado pero cuyo nombre no
-- coincide con el de su contraparte.
--
-- La deduplicación (`resolver_observaciones.py --deduplicar`) une fichas cuando
-- el número interno dice que son el mismo cliente. Cuando además los nombres se
-- parecen, fusiona sin preguntar. Cuando NO se parecen, no toca nada y publica
-- acá — unir a dos personas que no lo son mezcla sus historiales y eso no se
-- deshace.
--
-- Los cuatro casos del 2026-08-06:
--   IRENE PASTORA                → IRENE PINEDA
--   JEYBI CALDERON               → HEYVI CALDERON
--   ARQUIMIDES FORNOS            → ARQUIMIDES FERNANDEZ
--   MARIA URBINA VDA. DE MORALES → «NO APARECE»   ← el destino es basura
--
-- No hace falta tocar `get_clientes_por_revisar`: la vista deriva la familia
-- 'congelado' de `fiscal_congelado` y manda todo lo demás a 'repetido', que es
-- donde corresponde. Por eso el motivo aparece en la pestaña sin cambiar la UI.

SET lock_timeout = '5s';

ALTER TABLE public.clientes_por_revisar
  DROP CONSTRAINT IF EXISTS clientes_por_revisar_motivo_check;

ALTER TABLE public.clientes_por_revisar
  ADD CONSTRAINT clientes_por_revisar_motivo_check
  CHECK (motivo = ANY (ARRAY[
    'fiscal_congelado'::text,
    'nombre_repetido'::text,
    'dui_repetido'::text,
    'nit_repetido'::text,
    'fusion_dudosa'::text]));
