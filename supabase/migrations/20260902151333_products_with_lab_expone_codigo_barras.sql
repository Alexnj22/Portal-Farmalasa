-- El buscador de «Reglas de despacho» no devolvía NADA desde el 2026-08-22.
--
-- Ese día se centralizó el filtro de producto en `filtroProductoOCodigo`, que
-- busca por `nombre_norm` O por `codigo_barras` — pedido del usuario para poder
-- escanear la caja en vez de escribir el nombre. Los otros cinco buscadores
-- consultan `products`, que tiene las dos columnas. Éste consulta la vista
-- `products_with_lab`, que expone `nombre_norm` pero NO `codigo_barras`.
--
-- PostgREST responde 400 `column products_with_lab.codigo_barras does not
-- exist` y el `catch` del navegador pinta la lista vacía: la pantalla dice
-- «Sin resultados para "acet"» y nadie ve un error. Once días así.
--
-- La vista es un passthrough sobre `products` —igual que cuando se le agregó
-- `nombre_norm` el 2026-07-17—, así que la corrección es exponer la columna,
-- no recortarle el buscador a esta pantalla: escanear tiene que funcionar
-- donde hay productos, que es la regla que se escribió aquel día.
SET lock_timeout = '5s';

CREATE OR REPLACE VIEW public.products_with_lab
WITH (security_invoker = true) AS
SELECT p.id,
       p.nombre,
       p.es_antibiotico,
       p.activo,
       p.laboratorio_id,
       l.nombre AS laboratorio_nombre,
       p.nombre_norm,
       p.codigo_barras
  FROM public.products p
  LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id;
