-- 11 · Aviso «Sala X lista para salir · N cajas» a quien arma las rutas (2026-10-08).
--
-- Medido: de «lista» (finalizado_at) a «salió» (la ruta) el p90 es 17 horas.
-- Nadie se entera de que una sala quedó lista salvo que abra la pestaña: no
-- hay aviso. Los avisos del camino del pedido ya viven en la base
-- (`avisar_camino_del_pedido`, migración 20260928153240): éste es el que
-- faltaba, el de bodega a bodega.
--
-- A quién: las personas ACTIVAS de la sucursal de Bodega cuyo cargo
-- (principal o secundario) tiene `pedidos_tab_rutas` EDITAR — o sea quien
-- puede armar la ruta. Medido el 2026-10-08: 5 Auxiliares de Bodega. Fuera
-- quedan Administrador, Talento Humano y Supervisión, que también pueden
-- editar rutas pero no están en la bodega: un aviso por cada sala lista a
-- gente que no despacha es ruido. `notify_employees` no se lo manda a quien
-- finalizó.
--
-- Cuándo: cuando la sala tiene `finalizado_at` Y `total_cajas`, lo que llegue
-- último. El camino viejo escribía `finalizado_at` y las cajas en dos
-- UPDATE; `finalizar_sala_con_cajas` (07) los escribe en la misma
-- transacción pero también en dos sentencias. Disparando por «los dos ya
-- están», el aviso dice el número de cajas en los dos caminos.
--
-- Sin duplicados: la marca es `avisos_emitidos` con clave
-- `PEDIDO_LISTO:<id de pedido_sucursal_status>` y recipient NULL (el índice
-- único es NULLS NOT DISTINCT). Si alguien des-finaliza y vuelve a finalizar,
-- no se repite.
--
-- Un fallo del aviso NO tumba el finalizado: va en su propio bloque con
-- `aviso_de_pedido_fallo`, como todos los avisos de pedido.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.avisar_sala_lista_para_salir()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_num   integer;
  v_sala  text;
  v_bod   integer;
  v_dest  uuid[];
  v_cajas integer := coalesce(NEW.total_cajas, 0);
  v_txt   text;
BEGIN
  BEGIN
    INSERT INTO public.avisos_emitidos (clave, recipient_id)
    VALUES ('PEDIDO_LISTO:' || NEW.id, NULL)
    ON CONFLICT DO NOTHING;
    IF NOT FOUND THEN RETURN NULL; END IF;

    SELECT numero INTO v_num FROM public.pedidos WHERE id = NEW.pedido_id AND status <> 'anulado';
    IF v_num IS NULL THEN RETURN NULL; END IF;
    SELECT nombre INTO v_sala FROM public.erp_sucursal_map WHERE erp_sucursal_id = NEW.erp_sucursal_id;
    SELECT branch_id INTO v_bod FROM public.erp_sucursal_map WHERE es_bodega LIMIT 1;

    SELECT array_agg(DISTINCT e.id) INTO v_dest
      FROM public.employees e
      JOIN public.role_permissions rp
        ON rp.role_id IN (e.role_id, e.secondary_role_id)
       AND rp.module_key = 'pedidos_tab_rutas' AND rp.can_edit
     WHERE e.status = 'ACTIVO' AND e.branch_id = v_bod;
    IF v_dest IS NULL THEN RETURN NULL; END IF;

    v_txt := coalesce(v_sala, 'Sucursal ' || NEW.erp_sucursal_id) || ' lista para salir · '
          || v_cajas || ' caja' || CASE WHEN v_cajas <> 1 THEN 's' ELSE '' END;
    PERFORM public.notify_employees(v_dest, 'PEDIDO_TRACKING', v_txt,
      'El pedido #' || v_num || ' de ' || coalesce(v_sala, 'la sucursal') || ' está preparado y espera ruta.',
      '/pedidos', public.meta_de_pedido(ARRAY[v_num], v_sala, 'listo', v_cajas), true, v_bod);
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.aviso_de_pedido_fallo('listo_para_salir', NEW.pedido_id, SQLERRM);
  END;
  RETURN NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.avisar_sala_lista_para_salir() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_avisar_sala_lista_para_salir ON public.pedido_sucursal_status;
CREATE TRIGGER trg_avisar_sala_lista_para_salir
  AFTER UPDATE ON public.pedido_sucursal_status
  FOR EACH ROW
  WHEN (NEW.finalizado_at IS NOT NULL AND NEW.total_cajas IS NOT NULL
        AND (OLD.finalizado_at IS NULL OR OLD.total_cajas IS NULL))
  EXECUTE FUNCTION public.avisar_sala_lista_para_salir();
