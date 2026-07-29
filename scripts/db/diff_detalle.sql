-- Vuelca el detalle crudo de las categorias que difieren, para diffear prod vs rama.
WITH miembros_ext AS (
  SELECT d.objid, d.classid FROM pg_depend d
  WHERE d.deptype='e' AND d.refclassid='pg_extension'::regclass
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
acl_rel AS (
  SELECT 'l_acl_rel' AS tipo,
         c.relname||':'||coalesce(r.rolname,'PUBLIC')||'='||a.privilege_type AS obj
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  CROSS JOIN LATERAL aclexplode(c.relacl) a
  LEFT JOIN pg_roles r ON r.oid=a.grantee
  WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S') AND c.relacl IS NOT NULL
),
comentarios AS (
  SELECT 'o_comentarios' AS tipo, c.relname||':'||d.objsubid||':'||md5(d.description) AS obj
  FROM pg_description d JOIN pg_class c ON c.oid=d.objoid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S')
  UNION ALL
  SELECT 'o_comentarios' AS tipo, p.proname||':fn:'||md5(d.description) AS obj
  FROM pg_description d JOIN pg_proc p ON p.oid=d.objoid
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prokind IN ('f','p')
    AND NOT EXISTS (SELECT 1 FROM miembros_ext m WHERE m.objid=p.oid AND m.classid='pg_proc'::regclass)
)
SELECT tipo, obj FROM (
  SELECT * FROM secuencias UNION ALL SELECT * FROM acl_rel UNION ALL SELECT * FROM comentarios
) t ORDER BY tipo, obj;
