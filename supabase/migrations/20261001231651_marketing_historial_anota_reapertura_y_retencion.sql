-- El historial se disparaba con `UPDATE OF estado, fecha`, y un trigger con
-- lista de columnas sólo mira las que trae el SET: cuando una pieza aprobada
-- vuelve sola a «finalizado» porque se le editó el texto (lo hace un trigger
-- BEFORE), el estado cambia sin estar en el SET y el historial no lo anotaba.
-- Tampoco la retención automática para las salas. Lo cazó la prueba con
-- rollback contra producción.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.marketing_anotar_pieza()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_yo uuid := public.auth_employee_id();
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.marketing_historial (mes_id, pieza_id, titulo, evento, a, actor)
        VALUES (NEW.mes_id, NEW.id, NEW.titulo, 'creada', NEW.estado, v_yo);
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.estado IS DISTINCT FROM OLD.estado THEN
            INSERT INTO public.marketing_historial (mes_id, pieza_id, titulo, evento, de, a, actor)
            VALUES (NEW.mes_id, NEW.id, NEW.titulo, 'estado', OLD.estado, NEW.estado, v_yo);
        END IF;
        IF NEW.fecha IS DISTINCT FROM OLD.fecha THEN
            INSERT INTO public.marketing_historial (mes_id, pieza_id, titulo, evento, de, a, actor)
            VALUES (NEW.mes_id, NEW.id, NEW.titulo, 'fecha', OLD.fecha::text, NEW.fecha::text, v_yo);
        END IF;
        -- La retención AUTOMÁTICA (volvió a revisión). La que hace una persona
        -- la anota `marketing_liberar_pieza`, con la marca puesta.
        IF OLD.liberada AND NOT NEW.liberada
           AND coalesce(current_setting('marketing.por_funcion', true), '') <> 'si' THEN
            INSERT INTO public.marketing_historial (mes_id, pieza_id, titulo, evento, a, actor)
            VALUES (NEW.mes_id, NEW.id, NEW.titulo, 'retenida', 'volvió a revisión', v_yo);
        END IF;
    ELSIF EXISTS (SELECT 1 FROM public.marketing_meses WHERE id = OLD.mes_id) THEN
        INSERT INTO public.marketing_historial (mes_id, pieza_id, titulo, evento, de, actor)
        VALUES (OLD.mes_id, NULL, OLD.titulo, 'quitada', OLD.estado, v_yo);
    END IF;
    RETURN NULL;
END $$;

DROP TRIGGER marketing_piezas_historial ON public.marketing_piezas;
CREATE TRIGGER marketing_piezas_historial AFTER INSERT OR UPDATE OR DELETE
    ON public.marketing_piezas FOR EACH ROW EXECUTE FUNCTION public.marketing_anotar_pieza();

REVOKE EXECUTE ON FUNCTION public.marketing_anotar_pieza() FROM PUBLIC, anon, authenticated;
