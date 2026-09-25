-- Palabra ENTERA pesa más que comienzo de palabra. Medido en clientes:
-- «s.a.» (= «sa») traía 2,113 fichas y las «S.A. DE C.V.» que se buscaban
-- quedaban debajo de SABINA, que empieza con «sa». Los niveles quedan:
--   100 un campo es lo escrito · 95 el nombre empieza con lo escrito en
--   palabras enteras · 90 todas son palabras enteras · 85 el nombre empieza con
--   lo escrito a mitad de palabra · 80 todas al inicio de una palabra ·
--   70 seguidas y en orden · 60 en cualquier parte.
-- Mismo cambio en src/utils/busqueda.js; `npm run busqueda:gemelos`.
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
  todas3 boolean := true;
  principal text := coalesce(p_campos[1], '');
  n      int := coalesce(jsonb_array_length(p_palabras), 0);
  q      text := '';
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
      IF strpos(b, ' ' || t || ' ') > 0 THEN nivel := 3;
      ELSIF strpos(t, '.') = 0 AND strpos(b, ' ' || t || '.') > 0 THEN nivel := 1;
      ELSIF length(t) >= 4 AND strpos(t, '.') = 0
            AND (b ~ (' (?=[0-9]{6,} )[0-9]*' || t || '[0-9]* ')
                 OR (' ' || comp || ' ') ~ (' (?=[0-9]{6,} )[0-9]*' || t || '[0-9]* ')) THEN nivel := 1;
      END IF;
    ELSIF tipo = 'mixto' THEN
      IF strpos(b, ' ' || t || ' ') > 0 THEN nivel := 3;
      ELSIF strpos(' ' || comp, ' ' || (e->>'junto')) > 0 THEN nivel := 1;
      END IF;
    ELSE
      IF strpos(b, ' ' || t || ' ') > 0 THEN nivel := 3;
      ELSIF strpos(b, ' ' || t) > 0 THEN nivel := 2;
      ELSIF tipo = 'palabra' AND (strpos(texto, t) > 0 OR strpos(comp, t) > 0) THEN nivel := 1;
      END IF;
    END IF;
    IF nivel = 0 THEN RETURN 0; END IF;
    IF nivel < 2 THEN todas2 := false; END IF;
    IF nivel < 3 THEN todas3 := false; END IF;
  END LOOP;

  IF q = ANY (campos) THEN RETURN 100; END IF;
  -- «Empieza con» cuenta sólo en el PRIMER campo, el que nombra la cosa.
  IF principal = q OR starts_with(principal, q || ' ') THEN RETURN 95; END IF;
  -- Palabra ENTERA pesa más que comienzo de palabra («s.a.» → S.A. antes que SABINA).
  IF todas3 THEN RETURN 90; END IF;
  IF q !~ '[0-9]$' AND starts_with(principal, q) THEN RETURN 85; END IF;
  IF todas2 THEN RETURN 80; END IF;
  IF n > 1 AND strpos(texto, q) > 0 THEN RETURN 70; END IF;
  RETURN 60;
END;
$$;

ALTER FUNCTION public.busqueda_puntaje(jsonb, text[], text[]) COST 5000;
