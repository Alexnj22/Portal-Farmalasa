SET lock_timeout = '5s';

-- ── EL AMARRE QUE FALTABA ────────────────────────────────────────────────────
--
-- `caja_aperturas_del_portal` guarda quién apretó «Abrir la caja» en el portal,
-- y hasta hoy NADIE la leía: la tarjeta de Efectivo mostraba el nombre que da el
-- panel del sistema de la caja, que es el de la CUENTA con la que esa sala abre
-- siempre — «MI CAJA LA POPULAR» en tres salas, y en las otras tres el nombre de
-- una persona que tampoco es quien abrió (al abrir desde el portal se reusa a
-- propósito el mismo empleado que la sala ya venía usando, ver `operar-caja`).
-- O sea que el nombre del origen NUNCA es evidencia de quién abrió.
--
-- Para poder preferir la fila del portal hace falta saber a QUÉ apertura
-- corresponde. Sin este número la única forma de amarrarlas es «la más reciente
-- de la sala», y eso le atribuye el segundo turno —abierto desde la caja por
-- otra persona— a quien abrió el primero desde el portal.
ALTER TABLE public.caja_aperturas_del_portal
  ADD COLUMN IF NOT EXISTS erp_apertura_id integer;

COMMENT ON COLUMN public.caja_aperturas_del_portal.erp_apertura_id IS
  'La apertura del sistema de la caja a la que corresponde esta fila. La escribe '
  '`operar-caja` releyendo el panel justo despues de abrir. NULL = no se pudo '
  'releer: la fila sigue diciendo quien abrio, pero no a cual apertura, y por eso '
  'no se usa para atribuir.';

-- Una fila del portal por apertura: dos serian dos personas firmando el mismo
-- acto, que es justo lo que esta columna existe para impedir.
CREATE UNIQUE INDEX IF NOT EXISTS caja_aper_portal_una_por_apertura
  ON public.caja_aperturas_del_portal (branch_id, erp_apertura_id)
  WHERE erp_apertura_id IS NOT NULL;

-- Las filas que ya existen (las 5 aperturas de hoy, todas hechas desde el
-- portal). El origen anota la apertura en el MISMO segundo en que el portal la
-- pide —verificado en las 5—, asi que se amarran por sala + caja + instante,
-- con dos minutos de holgura. Sin holgura infinita a proposito: si algun dia no
-- coincide, la fila queda en NULL y la pantalla dice que no sabe, en vez de
-- atribuirle la apertura a alguien por cercania.
UPDATE public.caja_aperturas_del_portal p
   SET erp_apertura_id = a.erp_apertura_id
  FROM public.cortes_caja_aperturas a
 WHERE p.erp_apertura_id IS NULL
   AND a.branch_id = p.branch_id
   AND a.caja_erp  = p.caja_erp
   AND abs(extract(epoch FROM ((a.abierta_el + a.abierta_a)
        - (p.created_at AT TIME ZONE 'America/El_Salvador')))) <= 120;
