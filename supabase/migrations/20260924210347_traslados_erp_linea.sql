SET lock_timeout = '5s';

-- Los traslados que el sistema de la caja registró, renglón por renglón.
--
-- Existe para contestar «¿cuándo entró este producto a esta sala?». El portal
-- ya sabe lo que ÉL movió (`pedido_traslado_linea` desde el 12-ago,
-- `envio_linea` desde el 24-ago), pero no lo que se trasladó a mano en el
-- sistema ni lo de antes de esas fechas. Sin eso, un producto que Bodega mandó
-- en abril se lee como «seis meses parado» y el aviso de productos sin venta lo
-- devolvería recién llegado.
--
-- Historial de negocio: NO se purga (misma regla que los precios y el MIN·MAX).
-- Se escribe sólo con `registrar_traslados_erp`, y sólo inserta: un traslado
-- ya leído no cambia, así que no hay UPDATE que churnee la tabla.
CREATE TABLE public.traslados_erp_linea (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_traslado           integer     NOT NULL,
    posicion              smallint    NOT NULL,
    fecha                 date        NOT NULL,
    erp_sucursal_destino  smallint,
    descripcion           text        NOT NULL,
    presentacion          text,
    unidad                numeric,
    cantidad              numeric,
    erp_product_id        integer REFERENCES public.products(id),
    fuente                text        NOT NULL CHECK (fuente IN ('listado', 'recorrido')),
    created_at            timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id_traslado, posicion)
);

CREATE INDEX traslados_erp_linea_entrada_idx
    ON public.traslados_erp_linea (erp_sucursal_destino, erp_product_id, fecha DESC);
CREATE INDEX traslados_erp_linea_product_idx
    ON public.traslados_erp_linea (erp_product_id);

ALTER TABLE public.traslados_erp_linea ENABLE ROW LEVEL SECURITY;

CREATE POLICY traslados_erp_linea_select ON public.traslados_erp_linea
    FOR SELECT TO authenticated
    USING (
        (SELECT public.auth_has_module_permission('gestion_stock', 'can_view'))
        OR (SELECT public.auth_has_module_permission('traslados', 'can_view'))
    );

REVOKE ALL ON public.traslados_erp_linea FROM anon;

-- Escribe un lote de renglones leídos del sistema. El producto se liga por
-- NOMBRE exacto normalizado (`products.nombre_norm`): `ver_traslado.php` no da
-- el id, y los nombres del catálogo son únicos (5,238 de 5,238). Sin
-- coincidencia queda NULL — el renglón se guarda igual, porque perder la
-- entrada sería peor que no saber de qué producto es.
CREATE OR REPLACE FUNCTION public.registrar_traslados_erp(p_lineas jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    n integer;
BEGIN
    INSERT INTO public.traslados_erp_linea
        (id_traslado, posicion, fecha, erp_sucursal_destino, descripcion,
         presentacion, unidad, cantidad, erp_product_id, fuente)
    SELECT (l->>'id_traslado')::int,
           (l->>'posicion')::smallint,
           (l->>'fecha')::date,
           nullif(l->>'destino', '')::smallint,
           l->>'descripcion',
           nullif(l->>'presentacion', ''),
           nullif(l->>'unidad', '')::numeric,
           nullif(l->>'cantidad', '')::numeric,
           (SELECT p.id FROM public.products p
             WHERE p.nombre_norm = public.norm_search(l->>'descripcion')
             LIMIT 1),
           l->>'fuente'
      FROM jsonb_array_elements(p_lineas) l
    ON CONFLICT (id_traslado, posicion) DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.registrar_traslados_erp(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_traslados_erp(jsonb) TO service_role;
