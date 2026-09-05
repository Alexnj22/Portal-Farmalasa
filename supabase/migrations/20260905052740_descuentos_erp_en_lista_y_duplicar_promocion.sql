SET lock_timeout = '5s';

-- ── El descuento de una promoción son VARIOS ─────────────────────────────
--
-- `promociones.descuento_erp_id` guardaba UN id. Al construir «marcá las salas
-- donde aplica» hizo falta más de uno, y por eso pasa a lista.
--
-- ⚠️ **La medición POSTERIOR acotó para qué sirve.** El sistema de ventas
-- rechaza un segundo descuento del mismo producto con fechas que se cruzan
-- **aunque sea en otra sala** —«El producto 4792 ya tiene una promocion activa
-- en esa fecha»—; con fechas que no se cruzan, lo acepta. O sea que «un
-- descuento por cada sala marcada» es IMPOSIBLE, y la pantalla pide elegir uno.
-- La lista se queda igual: una promoción puede juntar descuentos de ventanas
-- distintas, y guardar UN id volvería a perder los anteriores en silencio.
--
-- Se migra limpio porque hay 0 promociones en producción.
ALTER TABLE public.promociones
  ADD COLUMN IF NOT EXISTS descuentos_erp integer[] NOT NULL DEFAULT '{}';

UPDATE public.promociones
   SET descuentos_erp = ARRAY[descuento_erp_id]
 WHERE descuento_erp_id IS NOT NULL
   AND descuentos_erp = '{}';

DROP INDEX IF EXISTS promociones_descuento_erp_id_idx;
ALTER TABLE public.promociones DROP COLUMN IF EXISTS descuento_erp_id;

COMMENT ON COLUMN public.promociones.descuentos_erp IS
  'Ids de los descuentos que esta promoción tiene en el sistema de ventas. Vacío = no descuenta.';

CREATE INDEX IF NOT EXISTS promociones_descuentos_erp_idx
  ON public.promociones USING gin (descuentos_erp)
  WHERE descuentos_erp <> '{}';


-- ── Duplicar una promoción ───────────────────────────────────────────────
--
-- Decidido con el usuario el 2026-09-05, y la distinción importa: **esto no es
-- el truco que se descartó** de partir una campaña en dos para saltarse un tope
-- inventado. Acá se duplica porque las condiciones son GENUINAMENTE distintas
-- por sala —otro porcentaje, otro monto, otras fechas— y entonces son campañas
-- distintas, no una partida en pedazos.
--
-- `p_branch_id` acota la copia a UNA sala: su reparto queda con esa sola, así
-- que el bono de la copia sólo cuenta las ventas de ahí (ver 20260905052131).
-- Medido: el original daba 30 filas / 129 unidades y la copia acotada a Salud 2
-- dio 4 filas / 30 unidades, que es lo que esa sala vendió.
--
-- **No copia el descuento del sistema de ventas.** La copia nace sin
-- `descuentos_erp`: crear allá un descuento es una escritura a un sistema
-- ajeno, y hacerla en silencio al duplicar dejaría descuentos vivos que nadie
-- pidió. Se agrega desde la copia, a la vista. (Y encima el sistema de ventas
-- lo rechazaría por la ventana de fechas del original.)
CREATE OR REPLACE FUNCTION public.duplicar_promocion(
    p_id        bigint,
    p_nombre    text,
    p_branch_id bigint DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_actor   uuid := public.auth_employee_id();
    v_nuevo   bigint;
    v_nombre  text := nullif(btrim(coalesce(p_nombre,'')), '');
    v_r       record;
    v_reng    bigint;
    v_n       integer := 0;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED';
    END IF;
    IF NOT public.auth_has_module_permission('promociones','can_edit') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere editar en Promociones';
    END IF;
    IF v_nombre IS NULL THEN
        RAISE EXCEPTION 'NOMBRE_REQUERIDO: la copia necesita su propio nombre';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.promociones WHERE id = p_id) THEN
        RAISE EXCEPTION 'NO_EXISTE: esa promoción ya no está';
    END IF;

    -- La copia nace en BORRADOR aunque el original esté activa: duplicar no es
    -- lanzar. Y sin `descuentos_erp` — ver el encabezado.
    INSERT INTO public.promociones (nombre, nota, creado_por, tipo, paga, supplier_id)
    SELECT v_nombre, p.nota, v_actor, p.tipo, p.paga, p.supplier_id
      FROM public.promociones p WHERE p.id = p_id
    RETURNING id INTO v_nuevo;

    FOR v_r IN
        SELECT * FROM public.promocion_renglon r WHERE r.promocion_id = p_id ORDER BY r.id
    LOOP
        INSERT INTO public.promocion_renglon (
            promocion_id, erp_product_id, factor_unidades, inicio, fin,
            lote_total, tiene_bono, paga, supplier_id)
        VALUES (v_nuevo, v_r.erp_product_id, v_r.factor_unidades, v_r.inicio, v_r.fin,
                v_r.lote_total, v_r.tiene_bono, v_r.paga, v_r.supplier_id)
        RETURNING id INTO v_reng;

        -- La tarifa VIGENTE del original, no su historia: la copia empieza con
        -- lo que se está pagando hoy, y su propio historial arranca limpio.
        INSERT INTO public.promocion_renglon_tarifa (
            renglon_id, desde, bono_vendedor, bono_adm, bono_bodega, unidades_por_bono, creado_por)
        SELECT v_reng, v_r.inicio, t.bono_vendedor, t.bono_adm, t.bono_bodega,
               t.unidades_por_bono, v_actor
          FROM public.promocion_renglon_tarifa t
         WHERE t.renglon_id = v_r.id
         ORDER BY t.desde DESC LIMIT 1;

        IF p_branch_id IS NOT NULL THEN
            INSERT INTO public.promocion_reparto (renglon_id, branch_id, asignado_original, asignado_vigente)
            SELECT v_reng, p_branch_id,
                   coalesce((SELECT pr.asignado_original FROM public.promocion_reparto pr
                              WHERE pr.renglon_id = v_r.id AND pr.branch_id = p_branch_id), 0),
                   coalesce((SELECT pr.asignado_original FROM public.promocion_reparto pr
                              WHERE pr.renglon_id = v_r.id AND pr.branch_id = p_branch_id), 0);
        ELSE
            INSERT INTO public.promocion_reparto (renglon_id, branch_id, asignado_original, asignado_vigente)
            SELECT v_reng, pr.branch_id, pr.asignado_original, pr.asignado_original
              FROM public.promocion_reparto pr WHERE pr.renglon_id = v_r.id;
        END IF;

        v_n := v_n + 1;
    END LOOP;

    IF v_n = 0 THEN
        RAISE EXCEPTION 'SIN_PRODUCTOS: la promoción que se copia no tiene productos';
    END IF;

    PERFORM public.promocion_log(
        v_nuevo, NULL, NULL, 'creada', NULL, v_nombre,
        'copia de #' || p_id || ' · ' || v_n || ' producto(s)');

    RETURN json_build_object('id', v_nuevo, 'renglones', v_n);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.duplicar_promocion(bigint, text, bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.duplicar_promocion(bigint, text, bigint) TO authenticated, service_role;
