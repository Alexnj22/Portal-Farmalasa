SET lock_timeout = '5s';

-- ── EL NOMBRE SE SELLA EN LA FILA DEL CORTE, NO SE CRUZA EN CADA PANTALLA ────
--
-- `caja_cortes_del_portal` ya sabe quién apretó «Hacer corte». Lo que faltaba
-- era llevarlo a `cortes_caja.employee_id`, que es de donde leen las nueve
-- pantallas que muestran un corte. Cruzarlo en cada una es cómo se llega a que
-- dos pantallas digan cosas distintas del mismo corte — la lección de
-- `cobros_portal_efectivo`, que se resolvió con este mismo par de triggers.
--
-- Son DOS y ninguno sobra, porque el orden de llegada no está garantizado:
--
--   · `hacer-corte-caja` escribe la fila del portal y enseguida le pide al
--     sync que traiga el corte. Ahí la fila del portal llega PRIMERO, y el
--     trigger de `cortes_caja` la encuentra al insertar.
--   · Pero el corte existe en el origen en el instante en que se emite, así
--     que el barrido de cada 30 s puede traerlo en el hueco de un segundo que
--     hay entre emitirlo y anotar quién lo hizo. Ahí llega primero el corte
--     —y `ignoreDuplicates` del sync no lo volvería a tocar nunca—, así que
--     el sello lo pone el trigger del lado del portal.
--
-- Con los dos, el resultado no depende de quién llegó antes.

CREATE OR REPLACE FUNCTION public.cortes_caja_sella_quien_corto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    -- Sólo si viene vacío: un nombre ya escrito manda sobre este cruce.
    IF NEW.employee_id IS NULL THEN
        SELECT p.hecho_por INTO NEW.employee_id
        FROM public.caja_cortes_del_portal p
        WHERE p.branch_id = NEW.branch_id
          AND p.erp_corte_id = NEW.erp_corte_id;
    END IF;
    RETURN NEW;
END $$;

-- DEFINER a propósito, y no por privilegio: un trigger INVOKER que lee una
-- tabla con RLS ABORTA la escritura que sella cuando quien escribe no puede
-- leerla — ver `feedback_un_trigger_de_auditoria_invoker_aborta_la_escritura_que_audita`.
-- Acá el que inserta es el sync con la llave de servicio, pero atar la captura
-- de un corte al permiso de lectura de quien la dispare sería un modo de falla
-- que no tiene por qué existir.
REVOKE EXECUTE ON FUNCTION public.cortes_caja_sella_quien_corto() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS cortes_caja_quien_corto ON public.cortes_caja;
CREATE TRIGGER cortes_caja_quien_corto
  BEFORE INSERT ON public.cortes_caja
  FOR EACH ROW EXECUTE FUNCTION public.cortes_caja_sella_quien_corto();

CREATE OR REPLACE FUNCTION public.caja_cortes_del_portal_sella_el_corte()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    -- El corte puede no estar capturado todavía: entonces esto no hace nada y
    -- el sello lo pone el otro trigger al insertarlo. No es un fallo.
    UPDATE public.cortes_caja
       SET employee_id = NEW.hecho_por
     WHERE branch_id = NEW.branch_id
       AND erp_corte_id = NEW.erp_corte_id
       AND employee_id IS DISTINCT FROM NEW.hecho_por;
    RETURN NULL;
END $$;

REVOKE EXECUTE ON FUNCTION public.caja_cortes_del_portal_sella_el_corte() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS caja_cortes_portal_sella_el_corte ON public.caja_cortes_del_portal;
CREATE TRIGGER caja_cortes_portal_sella_el_corte
  AFTER INSERT ON public.caja_cortes_del_portal
  FOR EACH ROW EXECUTE FUNCTION public.caja_cortes_del_portal_sella_el_corte();

COMMENT ON COLUMN public.cortes_caja.employee_id IS
  'Quien hizo el corte, sellado desde `caja_cortes_del_portal`. NULL = se hizo '
  'desde la pantalla de la caja y no hay forma de saber quien: `empleado_texto` '
  'es el nombre de la CUENTA de la sala, no de una persona.';
