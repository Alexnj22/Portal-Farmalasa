import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabase, AUTH_STORAGE_KEY } from "../supabaseClient";
import { CACHE_KEYS } from "../store/utils";
import { useStaffStore } from "../store/staffStore";
import { getSignedFileUrl, clearSignedUrlCache } from "../utils/storageFiles";
import { anotar } from '../utils/cajaNegra';
import { fetchRolePermissionsForRoles, fetchRolePriceLevelAndSU, fetchPermisosHeredados } from "../data/permissions";
import { fetchModuleLocks } from "../data/moduleLocks";
import { fetchEmployeeSafeByUsername } from "../data/auth";
import { soltarPushDelEquipoSiEsCompartido, soltarPushAlCerrarLaPagina } from "../utils/pushEquipo";
import AvisoDeInactividad from "../components/common/AvisoDeInactividad";
import { programarEn } from "../utils/temporizadorLargo";

const AuthContext = createContext(null);

// eslint-disable-next-line react-refresh/only-export-components -- patrón estándar de contexto+hook; separar useAuth a otro archivo tocaría decenas de imports para una mejora de solo Fast Refresh en dev
export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de un AuthProvider");
  return ctx;
};

const withTimeout = (promise, ms, label = "timeout") =>
  Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error(label)), ms))]);

// Transient DNS/network failures (ERR_NAME_NOT_RESOLVED, etc.) surface as "Failed to fetch"
// from the browser's fetch API, regardless of which Supabase client (auth/postgrest/functions) made the call.
const NETWORK_ERROR_MSG = 'No se pudo conectar a internet. Revisa tu WiFi/datos e intenta de nuevo.';
const isNetworkError = (err) => {
  if (!err) return false;
  const text = String(err.message || err.name || '');
  return err.name === 'AuthRetryableFetchError' || /Failed to fetch|NetworkError|Load failed/i.test(text);
};
// Retries a Supabase call ({data,error} shape) up to `attempts` times when the failure
// looks like a transient network blip — most DNS/connectivity hiccups clear within a couple seconds.
const withNetworkRetry = async (fn, attempts = 3, delayMs = 1200) => {
  let result;
  for (let i = 0; i < attempts; i++) {
    result = await fn();
    if (!isNetworkError(result?.error)) return result;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return result;
};

// El bucket de fotos de empleados es privado: `photo` lleva URL firmada (7d)
// y `photoRaw` conserva el identificador crudo para poder re-firmar al arrancar
// desde caché sin red round-trip al perfil.
const withSignedPhoto = async (u) => {
  if (!u) return u;
  const raw = u.photoRaw || u.photo;
  if (!raw) return u;
  try {
    const signed = await getSignedFileUrl(raw, 604800);
    return { ...u, photo: signed || raw, photoRaw: raw };
  } catch {
    return { ...u, photoRaw: raw };
  }
};

// -------------------------
// ⏱️ Configuraciones de Sesión e Inactividad
// -------------------------
const LS_USER  = "sb_user";
const LS_LAST  = "sb_last_activity_at";
const LS_PERMS = "sb_role_perms";
const LS_PRICE = "sb_max_price_level";
// `isSU` se guarda JUNTO a los permisos y no solo dentro del usuario, porque
// `hasPermission` corta con `if (isSU) return true` — o sea que los dos datos
// contestan la misma pregunta y tienen que llegar juntos. Vivían separados: los
// permisos se restauraban del caché al instante y el `isSU` lo confirmaba una
// llamada de red posterior, así que la pantalla decidía con la mitad del dato y
// después se corregía sola. Se veía en Metas: la tarjeta ofrecía «registrar la
// autorización del gerente» —el camino de quien NO puede aprobar— y un segundo
// después se convertía en «Aprobar / Devolver».
const LS_SU    = "sb_is_su";
// La clase del dispositivo de ESTA sesión. Ver `detectarClaseDispositivo`.
const LS_DEVICE = "sb_device_class";

const ERP_CACHE_KEYS = [
  CACHE_KEYS.BRANCHES,
  CACHE_KEYS.EMPLOYEES,
  CACHE_KEYS.SHIFTS,
  CACHE_KEYS.ROLES,
  CACHE_KEYS.ANNOUNCEMENTS,
  CACHE_KEYS.AUDIT,
  CACHE_KEYS.AT,
];

const IDLE_EMP_MS   = 5 * 60 * 1000;
const IDLE_ADMIN_MS = 12 * 60 * 60 * 1000;
const IDLE_APP_MS   = 30 * 24 * 60 * 60 * 1000; // 30 días — PWA instalada o build nativo
const CHECK_EVERY_MS        = 30 * 1000;
// Cuánto antes del cierre se pregunta «¿sigues ahí?». Un minuto contra un
// chequeo cada 30 s significa que el aviso sale con 30-60 s de margen: alcanza
// para reaccionar y no tanto como para volverse un cartel que se ignora. La
// cuenta regresiva que se ve es la real, calculada del vencimiento.
const AVISO_INACTIVIDAD_MS  = 60 * 1000;
const ACTIVITY_THROTTLE_MS  = 2000;
// Cada cuánto, como mucho, se le avisa al servidor que la sesión sigue viva.
const HEARTBEAT_MS          = 60 * 1000;
// Cada cuánto, como mucho, se le PREGUNTA al servidor si la sesión sigue viva.
const REVALIDATE_MS         = 60 * 1000;

// La clase del dispositivo: 'app' (PWA instalada o build nativo) o 'navegador'.
//
// Se evalúa UNA vez, al empezar a vigilar la sesión, y no se vuelve a preguntar.
// Antes se resolvía por ventana y además miraba el user-agent — dos errores
// distintos:
//
//  · El user-agent le daba los 30 días a **cualquier** teléfono, aunque fuera
//    una pestaña más del navegador. Nadie decidió eso.
//  · Preguntar por ventana se rompe con la PWA instalada en la MISMA
//    computadora: corre en el mismo perfil y el mismo origen que el navegador,
//    así que comparte `localStorage` — es UNA sesión. Las dos ventanas
//    contestaban distinto (`display-mode: standalone` es falso en la pestaña y
//    verdadero en la PWA) mientras escribían el mismo sello de actividad y
//    usaban el mismo token, así que el vigilante de la pestaña cerraba la
//    sesión que la PWA estaba usando.
//
// Ahora la clase es de la SESIÓN: la fija la ventana desde la que se entró y
// vale para todas. Además vuelve irrelevante cuánto comparten la app de
// pantalla de inicio y el navegador en cada plataforma móvil, que varía.
const detectarClaseDispositivo = () => {
  try {
    const instalada = window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
    const nativo = !!(window.Capacitor?.isNativePlatform?.());
    return (instalada || nativo) ? 'app' : 'navegador';
  } catch { return 'navegador'; }
};

// Primera escritura gana: si esta sesión ya tiene clase, no se toca. Es lo que
// hace que la segunda ventana no pueda contradecir a la primera.
const fijarClaseDispositivo = () => {
  try {
    if (!localStorage.getItem(LS_DEVICE)) {
      localStorage.setItem(LS_DEVICE, detectarClaseDispositivo());
    }
  } catch { /* localStorage no disponible */ }
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // `rolePerms === null` significa NO SE SABE, y `{}` significa «se leyó y no
  // tiene ninguno». Que las dos cosas fueran `null` es lo que hacía que un
  // fallo al LEER los permisos se mostrara como «Sin acceso — tu cuenta no
  // tiene módulos habilitados», que es una acusación falsa: el usuario reportó
  // el 2026-08-16 haberla visto unos segundos al cerrar sesión, antes de que
  // la revalidación lo mandara al login.
  const [rolePerms, setRolePerms] = useState(null);
  const [permsLoading, setPermsLoading] = useState(false);
  // Los permisos no se pudieron leer y ya no se va a reintentar. Es un estado
  // propio para que la app pueda decirlo con esas palabras en vez de inventar
  // que la cuenta no tiene módulos.
  const [permsError, setPermsError] = useState(false);
  const permsIntentosRef = useRef(0);
  const rolePermsRef = useRef(null);
  // `isSU` vive en su PROPIO estado y no dentro del objeto del usuario.
  //
  // Medido el 2026-08-05: arrancaba en `true` y a los ~3.2s pasaba a
  // `undefined` —no a `false`— mientras el caché seguía diciendo `true`. Esa
  // firma es la de un objeto REEMPLAZADO entero por otro construido sin el
  // campo, no la de un permiso que cambió. O sea que cualquier refresco que
  // rearme el usuario degradaba a un superadministrador a mitad de sesión, en
  // TODA la app y en silencio. Se veía en Metas porque ahí las dos ofertas son
  // visiblemente distintas: la tarjeta mostraba «Aprobar / Devolver» y tres
  // segundos después «Registrar la autorización del gerente».
  //
  // Se siembra del caché para que la primera pintada ya sepa la respuesta.
  const [isSU, setIsSU] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_SU) || 'false'); } catch { return false; }
  });
  // Candados de mantenimiento: { [module_key]: { locked_by_id, locked_by_name, reason, locked_at, expires_at } }
  const [moduleLocks, setModuleLocks] = useState({});
  const [maxPriceLevel, setMaxPriceLevel] = useState(null);

  // «¿Hay alguien dentro?», contestable también durante el montaje.
  //
  // `userRef` sólo sirve DESPUÉS del primer render: lo llena un `useEffect`. En
  // los efectos de montaje —y en los cuatro caminos de login, que hacen
  // `setUser` y siguen en el mismo tick— todavía vale `null`, y usarlo como
  // guarda apaga en silencio lo que venga detrás. Ya pasó dos veces en un día:
  // con el latido de `touch_session` y con la validación de sesión.
  const hayAlguienDentro = () => {
    if (userRef.current) return true;
    try { return !!localStorage.getItem(LS_USER); } catch { return false; }
  };

  const idleIntervalRef  = useRef(null);
  const lastWriteRef     = useRef(0);
  const aliveRef         = useRef(true);
  const userRef          = useRef(null);
  const skipAuthListener = useRef(false);
  // access_token de la última sesión que ya pasó por procesarSesion (ver el
  // filtro en el listener: una recarga entrega dos eventos con la misma sesión).
  const sesionProcesada = useRef(null);

  useEffect(() => { userRef.current = user; }, [user]);
  useEffect(() => { rolePermsRef.current = rolePerms; }, [rolePerms]);

  // -------------------------
  // 🔑 Permisos de rol
  // -------------------------
  const refreshPermissions = useCallback((currentUser) => {
    const u = currentUser ?? userRef.current;
    if (!u) {
      setRolePerms(null); setPermsLoading(false); setMaxPriceLevel(null);
      setPermsError(false); permsIntentosRef.current = 0;
      return;
    }

    // Un fallo de lectura no se traga en silencio:
    //   · con permisos ya cargados (caché o red) no cambia nada — se conservan;
    //   · sin permisos, se reintenta, y si aun así no se puede, se DICE.
    const alFallar = () => {
      if (rolePermsRef.current) { setPermsLoading(false); return; }
      if (permsIntentosRef.current < 3) {
        permsIntentosRef.current += 1;
        setPermsLoading(true);
        setTimeout(() => refreshPermissionsRef.current?.(u), 1200 * permsIntentosRef.current);
        return;
      }
      setPermsLoading(false);
      setPermsError(true);
    };

    const roleId = u.roleId ?? (Number.isInteger(u.role) ? u.role : null);
    const secondaryRoleId = Number.isInteger(u.secondaryRoleId) ? u.secondaryRoleId : null;
    const roleIds = [roleId, secondaryRoleId].filter(Number.isInteger);
    const permsQuery = roleIds.length
      ? fetchRolePermissionsForRoles(roleIds)
      : Promise.resolve({ data: [] });
    const priceLevelQuery = roleId
      ? fetchRolePriceLevelAndSU(roleId)
      : Promise.resolve({ data: null });

    /* Lo heredado por ausencia (v2.578.0) NO sale de `role_permissions`:
     * depende de quién esté hoy de vacaciones, así que sólo lo sabe el
     * servidor. Si esta llamada falla, se sigue sin ella —la base decide
     * igual— y lo único que se pierde es que la pantalla lo refleje: un
     * permiso de menos, nunca uno de más. */
    /* `Promise.resolve(...)` NO es decorativo: `supabase.rpc()` devuelve un
     * PostgrestFilterBuilder, que es *thenable* pero NO es una Promise — tiene
     * `.then` y no tiene `.catch`. Encadenarle `.catch` directo lanza
     * «SP().catch is not a function» ANTES de pedir nada, y como esto corre en
     * el arranque de la sesión, se lleva puesto el login entero. Pasó en
     * producción el 2026-08-12. */
    const heredadosQuery = roleId
      ? Promise.resolve(fetchPermisosHeredados()).catch(() => ({ data: [] }))
      : Promise.resolve({ data: [] });

    Promise.all([permsQuery, priceLevelQuery, heredadosQuery])
      .then(([{ data, error }, { data: roleData }, heredados]) => {
        // No sobreescribir en error de red — conservar permisos previos
        if (error || !data) { alFallar(); return; }
        // Bloque 8 — modelo de unión: el permiso efectivo por module_key es el OR
        // entre lo que da el rol primario y lo que da el secundario (si existe);
        // el secundario rellena lo que le falta al primario, nunca lo reemplaza.
        // Empate de scope: gana el más permisivo ('ALL').
        const map = {};
        // Lo heredado entra por el MISMO camino que el cargo secundario: es otra
        // fuente que suma, no una que reemplaza. Va después para que se lea el
        // orden de precedencia, aunque con OR el orden no cambie el resultado.
        const filas = [...data, ...(heredados?.data ?? [])];
        filas.forEach(p => {
          const prev = map[p.module_key];
          if (!prev) {
            map[p.module_key] = { can_view: p.can_view, can_edit: p.can_edit, can_approve: p.can_approve, scope: p.scope || 'MINE' };
          } else {
            map[p.module_key] = {
              can_view: prev.can_view || p.can_view,
              can_edit: prev.can_edit || p.can_edit,
              can_approve: prev.can_approve || p.can_approve,
              // Una fila sin `scope` cae a 'MINE' y no a 'ALL': el default más
              // ancho es el que convierte «no sé» en «todo». En prod las 1,607
              // filas lo tienen puesto, así que esto es la red, no el caso.
              scope: (prev.scope === 'ALL' || p.scope === 'ALL') ? 'ALL' : (prev.scope || p.scope || 'MINE'),
            };
          }
        });
        const price = roleData?.max_price_level ?? null;
        const isSU  = roleData?.is_su ?? false;
        setRolePerms(map);
        setMaxPriceLevel(price);
        setIsSU(isSU);   // el estado propio: nadie más lo pisa
        // Persist isSU on user object so idle-timeout survives page reload from cache
        setUser(prev => {
          if (!prev || prev.isSU === isSU) return prev;
          const updated = { ...prev, isSU };
          try { localStorage.setItem(LS_USER, JSON.stringify(updated)); } catch { /* ignore */ }
          return updated;
        });
        setPermsLoading(false);
        setPermsError(false);
        permsIntentosRef.current = 0;
        try {
          localStorage.setItem(LS_PERMS, JSON.stringify(map));
          localStorage.setItem(LS_PRICE, JSON.stringify(price));
          localStorage.setItem(LS_SU, JSON.stringify(isSU));
        } catch { /* storage lleno — ignorar */ }
      })
      .catch(() => { alFallar(); });
  }, []);

  // El reintento necesita llamarse a sí mismo sin entrar en las dependencias
  // del `useCallback` (que es estable a propósito).
  const refreshPermissionsRef = useRef(null);
  refreshPermissionsRef.current = refreshPermissions;

  // -------------------------
  // 🔧 Candados de mantenimiento por módulo
  // -------------------------
  const refreshModuleLocks = useCallback(() => {
    fetchModuleLocks()
      .then(({ data, error }) => {
        // En error de red NO se limpian los candados: quedarse con el último
        // estado conocido es más seguro que asumir "no hay candado" y dejar
        // escribir durante una migración.
        if (error || !data) return;
        const map = {};
        data.forEach(l => { map[l.module_key] = l; });
        setModuleLocks(map);
      })
      .catch(() => { /* se conserva el estado previo a propósito */ });
  }, []);

  useEffect(() => {
    if (!user) { setModuleLocks({}); return; }
    refreshModuleLocks();
  }, [user?.id, refreshModuleLocks]); // eslint-disable-line react-hooks/exhaustive-deps

  // Realtime: el candado tiene que llegar al instante — si tarda, alguien sigue
  // guardando durante la migración. `module_locks` es una tabla diminuta y casi
  // sin escrituras, así que no repite el problema de decode de WAL que obligó a
  // sacar `product_stock_params` de la publicación (Bloque 4.3).
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel('module_locks_global')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'module_locks' },
        () => refreshModuleLocks())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, refreshModuleLocks]); // eslint-disable-line react-hooks/exhaustive-deps

  // Un candado vence solo (expires_at). Sin este barrido la UI seguiría mostrando
  // el banner y los botones apagados hasta el próximo evento de realtime.
  useEffect(() => {
    if (!Object.keys(moduleLocks).length) return;
    const t = setInterval(() => {
      const now = Date.now();
      setModuleLocks(prev => {
        const vivos = Object.fromEntries(
          Object.entries(prev).filter(([, l]) => new Date(l.expires_at).getTime() > now)
        );
        return Object.keys(vivos).length === Object.keys(prev).length ? prev : vivos;
      });
    }, 30_000);
    return () => clearInterval(t);
  }, [moduleLocks]);

  // Dispara refresh cuando cambia el usuario (id, rol o systemRole)
  // user?.role excluido a propósito: loginWithUsername pone el número, la edge function el nombre
  // — ambos casos tienen roleId correcto, no queremos doble refresh.
  useEffect(() => {
    refreshPermissions(user);
  }, [user?.id, user?.roleId, user?.secondaryRoleId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresca permisos solo al VOLVER a la pestaña (no al ocultarla), y de paso
  // le pregunta al servidor si la sesión sigue existiendo.
  //
  // Lo segundo es la mitad que faltaba: sin esto, una sesión revocada desde otro
  // lado —«Cerrar todas», o alguien cerrándola desde Conexiones— no se notaba
  // hasta que venciera el access token. Volver a la pestaña es el momento
  // natural para enterarse, y con el throttle no cuesta casi nada.
  const ultimaValidacionRef = useRef(0);
  const revalidarSesion = useCallback(async () => {
    if (!hayAlguienDentro()) return;
    const ahora = Date.now();
    if (ahora - ultimaValidacionRef.current < REVALIDATE_MS) return;
    ultimaValidacionRef.current = ahora;
    try {
      const { error } = await withTimeout(supabase.auth.getUser(), 5000, 'getUser timeout');
      // Sólo un rechazo del servidor cierra sesión. Un fallo de red no puede
      // echar a nadie — quedarse sin señal no es haber perdido la sesión.
      if (error && !isNetworkError(error)) doLogout();
    } catch { /* red inestable: se confía en el caché */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- doLogout usa sólo setters y refs estables

  useEffect(() => {
    const onVisible = () => {
      if (userRef.current && document.visibilityState === 'visible') {
        refreshPermissions();
        revalidarSesion();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refreshPermissions, revalidarSesion]);

  // Realtime: refresca permisos en el instante que el admin cambia role_permissions
  // del rol del usuario actual — menú y PermissionGuard reaccionan sin recargar.
  useEffect(() => {
    const roleId = user?.roleId ?? (Number.isInteger(user?.role) ? user?.role : null);
    if (!roleId) return;
    const secondaryRoleId = Number.isInteger(user?.secondaryRoleId) ? user.secondaryRoleId : null;
    const filter = secondaryRoleId
      ? `role_id=in.(${roleId},${secondaryRoleId})`
      : `role_id=eq.${roleId}`;
    const channel = supabase
      .channel(`role_perms_${roleId}_${secondaryRoleId ?? 'x'}_${user?.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'role_permissions', filter },
        () => refreshPermissions()
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, user?.roleId, user?.secondaryRoleId, refreshPermissions]); // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------
  // ⏱️ Inactividad
  // -------------------------
  // ── El límite lo dice el TOKEN, que lo pone el servidor ──────────────────
  //
  // `custom_access_token_hook` mete `idle_limit_min` en los claims con el mismo
  // `session_idle_limit_minutes` que después usa para negar la renovación. Leerlo
  // de ahí es lo que garantiza que el navegador y el servidor no puedan discrepar.
  //
  // Antes el cliente lo DEDUCÍA por su cuenta —caché de permisos, módulos de
  // gestión, `isSU`— y era una segunda copia de una regla que ya vivía en la
  // base. Dos copias de un criterio se desincronizan: la del servidor cambió el
  // 2026-08-17 al pasar a ser configurable por cargo, y ésta no se habría
  // enterado.
  const leerLimiteDelToken = () => {
    try {
      const guardada = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || 'null');
      const token = guardada?.access_token;
      if (!token) return null;
      const cuerpo = token.split('.')[1];
      if (!cuerpo) return null;
      const claims = JSON.parse(atob(cuerpo.replace(/-/g, '+').replace(/_/g, '/')));
      const min = Number(claims?.idle_limit_min);
      return Number.isFinite(min) && min > 0 ? min * 60 * 1000 : null;
    } catch { return null; }   // token ilegible: manda el camino de abajo
  };

  const getIdleLimitMs = (u) => {
    // La clase la fijó la ventana desde la que se inició sesión y vale para
    // todas las de esta sesión. Sin clase —sesión anterior a este cambio— manda
    // el camino estricto, que es el que no regala tiempo.
    if (localStorage.getItem(LS_DEVICE) === 'app') return IDLE_APP_MS;

    // Lo que dijo el servidor, si lo dijo.
    const delToken = leerLimiteDelToken();
    if (delToken) return delToken;

    // ── De acá para abajo es el respaldo, y sólo corre si el token no trae el
    // dato: sesión anterior a este cambio, o el hook que falló y devolvió el
    // evento sin el claim (falla abierta, a propósito). Se conserva el criterio
    // viejo porque en ese caso es lo único que hay.
    //
    // El caché primero: `u.isSU` lo pierde cualquier refresco que rearme el
    // usuario, y sin esto un superadministrador terminaba con el tiempo de
    // inactividad corto sin que nadie lo hubiera decidido.
    try { if (JSON.parse(localStorage.getItem(LS_SU) || 'false')) return IDLE_ADMIN_MS; } catch { /* sigue */ }
    if (u?.isSU) return IDLE_ADMIN_MS;
    try {
      const cached = localStorage.getItem(LS_PERMS);
      if (cached) {
        const perms = JSON.parse(cached);
        const mgmt = ['staff_list','schedules','monitor','requests','time_audit','permissions','announcements'];
        if (mgmt.some(m => perms[m]?.can_view)) return IDLE_ADMIN_MS;
      }
    } catch { /* corrupt cache */ }
    return IDLE_EMP_MS;
  };

  const writeLastActivity = (force = false) => {
    const now = Date.now();
    if (!force && now - lastWriteRef.current < ACTIVITY_THROTTLE_MS) return;
    lastWriteRef.current = now;
    localStorage.setItem(LS_LAST, String(now));
    // El sello se movió: los dos instantes que dependen de él se recalculan.
    // Va acá y no en `onActivity` a propósito — así se re-arma cuando de verdad
    // se escribió, no en cada mousemove que el throttle descarta.
    programarVencimiento();
  };

  // El latido que le cuenta al SERVIDOR que esta sesión sigue viva.
  //
  // El sello de `localStorage` de arriba lo mira sólo este navegador: con el
  // token en la mano y `curl`, los 5 minutos no existen. `touch_session` deja la
  // marca del lado del servidor, y el hook de emisión de token
  // (`custom_access_token_hook`) la usa para negarse a refrescar una sesión
  // vencida. Ésa es la mitad que hace real el límite.
  //
  // Un minuto de throttle: la resolución que necesita el hook es de minutos, no
  // de segundos, y con la pestaña oculta no se manda nada — estar mirando otra
  // cosa no es actividad.
  //
  // `hayUsuario` existe por una carrera medida, no por gusto: `userRef` lo llena
  // un `useEffect`, o sea DESPUÉS del render, y los cuatro caminos de login
  // hacen `setUser(u)` y `startIdleWatcher(u)` uno detrás del otro en el mismo
  // tick. Al llamarse desde ahí, `userRef.current` todavía es null y el primer
  // latido se descartaba en silencio — la sesión no tenía fila del lado del
  // servidor hasta que la persona moviera el mouse. Se descubrió porque
  // `session_activity` quedó VACÍA después de un login de prueba.
  const ultimoLatidoRef = useRef(0);
  const latirSesion = useCallback((hayUsuario = false) => {
    if (!hayUsuario && !userRef.current) return;
    if (document.visibilityState === 'hidden') return;
    const ahora = Date.now();
    if (ahora - ultimoLatidoRef.current < HEARTBEAT_MS) return;
    ultimoLatidoRef.current = ahora;
    let clase = 'navegador';
    try { clase = localStorage.getItem(LS_DEVICE) || 'navegador'; } catch { /* sin localStorage */ }
    // Sin `await` y sin reintento: si un latido se pierde, el próximo lo cubre.
    // Lo que NO puede hacer es romper la interacción que lo disparó.
    supabase.rpc('touch_session', { p_device_class: clase }).then(() => {}, () => {});
  }, []);

  // El aviso previo al cierre por inactividad. `avisoHastaRef` existe porque
  // `onActivity` corre en CADA mousemove: sin él habría que meter el estado en
  // sus dependencias y reenganchar los cinco listeners a cada rato.
  const [avisoHasta, setAvisoHasta] = useState(null);
  const avisoHastaRef = useRef(null);
  const ponerAviso = useCallback((valor) => {
    if (avisoHastaRef.current === valor) return;   // sin esto, un setState por tick
    avisoHastaRef.current = valor;
    setAvisoHasta(valor);
  }, []);

  const onActivity = useCallback(() => {
    if (!userRef.current) return;
    // Mover el mouse YA es la respuesta a «¿sigues ahí?». Esperar al próximo tic
    // dejaría el cartel puesto hasta 30 s después de que la persona volvió.
    if (avisoHastaRef.current) ponerAviso(null);
    writeLastActivity(false);
    latirSesion();
  }, [latirSesion, ponerAviso]);

  // `doLogout` se define más abajo; se referencia por ref para no atarlo a las
  // dependencias del callback (mismo patrón que `refreshPermissionsRef`).
  const doLogoutRef = useRef(null);

  // ── Al volver hay que DECIDIR, no perdonar ───────────────────────────────
  //
  // Esto escribía la actividad y seguía. Pero mientras la pestaña está oculta el
  // chequeo del intervalo NO corre (se saltea a propósito, para que iOS no
  // dispare al reanudar), así que volver de una pestaña minimizada reiniciaba el
  // reloj sin que nadie comprobara si el límite ya se había pasado.
  //
  // Medido el 2026-08-17: con el latido reviviendo la sesión del lado del
  // servidor, un límite de 5 minutos valía ~20 en la práctica —lo que dure el
  // token, mediana 15 min sobre 799 renovaciones reales—. La otra mitad del
  // arreglo vive en `touch_session`, que ya no revive una sesión vencida: ésta
  // es la del navegador, y sin ella la persona se queda mirando una pantalla que
  // ya no puede guardar nada.
  const onVisibilityChange = useCallback(() => {
    if (!userRef.current) return;
    if (document.visibilityState !== 'visible') return;
    const last = parseInt(localStorage.getItem(LS_LAST) || '0', 10);
    if (last && Date.now() - last >= getIdleLimitMs(userRef.current)) {
      doLogoutRef.current?.();
      return;
    }
    writeLastActivity(true);
    latirSesion();
  // `getIdleLimitMs` se redefine en cada render y sólo lee localStorage + el
  // usuario que ya llega por ref. Meterlo en la lista rompería la identidad
  // estable de este callback, que es lo único que permite quitarlo con
  // `removeEventListener`.
  }, [latirSesion]); // eslint-disable-line react-hooks/exhaustive-deps

  const stopIdleWatcher = () => {
    ponerAviso(null);   // que no quede el cartel colgado sobre la pantalla de entrada
    limpiarTemporizadores();
    if (idleIntervalRef.current) { clearInterval(idleIntervalRef.current); idleIntervalRef.current = null; }
    window.removeEventListener('mousemove',   onActivity, true);
    window.removeEventListener('keydown',     onActivity, true);
    window.removeEventListener('wheel',       onActivity, true);
    window.removeEventListener('click',       onActivity, true);
    window.removeEventListener('touchstart',  onActivity, true);
    document.removeEventListener('visibilitychange', onVisibilityChange, true);
  };

  const clearErpCache  = () => ERP_CACHE_KEYS.forEach(k => localStorage.removeItem(k));
  const clearAuthCache = () => {
    localStorage.removeItem(LS_USER);
    localStorage.removeItem(LS_LAST);
    localStorage.removeItem(LS_PERMS);
    localStorage.removeItem(LS_PRICE);
    localStorage.removeItem(LS_SU);
    localStorage.removeItem(LS_DEVICE);
    clearSignedUrlCache();
  };

  const doLogout = () => {
    stopIdleWatcher();
    ultimoLatidoRef.current = 0;   // que el próximo login lata de inmediato

    // El aviso del sistema es del EQUIPO, no de la cuenta —lo emite el
    // navegador de esa computadora—, así que en una máquina compartida cerrar
    // sesión tiene que soltarlo: si no, los avisos de quien se fue siguen
    // cayendo en esa pantalla. Va acá arriba por dos razones: `clearAuthCache()`
    // se lleva la clase de dispositivo, que es el criterio, y el RPC necesita
    // que el token siga puesto. Ver `utils/pushEquipo.js`.
    //
    // Este es el embudo de TODOS los cierres —el botón, el vencimiento por
    // inactividad y la sesión que ya no vale—, que es justo lo que hace falta:
    // en el mostrador el caso normal no es que alguien apriete «salir», es que
    // se levante y la sesión venza sola.
    let claseDispositivo = 'navegador';
    try { claseDispositivo = localStorage.getItem(LS_DEVICE) || 'navegador'; } catch { /* sin localStorage */ }
    soltarPushDelEquipoSiEsCompartido(claseDispositivo);

    clearAuthCache();
    clearErpCache();
    setIsSU(false);   // el estado propio también se apaga: si no, el próximo login arranca con el privilegio del anterior
    setUser(null);
    setRolePerms(null);
    setPermsLoading(false);
    setMaxPriceLevel(null);
    useStaffStore.getState().resetBootState();

    // Cerrar sesión tiene que ser cierto SIN RED, y no se puede delegar en
    // `signOut()`: auth-js retorna antes de `_removeSession()` cuando la
    // revocación falla por algo que no sea 401/403/404 (`_signOut` en
    // GoTrueClient.js). O sea que un corte de red —la laptop que se durmió, que
    // es justo el caso típico del cierre por inactividad— dejaba el token
    // puesto con su refresh token vivo. Y como `clearAuthCache()` ya se llevó el
    // sello de actividad, `isExpiredByIdle` contestaba «no vencido» en la
    // próxima carga: recargabas y volvías adentro.
    //
    // Se le da una ventana corta para revocar del lado del servidor —el token
    // tiene que seguir en `localStorage` mientras tanto, porque de ahí lo lee
    // para saber qué revocar— y después se borra pase lo que pase.
    //
    // `scope: 'local'` revoca SOLO esta sesión. El default de auth-js es
    // 'global': con él, cerrar por inactividad en la computadora se llevaba
    // también la sesión larga del teléfono.
    withTimeout(supabase.auth.signOut({ scope: 'local' }), 3000, 'signOut timeout')
      .catch(() => {})
      .finally(() => {
        try { localStorage.removeItem(AUTH_STORAGE_KEY); } catch { /* localStorage no disponible */ }
      });
  };
  doLogoutRef.current = doLogout;

  // ── El cierre que `doLogout` no ve: cerrar el navegador ───────────────────
  //
  // `doLogout` es el embudo del botón, del vencimiento por inactividad y de la
  // sesión que ya no vale. Cerrar la pestaña no es ninguno de los tres: no
  // dispara nada, y la suscripción de avisos del EQUIPO quedaba ligada a quien
  // se fue. En una computadora de sala eso significa que sus avisos siguen
  // cayendo en esa pantalla. Ver `utils/pushEquipo.js`.
  useEffect(() => {
    if (!user?.id) return undefined;
    const alIrseLaPagina = () => {
      let clase = 'navegador';
      try { clase = localStorage.getItem(LS_DEVICE) || 'navegador'; } catch { /* sin localStorage */ }
      soltarPushAlCerrarLaPagina(clase);
    };
    // `pagehide` y no `beforeunload`: éste no dispara en varios casos de móvil.
    window.addEventListener('pagehide', alIrseLaPagina);
    return () => window.removeEventListener('pagehide', alIrseLaPagina);
  }, [user?.id]);

  // `hayCache` = «esta pregunta se hace teniendo un usuario guardado».
  //
  // Sin sello de actividad y CON usuario en caché sólo puede haber pasado una
  // cosa: alguien llamó a `clearAuthCache()`, o sea que la sesión ya se cerró.
  // Contestar «no vencido» ahí era la otra mitad del agujero que arregla
  // `doLogout`. Sin usuario en caché se mantiene el comportamiento de antes: no
  // hay con qué decidir y no se echa a nadie.
  const isExpiredByIdle = (u, hayCache = false) => {
    const last = parseInt(localStorage.getItem(LS_LAST) || '0', 10);
    if (!last) return hayCache;
    if (last > Date.now()) return false;
    if (Date.now() - last < 5000) return false;
    return Date.now() - last >= getIdleLimitMs(u);
  };

  // ── Los dos instantes que la persona VE ──────────────────────────────────
  //
  // El barrido de abajo mira cada 30 s, y con eso solo el cierre caía en
  // cualquier punto de esos 30 s. Medido el 2026-08-18 contra el entorno de
  // pruebas: el cartel se quedó diciendo «0 segundos» **21 s** después de haber
  // llegado a cero —la sesión seguía abierta— y el aviso, que promete 60 s,
  // salió con 9. Los dos números están en pantalla, así que los dos tienen que
  // ser ciertos: cada uno se programa para su instante exacto.
  //
  // El intervalo NO se va: sigue siendo la red para lo que un temporizador no
  // puede ver —el sello que mueve otra pestaña, el límite que cambia al
  // renovarse el token, el reloj que salta— y para la pestaña oculta, donde
  // estos dos se abstienen por la misma razón que el tic (que iOS no dispare al
  // reanudar). Al volver decide `onVisibilityChange`, que ya cierra si venció.
  const avisoTimeoutRef  = useRef(null);
  const cierreTimeoutRef = useRef(null);

  const limpiarTemporizadores = () => {
    if (avisoTimeoutRef.current)  { clearTimeout(avisoTimeoutRef.current);  avisoTimeoutRef.current  = null; }
    if (cierreTimeoutRef.current) { clearTimeout(cierreTimeoutRef.current); cierreTimeoutRef.current = null; }
  };

  // El plazo puede ser de 30 días (app instalada) y `setTimeout` no llega tan
  // lejos sin desbordar. Por qué, y qué se veía cuando pasaba: `temporizadorLargo.js`.
  const programarVencimiento = () => {
    limpiarTemporizadores();
    if (!idleIntervalRef.current) return;   // sin vigilante no hay nada que programar
    const last = parseInt(localStorage.getItem(LS_LAST) || '0', 10);
    if (!last) return;
    const vence = last + getIdleLimitMs(userRef.current);

    programarEn(avisoTimeoutRef, vence - AVISO_INACTIVIDAD_MS, () => {
      if (document.visibilityState === 'hidden') return;
      ponerAviso(vence);
    });

    programarEn(cierreTimeoutRef, vence, () => {
      if (document.visibilityState === 'hidden') return;
      // El sello pudo moverse entre que se armó esto y que llegó —la escritura
      // tiene 2 s de throttle, y otra pestaña escribe sin avisar—, así que se
      // decide con el valor de AHORA y no con el que se calculó al armar.
      const sello = parseInt(localStorage.getItem(LS_LAST) || '0', 10);
      if (sello && Date.now() < sello + getIdleLimitMs(userRef.current)) { programarVencimiento(); return; }
      doLogoutRef.current?.();
    });
  };

  // Recibe el usuario que los cuatro caminos de login ya le venían pasando —
  // hasta ahora lo ignoraba. Hace falta: en ese momento `userRef` todavía no
  // está puesto (ver la nota de `latirSesion`).
  const startIdleWatcher = (u) => {
    stopIdleWatcher();
    fijarClaseDispositivo();
    if (!localStorage.getItem(LS_LAST)) writeLastActivity(true);
    // Primer latido al arrancar: sin esto la sesión no tendría fila del lado del
    // servidor hasta que alguien mueva el mouse, y el hook la vería «recién
    // nacida» todo ese rato.
    latirSesion(!!(u || userRef.current));

    window.addEventListener('mousemove',  onActivity, true);
    window.addEventListener('keydown',    onActivity, true);
    window.addEventListener('wheel',      onActivity, true);
    window.addEventListener('click',      onActivity, true);
    window.addEventListener('touchstart', onActivity, true);
    document.addEventListener('visibilitychange', onVisibilityChange, true);

    idleIntervalRef.current = setInterval(() => {
      // Skip while app is backgrounded — prevents iOS from firing stale checks
      // on resume before visibilitychange can refresh the activity timestamp.
      if (document.visibilityState === 'hidden') return;
      const last = parseInt(localStorage.getItem(LS_LAST) || '0', 10);
      if (!last) return;
      // Re-read limit each tick so it reflects permissions loaded after login.
      const vence = last + getIdleLimitMs(userRef.current);
      if (Date.now() >= vence) { doLogout(); return; }
      // Preguntar antes de cerrar. Se guarda el INSTANTE del vencimiento y no
      // los segundos que faltan: el diálogo hace su propia cuenta contra ese
      // instante, así que no se desfasa si un tic llega tarde.
      ponerAviso(vence - Date.now() <= AVISO_INACTIVIDAD_MS ? vence : null);
      // Y se reprograman los dos instantes con los números de este tic: si el
      // límite cambió —el token se renovó con otro `idle_limit_min`— el
      // temporizador armado quedó apuntando a la hora vieja.
      programarVencimiento();
    }, CHECK_EVERY_MS);
    // Sin esto, el primer aviso/cierre esperaría al primer tic.
    programarVencimiento();
  };

  // -------------------------
  // ✅ Boot: cache local instantáneo
  // -------------------------
  useEffect(() => {
    const cached = localStorage.getItem(LS_USER);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (isExpiredByIdle(parsed, true)) {   // hay usuario en caché: sin sello = cerrada
          clearAuthCache();
          clearErpCache();
        } else {
          // Load cached perms instantly — avoids the network round-trip that
          // previously blocked the UI with permsLoading=true on every page load.
          // refreshPermissions() will update them silently in the background.
          const cachedPerms = localStorage.getItem(LS_PERMS);
          if (cachedPerms) {
            try {
              setRolePerms(JSON.parse(cachedPerms));
              const cachedPrice = localStorage.getItem(LS_PRICE);
              setMaxPriceLevel(cachedPrice ? JSON.parse(cachedPrice) : null);
              // permsLoading stays false — cached perms are ready immediately
            } catch {
              setPermsLoading(true); // corrupt cache — fall back to network
            }
          } else {
            setPermsLoading(true); // first login — must fetch from network
          }
          // El `isSU` del caché de permisos manda sobre el del usuario: los dos
          // se escriben en la misma respuesta, pero el del usuario puede venir
          // de un login viejo que todavía no lo tenía. Sin esto, la primera
          // pintada decide con `isSU` en falso y se corrige sola al llegar la
          // red — que es el parpadeo de botones que se veía en Metas.
          try {
            const su = localStorage.getItem(LS_SU);
            if (su != null) parsed.isSU = JSON.parse(su);
          } catch { /* caché corrupto — manda el del usuario */ }
          setUser(parsed);
          startIdleWatcher(parsed);
          // Re-firmar la foto (la firmada cacheada puede haber expirado)
          if (parsed.photoRaw) {
            getSignedFileUrl(parsed.photoRaw, 604800).then((signed) => {
              if (signed && signed !== parsed.photo) {
                setUser(prev => {
                  if (!prev) return prev;
                  const updated = { ...prev, photo: signed };
                  try { localStorage.setItem(LS_USER, JSON.stringify(updated)); } catch { /* ignore */ }
                  return updated;
                });
              }
            }).catch(() => {});
          }
        }
      } catch {
        clearAuthCache();
        clearErpCache();
      }
    }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------
  // ✅ Validación de sesión + listener de estado
  // -------------------------
  useEffect(() => {
    aliveRef.current = true;

    // Verifica CONTRA EL SERVIDOR que la sesión sigue existiendo.
    //
    // Antes usaba `getSession()`, que **no valida nada**: lee el token del disco
    // y lo devuelve. Se llamaba `validateSession` y su comentario decía «verifica
    // que la sesión sigue activa», pero la única forma de que fallara era que no
    // hubiera token guardado.
    //
    // El agujero se vio el 2026-08-09, con «Cerrar todas» sobre la propia cuenta:
    // se borraron las 3,406 sesiones del servidor y el portal siguió pintando el
    // tablero, incluso tras recargar. Reproducido, y medido con los dos extremos:
    //
    //     /auth/v1/user  ->  403 session_not_found   ← getUser() SÍ pregunta
    //     /rest/v1/…     ->  200                     ← los datos siguen saliendo
    //
    // O sea que revocar una sesión no corta el acceso a los datos hasta que
    // vence el access token (15 min con el ajuste de F1); lo que sí se puede
    // hacer, y es lo que faltaba, es enterarse y cerrar la puerta de este lado.
    //
    // `getUser()` cuesta una llamada de red al arrancar. Es el precio de que la
    // pregunta se conteste de verdad.
    //
    // ── Pero se pregunta POR FUERA de auth-js (2026-08-20) ──────────────────
    // `supabase.auth.getUser()` es una operación de auth-js, y auth-js
    // serializa: hasta que termina, el cliente no se da por inicializado, no
    // emite `INITIAL_SESSION` y **no sale un solo dato del portal**. Medido en
    // producción: la avalancha de datos arrancaba exactamente en el
    // milisegundo en que contestaba `/auth/v1/user`.
    //
    // La pregunta es la misma —GET a `/auth/v1/user` con el mismo token, y un
    // 401/403 sigue significando sesión revocada—, pero hecha con `fetch`
    // pelado no entra en esa fila. A/B de tres corridas por lado, mismo build:
    //
    //     arranque de datos   349 ms → 112 ms   (mediana)
    //     último dato         899 ms → 637 ms
    //     dispersión       275-938 ms → 109-114 ms
    //
    // Lo que más importa es la tercera fila: el temblor desaparece. La cola de
    // auth-js dependía de si el token estaba por vencer, así que la misma
    // pantalla tardaba 275 ms o casi un segundo sin motivo visible.
    //
    // `getSession()` sí se puede llamar —lee del disco, no de la red— y no
    // bloquea: medido, con él la primera petición sale igual a los 112 ms.
    const validateSession = async () => {
      // `userRef` NO sirve como guarda acá: lo llena un `useEffect`, o sea
      // después del render, y este efecto de montaje corre antes. Preguntar por
      // él daba siempre `null` y la validación no se ejecutaba nunca — el mismo
      // tropiezo que ya se había arreglado en `latirSesion`, cometido otra vez
      // el mismo día. Lo agarró la prueba, no una lectura del código.
      //
      // La pregunta correcta es «¿hay alguien dentro?», y en el arranque eso
      // vive en el caché, no en el ref.
      if (!hayAlguienDentro()) return;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        // Sin token no hay nada que preguntar: quien no tiene sesión no puede
        // tener una revocada. El caché local decide, como hasta ahora.
        if (!token) return;

        const resp = await withTimeout(
          fetch(`${import.meta.env.VITE_SUPABASE_URL}/auth/v1/user`, {
            headers: {
              Authorization: `Bearer ${token}`,
              apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
            },
          }),
          5000,
          'getUser timeout',
        );
        if (!aliveRef.current) return;

        // SÓLO se cierra ante un rechazo real del servidor. Un fallo de red no
        // puede echar a nadie: sin esta distinción, quedarse sin señal en una
        // sucursal sacaría a todo el mundo del portal. Con `fetch` esa
        // distinción es más nítida que antes —una caída de red LANZA y cae al
        // `catch`, no llega acá—, y por eso el veredicto se lee del ESTADO:
        //
        //   401 / 403 → el servidor dice que esta sesión no vale. Se cierra.
        //   cualquier otro (500, 502, 504…) → el servidor tuvo un problema,
        //   que NO es lo mismo que decir que no. Se confía en el caché.
        //
        // Ese segundo caso es el único cambio de conducta, y va en la
        // dirección segura: hasta hoy un 500 del servidor de sesiones no
        // contaba como «error de red», así que sacaba del portal a todo el que
        // estuviera adentro.
        if (resp.status === 401 || resp.status === 403) {
          doLogout();
          // Y se borra el token ACÁ, además de en `doLogout`.
          //
          // No es redundante: `doLogout` lo quita en el `.finally()` de un
          // `signOut()` al que le da hasta 3 s, y hasta hoy eso no se notaba
          // porque auth-js, al recibir el 403 de su propio `getUser()`, soltaba
          // la sesión él mismo de inmediato. Preguntando con `fetch` nunca se
          // entera, así que quedaba una ventana de hasta tres segundos con la
          // persona ya en el login y su token todavía en el disco.
          //
          // Lo agarró `sesion-revocada-movil.spec.js`, que comprueba justo eso
          // —«el token siguió guardado tras cerrar la sesión»— y no la pantalla,
          // que ya se veía bien. Y no hay nada que revocar del lado del
          // servidor: un 403 significa que esa sesión ya no existe allá.
          try { localStorage.removeItem(AUTH_STORAGE_KEY); } catch { /* sin localStorage */ }
        }
      } catch {
        // Timeout o red inestable → se confía en el caché local.
      }
    };

    validateSession();

    // Listener maestro: INITIAL_SESSION, TOKEN_REFRESHED, SIGNED_OUT
    //
    // El callback es SÍNCRONO y no llama a supabase, a propósito. auth-js espera
    // a que cada suscriptor termine antes de dar por inicializado el cliente, y
    // toda llamada a supabase espera esa inicialización: pedir algo desde acá
    // adentro es un bloqueo mutuo consigo mismo. Medido en el portal —
    // SIGNED_IN llegaba a los 139 ms, el callback llamaba a
    // `ensure_user_by_code`, se colgaba, y recién a los 5,000 ms (el timeout)
    // se destrababa: INITIAL_SESSION salía a los 5,145 ms y TODA la app
    // esperaba detrás. La UI se pintaba a los 324 ms y la primera petición no
    // salía hasta los 5,1 s.
    //
    // El trabajo async se dispara con setTimeout(0) y SIN await: así el callback
    // retorna de inmediato y auth-js termina de inicializar.
    const procesarSesion = (session) => {
      (async () => {
        try {
          const meta = session.user?.user_metadata;
          const code = meta?.code || (session.user.email ? session.user.email.split('@')[0] : '');
          const cleanCode = String(code || '').trim().toUpperCase();
          if (!cleanCode) return;

          const { data: ensured, error: fnErr } = await withTimeout(
            supabase.functions.invoke('ensure_user_by_code', { body: { code: cleanCode } }),
            5000,
            'ensure_user_by_code timeout',
          );

          // El carné de PAPEL vale hasta medianoche. El servidor es el único que
          // puede decirlo —el reloj del navegador no cuenta— y lo dice con este
          // motivo exacto. Se cierra la sesión SÓLO ante ese veredicto: un fallo
          // de red o un `ok:false` de cualquier otra causa no echa a nadie, que
          // es la diferencia entre un vencimiento y una caída de internet.
          if (ensured?.error === 'CARNE_VENCIDO') { doLogout(); return; }

          if (fnErr || !ensured?.ok || !ensured?.user) return;
          if (!aliveRef.current) return;

          const u = await withSignedPhoto(ensured.user);
          if (isExpiredByIdle(u)) { doLogout(); return; }

          setUser(u);
          localStorage.setItem(LS_USER, JSON.stringify(u));
          startIdleWatcher(u);
          // NO se llama a refreshPermissions acá: el efecto de abajo
          // ([user?.id, user?.roleId, user?.secondaryRoleId]) ya cubre los dos
          // casos. Si el rol cambió en el servidor, estos ids cambian y el
          // efecto dispara solo; si no cambió, el arranque desde el cache local
          // ya trajo los permisos frescos de red ~70 ms antes y esta llamada
          // repetía las mismas dos consultas.
        } catch (e) {
          // Callado A PROPÓSITO para el usuario: si esto lanza, la sesión ya
          // está abierta y lo único que faltó es refrescar el perfil — cortar
          // acá con una pantalla de error dejaría afuera a alguien que sí puede
          // entrar. Pero callado no es sin rastro: queda en la caja negra, que
          // sobrevive a la recarga y se lee en Sistema → Prueba de iOS. Sin
          // eso, un login que se queda a medias en el teléfono de una sala no
          // deja NADA que mirar.
          anotar('auth-perfil-fallo', { mensaje: String(e?.message || e).slice(0, 140) });
        }
      })();
    };

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      try {
        if (skipAuthListener.current) return;

        if (event === 'SIGNED_OUT' || !session?.user) {
          stopIdleWatcher();
          clearAuthCache();
          clearErpCache();
          sesionProcesada.current = null;
          setUser(null);
          return;
        }

        // Usuario con contraseña temporal: loginWithUsername maneja ese flujo.
        // Las cuentas kiosk/carné (@staff.local) no usan contraseña personal — se exentan.
        const meta = session.user?.user_metadata;
        if (!meta?.kiosk && meta?.must_change_password !== false) {
          clearAuthCache();
          clearErpCache();
          return;
        }

        // Una recarga entrega DOS eventos para la MISMA sesión: SIGNED_IN y,
        // ~130 ms después, INITIAL_SESSION — medido en el build de producción,
        // con idéntico access_token, expires_at y user.id. El listener los
        // trataba como dos sesiones distintas, así que cada recarga invocaba
        // `ensure_user_by_code` DOS veces (una edge function) y disparaba dos
        // rondas de perfil + permisos + refirmado de fotos.
        // Se compara el token y no el usuario a propósito: TOKEN_REFRESHED trae
        // uno nuevo y sí tiene que reprocesarse.
        if (sesionProcesada.current === session.access_token) return;
        sesionProcesada.current = session.access_token;

        setTimeout(() => procesarSesion(session), 0);
      } catch (e) {
        // Mismo criterio: un error acá no puede tumbar el listener de sesión —
        // si lanza, Supabase deja de avisar de los cambios y el portal queda
        // creyendo que sigue conectado. Se anota y se sigue.
        anotar('auth-evento-fallo', { mensaje: String(e?.message || e).slice(0, 140), evento: event });
      }
    });

    return () => {
      aliveRef.current = false;
      sub?.subscription?.unsubscribe();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------
  // 🔐 Login — Kiosk (por código/PIN)
  // -------------------------
  const login = async (identifier) => {
    const cleanId = String(identifier ?? '').trim().toUpperCase();
    if (!cleanId) return { ok: false };
    skipAuthListener.current = true;
    try {
      const { data: ensured, error: fnErr } = await withNetworkRetry(() =>
        supabase.functions.invoke('ensure_user_by_code', { body: { code: cleanId } })
      );
      if (isNetworkError(fnErr)) return { ok: false, error: NETWORK_ERROR_MSG };
      if (fnErr || !ensured?.ok || !ensured?.user?.email) return { ok: false };

      const { data: authData, error: authErr } = await withNetworkRetry(() =>
        supabase.auth.signInWithPassword({ email: ensured.user.email, password: cleanId })
      );
      if (isNetworkError(authErr)) return { ok: false, error: NETWORK_ERROR_MSG };
      if (authErr || !authData?.session) return { ok: false };

      // Segunda llamada (ya autenticada): devuelve el perfil completo y sincroniza
      // metadata del JWT. Completar aquí mismo evita depender del listener.
      const { data: profile, error: profErr } = await withNetworkRetry(() =>
        supabase.functions.invoke('ensure_user_by_code', { body: { code: cleanId } })
      );
      if (isNetworkError(profErr)) return { ok: false, error: NETWORK_ERROR_MSG };
      if (profErr || !profile?.ok || !profile?.user?.id) return { ok: false };

      completeLogin(profile.user);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: isNetworkError(err) ? NETWORK_ERROR_MSG : undefined };
    } finally {
      skipAuthListener.current = false;
    }
  };

  // -------------------------
  // 🔐 Login — Email + password
  // -------------------------
  const loginWithEmail = async (email, password) => {
    skipAuthListener.current = true;
    try {
      const { data: authData, error: authErr } = await withNetworkRetry(() =>
        supabase.auth.signInWithPassword({ email, password })
      );
      if (authErr || !authData?.session) {
        skipAuthListener.current = false;
        return false;
      }

      const sessionUser = authData.session.user;
      const code = (sessionUser.user_metadata?.code && String(sessionUser.user_metadata.code)) ||
        (sessionUser.email ? sessionUser.email.split('@')[0] : '');
      const cleanCode = String(code || '').trim().toUpperCase();
      if (!cleanCode) { skipAuthListener.current = false; return false; }

      const { data: ensured, error: fnErr } = await withNetworkRetry(() =>
        supabase.functions.invoke('ensure_user_by_code', { body: { code: cleanCode } })
      );
      if (fnErr || !ensured?.ok || !ensured?.user) { skipAuthListener.current = false; return false; }

      const u = await withSignedPhoto(ensured.user);
      clearErpCache();
      localStorage.setItem(LS_USER, JSON.stringify(u));
      writeLastActivity(true);
      setPermsLoading(true);
      setUser(u);
      startIdleWatcher(u);
      skipAuthListener.current = false;
      return true;
    } catch {
      skipAuthListener.current = false;
      return false;
    }
  };

  // -------------------------
  // 🔐 Login — Username + password (portal principal)
  // -------------------------
  const loginWithUsername = async (username, password) => {
    skipAuthListener.current = true;
    try {
      const cleanUsername = username.toLowerCase().trim();
      const emailToLogin  = `${cleanUsername}@farmalasa.app`;

      const { data, error } = await withNetworkRetry(() =>
        supabase.auth.signInWithPassword({ email: emailToLogin, password })
      );

      if (error) {
        skipAuthListener.current = false;
        if (isNetworkError(error)) return { ok: false, error: NETWORK_ERROR_MSG };
        return error.message.includes('Invalid login credentials')
          ? { ok: false, error: 'Usuario no encontrado o contraseña incorrecta.' }
          : { ok: false, error: error.message };
      }

      if (!data?.session) {
        skipAuthListener.current = false;
        return { ok: false, error: 'Error de sesión. Intenta de nuevo.' };
      }

      const { data: emp, error: empError } = await withNetworkRetry(() =>
        fetchEmployeeSafeByUsername(cleanUsername)
      );

      if (empError && empError.code !== 'PGRST116') {
        skipAuthListener.current = false;
        if (isNetworkError(empError)) return { ok: false, error: NETWORK_ERROR_MSG };
        return { ok: false, error: 'Error de conexión. Intenta de nuevo.' };
      }
      if (!emp) {
        skipAuthListener.current = false;
        return { ok: false, error: 'Usuario no encontrado en el sistema.' };
      }

      // Empleado dado de baja: la cuenta Auth queda baneada por disable-employee-auth,
      // pero este gate cubre bajas previas al ban y cierra la sesión recién creada.
      if (emp.status && emp.status !== 'ACTIVO') {
        skipAuthListener.current = false;
        supabase.auth.signOut().catch(() => {});
        return { ok: false, error: 'Tu cuenta está desactivada. Contacta a Recursos Humanos.' };
      }

      const u = await withSignedPhoto({
        id:         emp.id,
        name:       emp.name,
        code:       emp.code,
        username:   emp.username,
        branchId:   emp.branch_id,
        photo:      emp.photo_url,
        role:       emp.role_id,
        roleId:     emp.role_id ?? null,
        secondaryRoleId: emp.secondary_role_id ?? null,
        systemRole: emp.system_role || 'EMPLEADO',
      });

      const meta       = data.session.user?.user_metadata;
      const mustChange = meta?.must_change_password !== false;

      if (mustChange) {
        // skipAuthListener se mantiene true hasta que completePasswordChange lo restaure
        return { ok: true, mustChangePassword: true, user: u };
      }

      skipAuthListener.current = false;
      clearErpCache();
      localStorage.setItem(LS_USER, JSON.stringify(u));
      writeLastActivity(true);
      setPermsLoading(true);
      setUser(u);
      startIdleWatcher(u);
      return { ok: true };
    } catch (err) {
      skipAuthListener.current = false;
      return { ok: false, error: isNetworkError(err) ? NETWORK_ERROR_MSG : 'Error de conexión con el servidor.' };
    }
  };

  const completeLogin = async (u) => {
    const su = await withSignedPhoto(u);
    clearErpCache();
    localStorage.setItem(LS_USER, JSON.stringify(su));
    writeLastActivity(true);
    setPermsLoading(true);
    setUser(su);
    startIdleWatcher(su);
  };

  const completePasswordChange = async (u) => {
    const su = await withSignedPhoto(u);
    skipAuthListener.current = false;
    clearErpCache();
    localStorage.setItem(LS_USER, JSON.stringify(su));
    writeLastActivity(true);
    setPermsLoading(true);
    setUser(su);
    startIdleWatcher(su);
  };

  const logout = async () => doLogout();

  // -------------------------
  // 📦 Contexto expuesto
  // -------------------------
  const value = useMemo(() => {
    // Del estado propio, NO de `user.isSU`: ese campo lo pierde cualquier
    // refresco que rearme el usuario (ver la nota del `useState` de arriba).
    // Se sigue escribiendo en el usuario para el temporizador de inactividad,
    // pero los permisos ya no dependen de que sobreviva ahí.

    /* El alcance, con el MISMO terminal que `auth_module_scope()` en la base.
     *
     * Terminaba en `'ALL'`: «no sé cuál es tu alcance → todos». Hoy no hace
     * daño porque un módulo que no está en `rolePerms` tampoco da permiso, y
     * ninguna vista se dibuja sin él — pero es la misma forma de fallo que
     * costó los 29 traslados ajenos de Salud 3: un default que decide a lo
     * ancho lo que nadie decidió.
     *
     * El superusuario va aparte porque `hasPermission` le dice que sí a todo:
     * sin esta rama entraría a cualquier pantalla con alcance de una sola sala.
     * Y va DESPUÉS del `rolePerms`, no antes, para que un superusuario con fila
     * explícita conserve la suya.
     *
     * Lo heredado por ausencia no necesita rama: `mis_permisos_heredados()`
     * viene mezclado en `rolePerms` con su propio `scope` (ver el `.then` de
     * arriba), así que llega por el camino normal. */
    const getScope = (moduleKey) => rolePerms?.[moduleKey]?.scope ?? (isSU ? 'ALL' : 'MINE');

    // Espejo exacto de auth_module_locked() en la BD: vigente + no soy el titular.
    // Si las dos mitades no coinciden, la UI habilita botones que el servidor
    // rechaza (o al revés) — por eso el criterio se escribe una sola vez acá.
    const moduleLock = (moduleKey) => {
      const l = moduleLocks?.[moduleKey];
      if (!l) return null;
      if (new Date(l.expires_at).getTime() <= Date.now()) return null;
      return l;
    };
    const isModuleLocked = (moduleKey) => {
      const l = moduleLock(moduleKey);
      return !!l && l.locked_by_id !== user?.id;
    };

    const hasPermission = (moduleKey, action = 'can_view') => {
      if (isSU) return true;
      if (!rolePerms) return false;
      // El candado deja LEER (decisión de diseño: solo lectura, no bloqueo total).
      // Solo apaga escritura y aprobación — y con eso se apagan solos todos los
      // botones que ya consultan canManage/canApprove, sin tocarlos uno por uno.
      if (action !== 'can_view' && isModuleLocked(moduleKey)) return false;
      return !!(rolePerms[moduleKey]?.[action]);
    };

    return {
      user, isAuthenticated: !!user,
      isSU, getScope,
      rolePerms, permsLoading, permsError, hasPermission,
      moduleLocks, moduleLock, isModuleLocked, refreshModuleLocks,
      maxPriceLevel, loading,
      completeLogin, completePasswordChange,
      login, loginWithEmail, loginWithUsername, logout,
      refreshPermissions,
    };
  // `permsLoading` y `permsError` van en la lista: `permsError` cambia SOLO
  // —sin que cambien los permisos—, así que sin él la app nunca se entera de
  // que la lectura falló y se queda en el splash para siempre.
  }, [user, loading, isSU, rolePerms, permsLoading, permsError, moduleLocks, refreshPermissions, refreshModuleLocks]); // eslint-disable-line react-hooks/exhaustive-deps

  // Se monta acá y no en el layout a propósito: colgado del provider aparece en
  // CUALQUIER pantalla donde haya sesión —incluida una que se abra fuera del
  // layout—, y `{children}` conserva su referencia, así que este estado no
  // vuelve a renderizar el árbol de abajo.
  return (
    <AuthContext.Provider value={value}>
      {children}
      {!!user && (
        <AvisoDeInactividad
          hasta={avisoHasta}
          onSeguir={() => { ponerAviso(null); writeLastActivity(true); latirSesion(); }}
        />
      )}
    </AuthContext.Provider>
  );
};

export default AuthContext;
