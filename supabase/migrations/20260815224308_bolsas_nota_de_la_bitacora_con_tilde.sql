-- «Nacio al confirmarse el corte.» sale EN PANTALLA, en la bitácora de la bolsa.
--
-- Escribir sin tildes es la regla del PAPEL —el rollo de la ticketera es ASCII—
-- no de la pantalla, y esta nota nunca va al rollo: la lee quien abre el detalle
-- de una bolsa. Es la tercera vez que el mismo punto ciego deja texto de
-- interfaz mal escrito dentro de una función de Postgres, porque **el gate de
-- diseño no lee `supabase/`**.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.crear_bolsa_al_confirmar()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_monto numeric;
    v_bolsa public.bolsas;
BEGIN
    IF NEW.tipo <> 'C' THEN RETURN NEW; END IF;

    IF EXISTS (SELECT 1 FROM public.bolsas b
                WHERE b.corte_id = NEW.id AND b.estado <> 'ANULADA') THEN
        RETURN NEW;
    END IF;

    -- Nunca aborta la confirmacion por no tener nada que guardar.
    v_monto := public.bolsa_sugerida(NEW.id);
    IF v_monto IS NULL OR v_monto <= 0 THEN RETURN NEW; END IF;

    INSERT INTO public.bolsas
        (folio, branch_id, corte_id, origen, monto_inicial, fecha, hora, caja, cerrada_por)
    VALUES
        (public.nuevo_folio_de_bolsa(NEW.branch_id),
         NEW.branch_id, NEW.id, 'CORTE', v_monto,
         NEW.fecha, NEW.hora, NEW.empleado_texto, NEW.resuelto_por)
    RETURNING * INTO v_bolsa;

    INSERT INTO public.bolsas_eventos (bolsa_id, accion, estado_despues, monto, employee_id, nota)
    VALUES (v_bolsa.id, 'CREAR', 'ABIERTA', v_monto, NEW.resuelto_por,
            'Nació al confirmarse el corte.');

    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.crear_bolsa_al_confirmar() FROM PUBLIC, anon, authenticated;

-- Las que ya se crearon con el texto viejo.
UPDATE public.bolsas_eventos
   SET nota = 'Nació al confirmarse el corte.'
 WHERE nota = 'Nacio al confirmarse el corte.';
