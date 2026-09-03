SET lock_timeout = '5s';

-- ── ¿LA SALA YA CERRÓ? ───────────────────────────────────────────────────────
--
-- El horario operativo decide si un corte es el ÚLTIMO del día: «si cierra a
-- las 7 y confirma un corte a las 7 ya es el último, no debe pedir ahí nada;
-- pero si hace un corte a las 4 y lo confirmó, ahí sí se entrega a alguien»
-- (usuario, 2026-09-03). El turno termina cuando se CONFIRMA el corte, así que
-- la hora que manda es la de la confirmación y no la del corte.
--
-- Devuelve NULL —y no `false`— cuando no se puede saber. Un `false` ahí diría
-- «la sala sigue abierta» sobre algo que nadie midió, y ese caso se contaría
-- como una entrega que faltó. Es la regla del gate que no pudo medir.
--
-- Tres trampas del dato, las tres medidas el 3-sep sobre las 8 sucursales:
--
--  1. **El texto no es una hora.** Salud 2 tiene `"19:00 PM"` y Salud 1
--     `"22:00"`. Comparar las cadenas tal cual funciona de casualidad —el
--     sufijo cae después de los minutos— y deja de funcionar el día que
--     alguien escriba `"7:00 PM"`. Se recorta el `HH:MM` del principio y se
--     rellena a dos dígitos: `7:00` < `19:00` como texto es FALSO.
--  2. **El día 0 es domingo**, igual que en JavaScript: Bodega y Administración
--     tienen `"0"` con `isOpen:false` y `"6"` a media jornada. `extract(dow)`
--     de Postgres usa esa misma numeración, así que no hay que traducir.
--  3. **Un horario que cruza la medianoche no se puede comparar así.** Hoy
--     ninguna sala lo hace; el día que una cierre a las 00:30, esto devuelve
--     NULL en vez de contestar cualquier cosa.
CREATE OR REPLACE FUNCTION public.sala_ya_cerro(
    p_branch  bigint,
    p_momento timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_local  timestamp;
    v_dia    jsonb;
    v_abre   text;
    v_cierra text;
BEGIN
    -- La sala vive en hora de El Salvador; `now()` viene en UTC.
    v_local := p_momento AT TIME ZONE 'America/El_Salvador';

    SELECT b.weekly_hours -> (extract(dow from v_local)::int::text)
      INTO v_dia
      FROM public.branches b
     WHERE b.id = p_branch;

    IF v_dia IS NULL THEN RETURN NULL; END IF;

    -- Una sala marcada cerrada hoy que igual cortó es una contradiccion del
    -- dato, no una respuesta: no se contesta.
    IF coalesce((v_dia->>'isOpen')::boolean, false) IS NOT TRUE THEN RETURN NULL; END IF;

    v_abre   := substring(btrim(coalesce(v_dia->>'start','')) from '^[0-9]{1,2}:[0-9]{2}');
    v_cierra := substring(btrim(coalesce(v_dia->>'end',''))   from '^[0-9]{1,2}:[0-9]{2}');
    IF v_abre IS NULL OR v_cierra IS NULL THEN RETURN NULL; END IF;

    v_abre   := lpad(v_abre, 5, '0');
    v_cierra := lpad(v_cierra, 5, '0');

    -- Cierra antes de abrir = cruza la medianoche. No se adivina.
    IF v_cierra <= v_abre THEN RETURN NULL; END IF;

    RETURN to_char(v_local, 'HH24:MI') >= v_cierra;
END $$;

COMMENT ON FUNCTION public.sala_ya_cerro(bigint, timestamptz) IS
  'Si la sucursal ya paso su hora de cierre de HOY segun `branches.weekly_hours`. '
  'NULL = no se puede saber (sin horario, dia marcado cerrado, u horario que cruza '
  'la medianoche): NUNCA se responde false por no haber podido mirar.';

REVOKE EXECUTE ON FUNCTION public.sala_ya_cerro(bigint, timestamptz) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.sala_ya_cerro(bigint, timestamptz) TO authenticated, service_role;

-- ── QUIÉN RECIBE LA CAJA ─────────────────────────────────────────────────────
--
-- Confirmar un corte CIERRA EL TURNO, así que es el momento en que la caja
-- cambia de manos. Hasta hoy la firmaba quien quisiera —incluida la misma
-- persona que contó—, o sea que la entrega no tenía quien la recibiera.
--
-- `resuelto_por` sigue siendo la sesión que operó la pantalla. `recibido_por`
-- es OTRA cosa: quien se hace cargo del dinero desde este momento, y firma con
-- su carné sin tener que cerrar la sesión de nadie. Son los dos nombres del
-- mismo acto, como en las bolsas (`entregada_por` / `recibida_por`).
ALTER TABLE public.cortes_caja
  ADD COLUMN IF NOT EXISTS recibido_por uuid REFERENCES public.employees(id),
  ADD COLUMN IF NOT EXISTS recibido_at  timestamptz,
  -- Los CUATRO desenlaces, y el cuarto existe para no mentir:
  --   RECIBIDO     alguien firmó que se hace cargo.
  --   CIERRE       era el último del día: no hay a quién entregarle.
  --   SIN_ENTREGA  la sala seguía abierta y nadie recibió. El caso a medir.
  --   SIN_HORARIO  no se pudo saber si era el último. No acusa a nadie.
  ADD COLUMN IF NOT EXISTS entrega text
      CHECK (entrega IN ('RECIBIDO','CIERRE','SIN_ENTREGA','SIN_HORARIO')),
  ADD COLUMN IF NOT EXISTS sin_entrega_motivo text;

CREATE INDEX IF NOT EXISTS cortes_caja_recibido_por_idx
  ON public.cortes_caja (recibido_por) WHERE recibido_por IS NOT NULL;

COMMENT ON COLUMN public.cortes_caja.recibido_por IS
  'Quien recibe la caja y se hace cargo del dinero desde este corte. Firma con '
  'su carne (o usuario y clave) sin cerrar la sesion de quien opera la pantalla.';
COMMENT ON COLUMN public.cortes_caja.entrega IS
  'RECIBIDO / CIERRE (ultimo del dia) / SIN_ENTREGA (la sala seguia abierta y '
  'nadie recibio) / SIN_HORARIO (no se pudo saber). Lo decide el servidor.';
