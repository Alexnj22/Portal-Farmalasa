-- `puntos_fusion` nació con RLS y su policy de SELECT, pero sin el GRANT: en
-- este proyecto una tabla nueva no hereda privilegios para `authenticated`, así
-- que la lectura fallaba con «permission denied» y el aviso «Esta cuenta reúne
-- también los puntos de…» nunca se pintaba (2026-10-15, visto en el modal).
-- La policy sigue decidiendo quién ve: el módulo Puntos.
SET lock_timeout = '5s';
GRANT SELECT ON public.puntos_fusion TO authenticated;
