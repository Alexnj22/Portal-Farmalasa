-- ═══════════════════════════════════════════════════════════════════════════
-- Seis fichas de negocio pasan a PERSONA JURÍDICA (borrador 2026-10-24)
--
-- QUÉ CAMBIA: estas 6 fichas tienen nombre de institución o de clínica y
--   estaban como persona natural (el clasificador por nombre no las reconoce,
--   o las dejó «por revisar»). El usuario aprobó pasarlas a jurídica el
--   2026-10-24. Desde `reglas_v2_desde()` (2026-11-15) una ficha jurídica no
--   acumula ni recibe raspable (Reglamento v2, 2.2).
--
--     21092    DIOCESIS DE CHALATENANGO
--     13089    CLINICA CENTRO DE HEMODIALISIS
--     21271    CLINICA INTEGRAL DE SALUD PARA LA MUJER (4P)
--     19455    CLINICA MEDICA SANTA LUCIA (4)
--     4508     CLINICA MEDILIFE (4P)
--     3197503  CLINICA VILLA CLARA
--
-- CÓMO: lo mismo que hace `cliente_tipo_persona_guardar` (la decisión manual
--   del portal): tipo_persona = 'juridica', tipo_persona_revisar = false y
--   tipo_persona_manual_at = now(), para que el trigger
--   `customers_tipo_persona` NO la vuelva a natural si el nombre cambia.
--   `tipo_persona_manual_por` queda NULL: no la marcó una persona del portal.
--
-- FRENO: cada UPDATE exige el id Y el nombre exacto. Si alguna ficha ya no
--   se llama así (o no existe), la migración entera aborta sin tocar nada.
--
-- DESDE CUÁNDO RIGE: al aplicarla (el efecto sobre los puntos, desde el
--   2026-11-15). TABLA CALIENTE: no es DDL; son 6 filas de `customers`.
-- CÓMO SE VERIFICÓ: nombres y estado leídos en producción el 2026-10-24 (las 6
--   en 'natural', sin decisión manual). En staging (donde no existen) se
--   fabricaron con los mismos id y nombre: el bloque las pasó a jurídica,
--   siguieron jurídicas después de tocarles el nombre, y con un nombre que no
--   coincide el freno aborta. Las fabricadas se borraron.
-- ═══════════════════════════════════════════════════════════════════════════
SET lock_timeout = '5s';

DO $$
DECLARE
  v_fichas constant jsonb := '[
    {"id": 21092,   "name": "DIOCESIS DE CHALATENANGO"},
    {"id": 13089,   "name": "CLINICA CENTRO DE HEMODIALISIS"},
    {"id": 21271,   "name": "CLINICA INTEGRAL DE SALUD PARA LA MUJER (4P)"},
    {"id": 19455,   "name": "CLINICA MEDICA SANTA LUCIA (4)"},
    {"id": 4508,    "name": "CLINICA MEDILIFE (4P)"},
    {"id": 3197503, "name": "CLINICA VILLA CLARA"}
  ]';
  f jsonb; n integer;
BEGIN
  FOR f IN SELECT * FROM jsonb_array_elements(v_fichas) LOOP
    UPDATE public.customers
       SET tipo_persona = 'juridica', tipo_persona_revisar = false, tipo_persona_manual_at = now()
     WHERE id = (f->>'id')::bigint AND name = f->>'name';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN
      RAISE EXCEPTION 'La ficha % ya no es «%»: no se cambia nada.', f->>'id', f->>'name';
    END IF;
  END LOOP;
END $$;

-- Verificación (debe dar 6 filas, todas 'juridica' con fecha manual):
SELECT id, name, tipo_persona, tipo_persona_revisar, tipo_persona_manual_at
  FROM public.customers
 WHERE id IN (21092, 13089, 21271, 19455, 4508, 3197503)
 ORDER BY id;
