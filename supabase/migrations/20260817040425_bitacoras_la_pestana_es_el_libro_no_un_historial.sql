SET lock_timeout = '5s';

-- `bitacoras_tab_historial` nombraba mal lo que iba a proteger.
--
-- «Historial» no es una pestaña: es la MISMA pantalla de captura mirando otro
-- día, o sea un filtro, no una sección (DESIGN.md 16.9). La pestaña que existe
-- de verdad es el LIBRO bajo receta — otras filas, otro trabajo y otro público.
--
-- Se renombra ahora, con el módulo sin estrenar y cero código usándola, porque
-- una clave que miente sobrevive a todas las auditorías: es
-- `feedback_un_rotulo_no_es_una_clave` aplicado a un permiso.

UPDATE public.role_permissions
   SET module_key = 'bitacoras_tab_libro'
 WHERE module_key = 'bitacoras_tab_historial'
   AND NOT EXISTS (
       SELECT 1 FROM public.role_permissions rp2
        WHERE rp2.role_id = public.role_permissions.role_id
          AND rp2.module_key = 'bitacoras_tab_libro'
   );

DELETE FROM public.role_permissions WHERE module_key = 'bitacoras_tab_historial';
