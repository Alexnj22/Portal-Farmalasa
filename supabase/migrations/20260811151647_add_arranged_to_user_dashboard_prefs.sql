SET lock_timeout = '5s';

-- «Acomodada» tiene que ser una DECISIÓN de la persona, no el rastro de que la
-- app escribió algo.
--
-- Hasta acá, `tabsAcomodadas` se armaba con la sola existencia de la clave
-- `portal_dash_layout_<user>_<tab>`. Pero esa clave la escribe la app sola en
-- dos sitios: al colocar las baldosas de sucursal cuando cargan las ventas, y
-- al mezclar el layout que baja de la base. O sea que el tablero se daba por
-- «acomodado» sin que nadie moviera nada — y el acomodo automático, que es el
-- único que filtra por los widgets que el cargo VE, dejaba de correr para
-- siempre desde la primera carga.
--
-- El efecto medido: el layout guardado tiene posiciones para el catálogo
-- COMPLETO (26 widgets), y cada quien ve sólo los suyos. Los que no ve dejan su
-- hueco. Por eso el único tablero sin huecos era el del superusuario, que los
-- ve todos.
--
-- Esta columna guarda la decisión explícita, y va en la base —no sólo en
-- localStorage— para que quien SÍ acomodó su tablero lo conserve al abrirlo en
-- otro dispositivo. Vacío = nadie tocó nada = el tablero se arma solo.
ALTER TABLE public.user_dashboard_prefs
  ADD COLUMN IF NOT EXISTS arranged jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.user_dashboard_prefs.arranged IS
  'Pestañas que la persona acomodó a mano: {"general": true, ...}. Sólo la escriben el arrastre y el cambio de tamaño. Mientras una pestaña no esté acá, el tablero se recalcula compacto en cada carga sobre los widgets que ese cargo ve.';
