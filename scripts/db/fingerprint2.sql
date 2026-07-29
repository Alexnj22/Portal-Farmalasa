-- Huella del esquema `public`: una fila por tipo de objeto, con conteo y md5 del
-- listado ordenado. Se corre en la rama de verificacion y en produccion; si las
-- 16 filas coinciden, el baseline reproduce prod.
--
-- v2 (2026-07-29): cubre las categorias que el baseline v2 emite y que la huella
-- v1 no miraba — ACLs, publicaciones, comentarios, reloptions y parametros de
-- secuencias. Una huella que no cubre lo que se emite no verifica nada.
--
-- Excluye objetos miembros de extension (las 31 funciones de pg_trgm): los crea
-- `CREATE EXTENSION`, no el baseline, y su dueño es supabase_admin.
WITH miembros_ext AS (
  SELECT d.objid, d.classid
  FROM pg_depend d
  WHERE d.deptype = 'e' AND d.refclassid = 'pg_extension'::regclass
),
tablas AS (
  SELECT 'a_tablas' AS tipo, c.relname AS obj
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p')
),
columnas AS (
  SELECT 'b_columnas' AS tipo,
         c.relname||'.'||a.attname||':'||format_type(a.atttypid,a.atttypmod)||
         ':nn='||a.attnotnull::text||
         ':id='||coalesce(nullif(a.attidentity::text,''),'-')||
         ':gen='||coalesce(nullif(a.attgenerated::text,''),'-')||
         ':def='||coalesce(pg_get_expr(ad.adbin,ad.adrelid),'-') AS obj
  FROM pg_attribute a
  JOIN pg_class c ON c.oid=a.attrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  LEFT JOIN pg_attrdef ad ON ad.adrelid=c.oid AND ad.adnum=a.attnum
  WHERE n.nspname='public' AND c.relkind IN ('r','p')
    AND a.attnum>0 AND NOT a.attisdropped
),
secuencias AS (
  SELECT 'c_secuencias' AS tipo,
         c.relname||':'||format_type(s.seqtypid,NULL)||':inc='||s.seqincrement||
         ':min='||s.seqmin||':max='||s.seqmax||':start='||s.seqstart||
         ':cache='||s.seqcache||':cycle='||s.seqcycle::text AS obj
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_sequence s ON s.seqrelid=c.oid
  WHERE n.nspname='public' AND c.relkind='S'
),
reloptions AS (
  SELECT 'd_reloptions' AS tipo,
         c.relname||':'||array_to_string(c.reloptions,'&') AS obj
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.reloptions IS NOT NULL
    AND c.relkind IN ('r','p','v','m')
),
indices AS (
  SELECT 'e_indices' AS tipo, c.relname||'::'||pg_get_indexdef(i.indexrelid) AS obj
  FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
),
funciones AS (
  SELECT 'f_funciones' AS tipo,
         'public.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')'||
         ':secdef='||p.prosecdef::text||
         ':vol='||p.provolatile::text||
         ':cfg='||coalesce(array_to_string(p.proconfig,'&'),'-')||
         ':body='||md5(pg_get_functiondef(p.oid)) AS obj
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prokind IN ('f','p')
    AND NOT EXISTS (SELECT 1 FROM miembros_ext m
                    WHERE m.objid=p.oid AND m.classid='pg_proc'::regclass)
),
-- Las matviews se comparan por definicion, no por `relispopulated`: el baseline
-- las crea WITH NO DATA a proposito.
vistas AS (
  SELECT 'g_vistas' AS tipo,
         c.relkind::text||':'||c.relname||':'||md5(pg_get_viewdef(c.oid)) AS obj
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('v','m')
),
constraints AS (
  SELECT 'h_constraints' AS tipo,
         c.relname||'.'||con.conname||':'||pg_get_constraintdef(con.oid) AS obj
  FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
),
triggers AS (
  SELECT 'i_triggers' AS tipo, pg_get_triggerdef(t.oid) AS obj
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND NOT t.tgisinternal
),
rls AS (
  SELECT 'j_rls' AS tipo,
         c.relname||':enabled='||c.relrowsecurity::text||
         ':forced='||c.relforcerowsecurity::text AS obj
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relrowsecurity
),
policies AS (
  SELECT 'k_policies' AS tipo,
         c.relname||'.'||pol.polname||':'||pol.polcmd::text||
         ':perm='||pol.polpermissive::text||
         ':roles='||coalesce((SELECT string_agg(rolname,',' ORDER BY rolname)
                              FROM pg_roles WHERE oid = ANY(pol.polroles)),'PUBLIC')||
         ':using='||coalesce(pg_get_expr(pol.polqual,pol.polrelid),'-')||
         ':check='||coalesce(pg_get_expr(pol.polwithcheck,pol.polrelid),'-') AS obj
  FROM pg_policy pol JOIN pg_class c ON c.oid=pol.polrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
),
acl_rel AS (
  SELECT 'l_acl_rel' AS tipo,
         c.relname||':'||coalesce(r.rolname,'PUBLIC')||'='||a.privilege_type AS obj
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  CROSS JOIN LATERAL aclexplode(c.relacl) a
  LEFT JOIN pg_roles r ON r.oid=a.grantee
  WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S')
    AND c.relacl IS NOT NULL
),
acl_fn AS (
  SELECT 'm_acl_fn' AS tipo,
         'public.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')'||
         ':'||coalesce(r.rolname,'PUBLIC')||'='||a.privilege_type AS obj
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  CROSS JOIN LATERAL aclexplode(p.proacl) a
  LEFT JOIN pg_roles r ON r.oid=a.grantee
  WHERE n.nspname='public' AND p.prokind IN ('f','p') AND p.proacl IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM miembros_ext m
                    WHERE m.objid=p.oid AND m.classid='pg_proc'::regclass)
),
publicaciones AS (
  SELECT 'n_publicaciones' AS tipo, pb.pubname||':'||c.relname AS obj
  FROM pg_publication_rel pr JOIN pg_class c ON c.oid=pr.prrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_publication pb ON pb.oid=pr.prpubid
  WHERE n.nspname='public'
),
-- Se compara por NOMBRE de columna, no por `objsubid`: prod tiene columnas
-- borradas que dejan huecos en attnum, y una tabla recien creada numera compacto.
-- Comparar por numero medía el layout fisico, no el esquema — daba 18 falsos
-- positivos con los md5 de las descripciones idénticos.
comentarios AS (
  SELECT 'o_comentarios' AS tipo,
         c.relname||':'||coalesce(a.attname,'(objeto)')||':'||md5(d.description) AS obj
  FROM pg_description d JOIN pg_class c ON c.oid=d.objoid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  LEFT JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=d.objsubid
                          AND d.objsubid>0 AND NOT a.attisdropped
  WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S')
  UNION ALL
  SELECT 'o_comentarios' AS tipo,
         p.proname||':fn:'||md5(d.description) AS obj
  FROM pg_description d JOIN pg_proc p ON p.oid=d.objoid
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prokind IN ('f','p')
    AND NOT EXISTS (SELECT 1 FROM miembros_ext m
                    WHERE m.objid=p.oid AND m.classid='pg_proc'::regclass)
),
todo AS (
  SELECT * FROM tablas        UNION ALL SELECT * FROM columnas
  UNION ALL SELECT * FROM secuencias    UNION ALL SELECT * FROM reloptions
  UNION ALL SELECT * FROM indices       UNION ALL SELECT * FROM funciones
  UNION ALL SELECT * FROM vistas        UNION ALL SELECT * FROM constraints
  UNION ALL SELECT * FROM triggers      UNION ALL SELECT * FROM rls
  UNION ALL SELECT * FROM policies      UNION ALL SELECT * FROM acl_rel
  UNION ALL SELECT * FROM acl_fn        UNION ALL SELECT * FROM publicaciones
  UNION ALL SELECT * FROM comentarios
)
SELECT tipo, count(*) AS n,
       md5(string_agg(obj, '|' ORDER BY obj)) AS huella
FROM todo GROUP BY tipo ORDER BY tipo;
