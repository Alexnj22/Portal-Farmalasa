-- «Empieza con» (puntaje 90) cuenta sólo en el PRIMER campo, el que nombra la
-- cosa. Medido en Mín·Máx: buscando «sal», un producto cuyo LABORATORIO empieza
-- con «sal» empataba con SAL ANDREWS y ganaba por abecedario. Mismo cambio en
-- src/utils/busqueda.js; `npm run busqueda:gemelos` los enfrenta.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.busqueda_puntaje(p_palabras jsonb, p_campos text[], p_compactas text[])
RETURNS integer
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = public, extensions
AS $$
DECLARE
  campos text[] := array_remove(array_remove(p_campos, NULL), '');
  texto  text;
  b      text;
  comp   text := array_to_string(array_remove(array_remove(p_compactas, NULL), ''), ' ');
  e      jsonb;
  t      text;
  tipo   text;
  nivel  int;
  todas2 boolean := true;
  n      int := coalesce(jsonb_array_length(p_palabras), 0);
  q      text := '';
  pre    text;
  i      int;
BEGIN
  IF n = 0 THEN RETURN 0; END IF;
  texto := array_to_string(campos, ' ');
  b     := ' ' || texto || ' ';

  FOR i IN 0 .. n - 1 LOOP
    e := p_palabras -> i;
    t := e->>'t'; tipo := e->>'tipo'; nivel := 0;
    q := CASE WHEN i = 0 THEN t ELSE q || ' ' || t END;
    IF tipo = 'numero' THEN
      IF strpos(b, ' ' || t || ' ') > 0 THEN nivel := 2;
      ELSIF strpos(t, '.') = 0 AND strpos(b, ' ' || t || '.') > 0 THEN nivel := 1;
      ELSIF length(t) >= 4 AND strpos(t, '.') = 0
            AND b ~ (' (?=[0-9]{6,} )[0-9]*' || t || '[0-9]* ') THEN nivel := 1;
      END IF;
    ELSIF tipo = 'mixto' THEN
      IF strpos(b, ' ' || t || ' ') > 0 THEN nivel := 2;
      ELSIF strpos(' ' || comp, ' ' || (e->>'junto')) > 0 THEN nivel := 1;
      END IF;
    ELSE
      IF strpos(b, ' ' || t) > 0 THEN nivel := 2;
      ELSIF tipo = 'palabra' AND (strpos(texto, t) > 0 OR strpos(comp, t) > 0) THEN nivel := 1;
      END IF;
    END IF;
    IF nivel = 0 THEN RETURN 0; END IF;
    IF nivel < 2 THEN todas2 := false; END IF;
  END LOOP;

  IF q = ANY (campos) THEN RETURN 100; END IF;
  pre := CASE WHEN q ~ '[0-9]$' THEN q || ' ' ELSE q END;
  IF starts_with(coalesce(p_campos[1], ''), pre) THEN RETURN 90; END IF;
  IF todas2 THEN RETURN 80; END IF;
  IF n > 1 AND strpos(texto, q) > 0 THEN RETURN 70; END IF;
  RETURN 60;
END;
$$;
