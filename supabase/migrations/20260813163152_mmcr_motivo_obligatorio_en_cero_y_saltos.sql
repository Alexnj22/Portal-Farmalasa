SET lock_timeout = '5s';

-- El motivo deja de ser opcional en los ajustes que no se explican solos:
-- apagar la reposicion (0 . 0), estrenar un MIN/MAX donde hoy no hay, y
-- triplicar cualquiera de los dos. La pantalla (WidgetMinMaxRequest) pide lo
-- mismo antes de enviar; esto es la guarda real, para que la regla no viva solo
-- en el navegador que la escribio.
--
-- Verificado contra las 4 filas existentes antes de aplicar: ninguna la viola
-- (las cuatro traen motivo escrito), asi que entra VALIDATED, sin NOT VALID.
ALTER TABLE public.minmax_change_requests
  ADD CONSTRAINT mmcr_reason_required CHECK (
    btrim(COALESCE(reason, '')) <> ''
    OR NOT (
         -- se apaga el producto
         (COALESCE(requested_min, -1) = 0 AND COALESCE(requested_max, -1) = 0)
         -- se estrena: hoy no hay nada contra que comparar
      OR (COALESCE(requested_min, 0) > 0 AND COALESCE(current_min, 0) = 0)
      OR (COALESCE(requested_max, 0) > 0 AND COALESCE(current_max, 0) = 0)
         -- se triplica o mas
      OR (COALESCE(current_min, 0) > 0 AND COALESCE(requested_min, 0) >= current_min * 3)
      OR (COALESCE(current_max, 0) > 0 AND COALESCE(requested_max, 0) >= current_max * 3)
    )
  );

COMMENT ON CONSTRAINT mmcr_reason_required ON public.minmax_change_requests IS
  'Motivo obligatorio cuando el ajuste apaga el producto (0/0), lo estrena (hoy 0 o sin definir) o triplica el MIN o el MAX. Decision del usuario, 2026-08-13.';
