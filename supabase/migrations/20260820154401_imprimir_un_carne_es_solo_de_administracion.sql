SET lock_timeout = '5s';

-- ═══ Imprimir un carné es de Administración, y de nadie más ═════════════════
--
-- Corrección del usuario el 2026-08-20, mirando las dos listas: «los que pueden
-- imprimir carné solo es admin, compras y logística no está ahí».
--
-- El permiso `carne_temporal` había salido con cinco roles —los mismos que
-- editan el listado de personal, más Gerencia—, que era una inferencia mía y no
-- una decisión suya. Queda en **Administrador**.
--
-- `QA / Testing (CI)` se conserva a propósito: no es una persona, es la cuenta
-- con la que se ejercita el portal, y todos los módulos la incluyen.
--
-- ── Lo que NO se toca, y por qué ────────────────────────────────────────────
-- `kiosk_pin` sigue con sus cinco roles. Ese permiso NO es «imprimir un carné»:
-- es ver y copiar el PIN de marcación, y además decide si a alguien se le
-- muestra el suyo en su propia pantalla (`AppLayout`). Revocarlo acá cambiaría
-- una pantalla que nadie pidió cambiar. Lo que se mueve es el BOTÓN de
-- reimprimir la etiqueta del carné de plástico, que pasa a pedir
-- `carne_temporal` — así «imprimir un carné» es UNA sola llave para los dos
-- papeles, en vez de dos llaves con listas distintas.
DELETE FROM public.role_permissions
 WHERE module_key = 'carne_temporal'
   AND role_id IN (2, 11, 13);

-- Verificación en el mismo lugar donde se decidió: si algún día vuelve a haber
-- más de dos, es porque alguien lo agregó a mano.
DO $$
DECLARE v_roles text;
BEGIN
    SELECT string_agg(r.name, ', ' ORDER BY r.id) INTO v_roles
      FROM public.role_permissions rp
      JOIN public.roles r ON r.id = rp.role_id
     WHERE rp.module_key = 'carne_temporal' AND rp.can_edit;
    RAISE NOTICE 'Pueden imprimir un carne: %', coalesce(v_roles, 'NADIE');
END $$;
