SET lock_timeout = '5s';

-- Aviso a la sala cuando aparece un corte de caja nuevo.
--
-- La captura corre cada minuto, así que el corte entra en la tabla segundos
-- después de firmarse en la sala. Hasta hoy no lo sabía nadie: había que entrar
-- al portal a mirar. Como el corte lo confirma la propia sala («las salas son
-- las que confirman sus propios cortes», 2026-08-14), el aviso va a la sala.
--
-- Lo que el aviso NO dice es el monto de la diferencia, a propósito. La cifra
-- que muestra la tarjeta es el TRAMO —la resta contra el último corte
-- confirmado del día— y se calcula en `utils/cortesDiagnostico.js`; encima el
-- origen produce DOS diferencias que a veces no coinciden y el portal se niega
-- a elegir entre ellas. Un número en el aviso sería una tercera cifra,
-- calculada en otro runtime y provisional (el tramo cambia cuando alguien
-- confirma el corte anterior). El aviso anuncia; la pantalla dice cuánto.
--
-- El disparador que la usa va en la migración siguiente, después de probar esta
-- contra datos reales: un error acá rompe el INSERT de la captura, o sea que
-- deja de entrar TODO corte de TODA sala.
CREATE OR REPLACE FUNCTION public.notificar_corte_de_caja()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_sala   text;
  v_dest   uuid[];
  v_titulo text;
  v_cuerpo text;
BEGIN
  -- El cierre del día (Z) no se confirma ni se descarta —lo rechaza
  -- `resolver_corte_caja`—, así que avisarlo sería pedir una acción que no
  -- existe.
  IF NEW.tipo <> 'C' THEN
    RETURN NULL;
  END IF;

  -- Sólo lo recién hecho. El repaso de las 23:40 no reinserta nada (el upsert
  -- ignora duplicados), pero una recarga manual de días pasados sí, y avisarle
  -- a la sala de un corte de la semana pasada es el ruido que enseña a ignorar
  -- la campana. Dos días de ventana y medio día de desfase cubren el corte de
  -- las 23:59, que se captura recién a las 6 del otro día.
  IF NEW.fecha < ((now() AT TIME ZONE 'America/El_Salvador')::date - 1)
     OR coalesce(NEW.desfase_seg, 0) > 43200 THEN
    RETURN NULL;
  END IF;

  SELECT name INTO v_sala FROM public.branches WHERE id = NEW.branch_id;

  -- Los de la sala que tienen el módulo. `notify_branch` avisaría a TODOS los
  -- de la sucursal, y a quien no lo tiene el aviso lo manda a una pantalla que
  -- no puede abrir.
  SELECT array_agg(DISTINCT e.id) INTO v_dest
  FROM public.employees e
  JOIN public.role_permissions rp
    ON rp.role_id = e.role_id
   AND rp.module_key = 'cortes_caja'
  WHERE e.branch_id = NEW.branch_id
    AND e.status = 'ACTIVO'
    AND (rp.can_view OR rp.can_edit);

  IF v_dest IS NULL THEN
    RETURN NULL;
  END IF;

  -- Misma hora que la tarjeta (hh:mm, 24h): el aviso y la pantalla tienen que
  -- nombrar al mismo corte igual.
  v_titulo := 'Corte de caja de las ' || to_char(NEW.hora, 'HH24:MI');
  v_cuerpo := coalesce(v_sala, 'Tu sala') || ' — revisalo y confirmalo.';

  PERFORM public.notify_employees(
    v_dest,
    'CORTE_NUEVO',
    v_titulo,
    v_cuerpo,
    '/cortes',
    jsonb_build_object(
      'corte_id',  NEW.id,
      'branch_id', NEW.branch_id,
      'fecha',     NEW.fecha,
      'hora',      to_char(NEW.hora, 'HH24:MI')
    ),
    true,            -- push: hay que ir a confirmarlo, no es informativo
    NEW.branch_id
  );

  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notificar_corte_de_caja() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notificar_corte_de_caja() TO service_role;
