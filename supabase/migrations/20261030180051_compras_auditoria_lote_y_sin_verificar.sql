SET lock_timeout = '5s';

-- El erróneo guarda el lote con que entró: al darle salida se descarta ESE
-- lote, no el que vence primero (control de lote de un producto regulado).
ALTER TABLE public.compra_renglon_erroneo ADD COLUMN IF NOT EXISTS numero_lote text;

-- Un erróneo «sin verificar» (su salida se cortó) tampoco admite cambiar la
-- nota: se reescriben las dos funciones desde su definición VIVA, cambiando
-- sólo la lista de estados que frenan.
DO $$
DECLARE f text; d text;
BEGIN
  FOREACH f IN ARRAY ARRAY['compra_erroneo_adjuntar_nota(bigint,bigint)', 'compra_erroneo_adjuntar_nota_papel(bigint,jsonb)'] LOOP
    d := pg_get_functiondef(('public.' || f)::regprocedure);
    IF position($q$v_e.estado IN ('salio','saliendo')$q$ IN d) = 0 THEN
      RAISE EXCEPTION 'La definición viva de % no tiene el freno esperado', f;
    END IF;
    d := replace(d, $q$v_e.estado IN ('salio','saliendo')$q$, $q$v_e.estado IN ('salio','saliendo','sin_verificar')$q$);
    d := replace(d, $q$'Ese producto ya salió o está saliendo.'$q$, $q$'Ese producto ya salió, está saliendo o falta comprobar su salida.'$q$);
    EXECUTE d;
  END LOOP;
END $$;
