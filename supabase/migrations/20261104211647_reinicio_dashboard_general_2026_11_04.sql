-- Segundo reinicio del tablero de INICIO · pestaña General (pedido del usuario,
-- 2026-11-04: «hay personas que en Inicio, General lo tienen desordenado»).
--
-- Mismo mecanismo que 20260813162854_reinicio_dashboard_general_menos_edwin:
-- los 9 tableros acomodados a mano (más ~35 con restos de layout) se armaron
-- contra el catálogo de otro momento; los widgets que llegaron después caían
-- sueltos en posiciones viejas. Se borra General para todos menos EDWIN NUÑEZ
-- y el portal vuelve a armarlo solo. La otra mitad (localStorage) la hace el
-- navegador al ver `REINICIO_GENERAL = '2026-11-04'` en DashboardView.jsx.
--
-- Respaldo: scratchpad `respaldo-general-2026-11-04.json` de la sesión.
-- Medido después: 1 fila con `layout.general` y 1 con `arranged.general` (Edwin).
SET lock_timeout = '5s';

UPDATE public.user_dashboard_prefs
SET layout        = layout        - 'general',
    sizes         = sizes         - 'general',
    mobile_layout = mobile_layout - 'general',
    mobile_sizes  = mobile_sizes  - 'general',
    arranged      = arranged      - 'general',
    updated_at    = now()
WHERE user_id <> 'bbc796d7-7435-495b-9306-a2115f44a18f'::uuid
  AND (layout        ? 'general' OR sizes        ? 'general'
    OR mobile_layout ? 'general' OR mobile_sizes ? 'general'
    OR arranged      ? 'general');
