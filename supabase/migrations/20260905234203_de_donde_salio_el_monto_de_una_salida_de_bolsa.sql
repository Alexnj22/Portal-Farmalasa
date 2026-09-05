SET lock_timeout = '5s';

-- La misma marca que el cajón, para el dinero que sale de una BOLSA.
--
-- `caja_movimientos_portal.monto_origen` ya dice si el papel respalda ese monto
-- o si lo escribió una persona. Sin el gemelo acá, la lista de «lo que se movió
-- hoy» —que mezcla las dos fuentes en una sola pantalla— mostraría la marca en
-- unas líneas y en otras no, sin ningún motivo visible: quien mire leería la
-- ausencia como «este monto sí está comprobado».
--
-- La deriva la MISMA función que ya guarda la lectura, comparando contra el
-- monto de la operación que está escribiendo. El cliente no la declara.
ALTER TABLE public.bolsas_operaciones
    ADD COLUMN IF NOT EXISTS monto_origen text;

DO $$
BEGIN
    ALTER TABLE public.bolsas_operaciones
        ADD CONSTRAINT bolsas_op_monto_origen_valido
        CHECK (monto_origen IS NULL
               OR monto_origen IN ('FOTO_CONFIRMADA', 'FOTO_SIN_CONFIRMAR', 'A_MANO'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.bolsas_operaciones.monto_origen IS
    'De dónde salió el monto: FOTO_CONFIRMADA (el papel lo repite y coincide), FOTO_SIN_CONFIRMAR (leído pero sin segundo renglón que lo respalde), A_MANO (lo escribió una persona). Lo deriva guardar_lectura_de_boleta; el navegador no lo declara.';

-- Y la función que guarda la lectura ahora deriva también la marca.
--
-- Mismo criterio que `origenDelMonto` en `operar-caja`, y por los mismos
-- motivos: sale de comparar lo que el lector contestó contra lo que se guardó,
-- porque las dos cosas ya están acá. Medio centavo de tolerancia es ruido de
-- coma flotante, no un número que alguien haya tecleado.
CREATE OR REPLACE FUNCTION public.guardar_lectura_de_boleta(p_operacion_id bigint, p_lectura jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_yo uuid := (SELECT auth_employee_id());
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas'])) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

    UPDATE public.bolsas_operaciones o
       SET foto_lectura = p_lectura,
           monto_origen = CASE
               WHEN (p_lectura #>> '{leido,monto}') IS NULL THEN 'A_MANO'
               WHEN abs((p_lectura #>> '{leido,monto}')::numeric - abs(o.monto)) >= 0.005
                    THEN 'A_MANO'
               WHEN p_lectura ->> 'montoConfianza' = 'CONFIRMADO' THEN 'FOTO_CONFIRMADA'
               ELSE 'FOTO_SIN_CONFIRMAR'
           END
     WHERE o.id = p_operacion_id
       AND o.registrado_por = v_yo
       AND o.foto_lectura IS NULL
       AND o.registrado_at > now() - interval '10 minutes';
END;
$function$;
