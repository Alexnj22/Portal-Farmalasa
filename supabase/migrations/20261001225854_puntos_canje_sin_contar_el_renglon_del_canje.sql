SET lock_timeout = '5s';

-- El canje se contaba DOBLE (aviso del 2026-10-01, COF 0000088147 de Salud 1:
-- «se aplicaron 688 puntos y el cliente tenía 344»; la venta decía 344).
--
-- El descuento por puntos se calculaba como «suma de renglones − total». Pero
-- el sistema de ventas manda el canje COMO UN RENGLÓN MÁS: `erp_product_id = 0`,
-- sin descripción y en POSITIVO. Neurobion $9.45 + renglón $3.44 = $12.89;
-- menos el total $6.01 = $6.88 → 688 puntos sobre un canje de 344.
--
-- Medido oct-2025 → oct-2026: las 601 ventas con `has_puntos` traen ese
-- renglón (en 591 es exactamente el descuento; las otras 10 difieren por
-- retención), y ninguna venta sin `has_puntos` lo trae. O sea que el defecto
-- tocaba TODO canje: el motor lo registraba al doble y el tablero de Puntos
-- mostraba lo canjeado al doble desde siempre. `get_puntos_canjeados` ya lo
-- separaba bien (`erp_product_id = 0`).
--
-- Corrección: los renglones que se suman son sólo los de producto. Se aplica
-- sobre la definición VIVA de cada función (regla del repo: partir de la viva)
-- y se exige que el reemplazo entre exactamente una vez en cada una.
DO $mig$
DECLARE
  f text;
  d text;
  n int;
BEGIN
  FOREACH f IN ARRAY ARRAY['puntos_registrar_canje', 'puntos_panel_tablero',
                           'puntos_panel_resumen', 'puntos_panel_serie'] LOOP
    d := pg_get_functiondef(('public.' || f)::regproc);
    n := (SELECT count(*) FROM regexp_matches(d,
            'sales_invoice_items ii\s+WHERE ii\.invoice_id = si\.id\)', 'g'));
    IF n <> 1 THEN
      RAISE EXCEPTION '%: se esperaba 1 suma de renglones y hay %', f, n;
    END IF;
    d := regexp_replace(d, '(sales_invoice_items ii\s+WHERE ii\.invoice_id = si\.id)\)',
                        '\1 AND ii.erp_product_id IS DISTINCT FROM 0)');
    EXECUTE d;
  END LOOP;
END
$mig$;

-- El único canje registrado con la cuenta mala (el portal maneja los puntos
-- desde el 2026-10-01). Los puntos descontados (344) ya eran los correctos y
-- el saldo quedó bien; lo que estaba mal era el monto y el «faltaron», que es
-- lo que lo ponía en Puntos → Avisos.
UPDATE public.puntos_salida
   SET monto = 3.44, motivo = 'canje aplicado en el sistema de ventas'
 WHERE id = 9731 AND invoice_id = 6703023 AND puntos = 344 AND monto = 6.88;
