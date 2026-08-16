import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    Clock, ScanBarcode, Loader2, ChevronRight,
    ShoppingCart, Pill, AlertCircle, Lock, Camera,
    User as UserIcon, Sparkles, ArrowRight, X, CheckCircle2,
} from 'lucide-react';

import { useAuth } from '../context/AuthContext';
import { isMobileOrApp } from '../utils/helpers';
import { supabase } from '../supabaseClient';
import { mensajeAmigable } from '../utils/errorMessages';
import useMediaQuery from '../hooks/useMediaQuery';

// Lectores físicos (keyboard-wedge) tipean rápido y terminan con Enter.
const SCAN_KEY_GAP_MS = 250;
const SCAN_MIN_LENGTH = 3;
// Ventana inicial con prioridad del lector: si nadie escanea, el foco pasa a
// usuario. Eran 10s y no alcanzaban para sacar el carné y acercarlo al lector
// (2026-08-16, a pedido del usuario): el foco saltaba al campo de usuario en
// mitad del gesto y el carné terminaba tecleándose adentro del campo.
const SCAN_FOCUS_WAIT_MS = 30_000;

/* ── Ráfaga del lector DENTRO de un campo ────────────────────────────────
   El carné ES la contraseña (`AuthContext.login` lo manda como `password`),
   así que si el lector dispara con el foco puesto en «usuario» el código
   queda ESCRITO Y A LA VISTA en un campo de texto plano — cualquiera que
   mire la pantalla se lleva la credencial. La captura global de keydown no
   cubre ese caso a propósito: mientras el foco está en un input, las teclas
   son del input.
   La solución es medir la velocidad, que es lo único que distingue un lector
   de una persona: 40ms es el mismo umbral con el que `detectInputMethod`
   (utils/timeClock.helpers.js) separa ESCANER_INFRARROJO de TECLADO_MANUAL
   en el kiosco. A las 3 teclas seguidas por debajo de ese hueco se borra lo
   que alcanzó a pintarse y el resto no llega al campo.
   Los códigos reales miden 3, 4 o 5 caracteres (medido sobre `employees`),
   así que el detector NO puede esperar a la sexta tecla: tiene que decidir
   con dos huecos. Por eso existe la vuelta atrás — si el hueco siguiente es
   humano, era un tecleo veloz y el texto se devuelve al campo intacto. */
const RAFAGA_GAP_MS = 40;
const RAFAGA_MIN_TECLAS = 3;
// Un lector sin sufijo Enter existe: si la ráfaga muere sin Enter, se toma
// como escaneo igual. Devolver el código al campo sería justamente publicar
// la credencial que este bloque evita.
const RAFAGA_ESPERA_ENTER_MS = 400;

/* ── ¿Este equipo tiene lector? ──────────────────────────────────────────
   No hay forma de preguntárselo al navegador: un lector de carné se presenta
   como un teclado más, sin marca ni identidad (WebHID pediría permiso
   explícito y no lo dan las tablets). Lo que sí se puede saber es si ALGUNA
   VEZ escaneó alguien acá, y si este equipo está vinculado como kiosco — que
   por definición tiene lector. Con las dos cosas en falso, el login deja de
   pedir un carné que nadie puede acercar (2026-08-16, a pedido del usuario:
   «si no hay lector conectado, que no pida escanear»).
   Ojo: la CAPTURA sigue encendida siempre. Lo que se apaga es la interfaz y
   la espera de 30s — así el primer escaneo de un equipo nuevo funciona igual
   y, de paso, es el que enciende el cartel para las próximas veces. */
const LECTOR_VISTO = 'lector_carne_visto';

const hayLector = () => {
    if (isMobileOrApp()) return false;          // un teléfono no lleva lector
    try {
        if (localStorage.getItem('kiosk_config')) return true;   // terminal de sala
        return localStorage.getItem(LECTOR_VISTO) === '1';
    } catch { return false; }                   // localStorage bloqueado
};

const recordarLector = () => {
    try { localStorage.setItem(LECTOR_VISTO, '1'); } catch { /* modo privado */ }
};

/* ── Velocidad: lo único que separa un lector de una persona ─────────────
   Copia deliberada del umbral de `detectInputMethod`
   (utils/timeClock.helpers.js), que es con el que el kiosco viene separando
   ESCANER_INFRARROJO de TECLADO_MANUAL. No se importa de ahí para no arrastrar
   el módulo de asistencia al chunk del login; el número es el mismo y este
   comentario es el puente. */
const esVelocidadDeLector = (tiempos) => {
    if (!Array.isArray(tiempos) || tiempos.length < RAFAGA_MIN_TECLAS) return false;
    const total = tiempos[tiempos.length - 1] - tiempos[0];
    return total / (tiempos.length - 1) < RAFAGA_GAP_MS;
};

/* ─── Shared styles ─────────────────────────────────────────────────────── */

const inputCls = [
    'w-full',
    'bg-[var(--lgn-campo)] hover:bg-[var(--lgn-campo-hover)]',
    'backdrop-blur-md',
    'border border-border-card hover:border-border-card',
    'text-content placeholder-content-3/80',
    'outline-none',
    'focus:bg-[var(--lgn-campo-foco)] focus:border-border-card',
    'focus:shadow-[var(--shadow-shine-lg)]',
    'transition-all duration-[var(--dur-base)]',
    'font-bold',
].join(' ');

/* El login vive FUERA de `ThemeProvider` (es la única vista sin shell), así
   que no puede consumir sus tokens de superficie: los define acá y los
   duplica bajo `[data-theme="dark"]`, que es el atributo que esta misma
   vista estampa según el modo claro/oscuro del sistema. Un solo juego de
   variables en el contenedor raíz — así el material se decide en UN lugar y
   no en veinte `bg-white/[0.xx]` sueltos que sólo servían para el fondo
   claro. */
const keyframeStyles = `
    .lgn-fondo{
        --lgn-bg:radial-gradient(ellipse at 38% 28%, #ded8ff 0%, #eae8ff 22%, #eef2ff 50%, #f3f4fb 100%);
        --lgn-vidrio:rgba(255,255,255,0.20);
        --lgn-vidrio-borde:rgba(255,255,255,0.84);
        --lgn-brillo:rgba(255,255,255,0.26);
        --lgn-campo:rgba(255,255,255,0.22);
        --lgn-campo-hover:rgba(255,255,255,0.32);
        --lgn-campo-foco:rgba(255,255,255,0.58);
        /* Opaco: la sombra interior que tapa el amarillo del autocompletado
           no puede ser translúcida, así que es el color que da el campo ya
           mezclado sobre la tarjeta. */
        --lgn-campo-solido:#eeecfb;
        --lgn-linea:rgba(255,255,255,0.60);
        --lgn-boton:rgba(255,255,255,0.18);
        --lgn-boton-hover:rgba(255,255,255,0.38);
        --lgn-logo-filo:rgba(255,255,255,1);
    }
    [data-theme="dark"] .lgn-fondo{
        --lgn-bg:radial-gradient(ellipse at 38% 28%, #241a55 0%, #1b1445 22%, #150f36 50%, #0c0822 100%);
        --lgn-vidrio:rgba(255,255,255,0.06);
        --lgn-vidrio-borde:rgba(255,255,255,0.14);
        --lgn-brillo:rgba(255,255,255,0.07);
        --lgn-campo:rgba(255,255,255,0.07);
        --lgn-campo-hover:rgba(255,255,255,0.11);
        --lgn-campo-foco:rgba(255,255,255,0.17);
        --lgn-campo-solido:#2a2258;
        --lgn-linea:rgba(255,255,255,0.20);
        --lgn-boton:rgba(255,255,255,0.05);
        --lgn-boton-hover:rgba(255,255,255,0.12);
        --lgn-logo-filo:rgba(255,255,255,0.16);
    }
    @keyframes lgn-logo{0%,100%{transform:scale(1);box-shadow:0 12px 40px rgba(110,70,220,0.16),inset 0 2px 0 var(--lgn-logo-filo);}50%{transform:scale(1.04);box-shadow:0 20px 56px rgba(110,70,220,0.28),inset 0 2px 0 var(--lgn-logo-filo);}}
    /* El relleno amarillo del autocompletado es del navegador y no entiende
       de temas: en oscuro dejaba dos barras amarillo chillón con el texto
       negro y el placeholder ilegible encima. Chrome no deja cambiar ese
       fondo —lo pinta aparte—, pero sí se tapa con una sombra interior del
       tamaño del campo, que es la receta de siempre. */
    .lgn-fondo input:-webkit-autofill,
    .lgn-fondo input:-webkit-autofill:hover,
    .lgn-fondo input:-webkit-autofill:focus,
    .lgn-fondo input:-webkit-autofill:active{
        -webkit-text-fill-color:var(--content);
        caret-color:var(--content);
        -webkit-box-shadow:0 0 0 1000px var(--lgn-campo-solido) inset;
        box-shadow:0 0 0 1000px var(--lgn-campo-solido) inset;
        transition:background-color 9999s ease-in-out 0s;
    }
    @keyframes scan-ln{0%{top:10%}50%{top:88%}100%{top:10%}}
    @keyframes scannerReveal{from{opacity:0;transform:scaleY(0.72) translateY(-12px);filter:blur(6px);transform-origin:top center;}to{opacity:1;transform:scaleY(1) translateY(0);filter:blur(0);transform-origin:top center;}}
`;

/* ─── Static sub-components (fuera del render: no se remontan) ──────────── */

/* `AmbientBG` se retiró el 2026-08-06, a pedido del usuario.
   Eran NUEVE capas animadas para siempre sobre la primera pantalla del portal,
   propias del login y encima de las que ya pone `GlobalBackground`: tres globos
   de 80vw/70vw/50vw con `filter: blur(44–52px)` y seis burbujas blancas con
   `backdrop-filter: blur(8px)`.

   Las seis chicas son las caras. Un `backdrop-filter` que se MUEVE obliga al
   compositor a re-muestrear y volver a desenfocar el fondo de abajo en cada
   cuadro, y estaban en animación infinita: seis regiones de blur recalculándose
   sin parar en la pantalla que todos ven antes de poder hacer nada.

   Las bolas moradas y verdes del fondo NO son estas: esas vienen de
   `GlobalBackground` (`App.jsx`), son parte del material Liquid Glass y se
   quedan. Lo que se fue es la capa que el login sumaba encima. El degradado
   radial del contenedor sigue pintando el fondo entero, así que no queda hueco
   — se va el movimiento, no el color. */

const GlassButton = ({ type = 'submit', onClick, disabled, children, height = 'h-[54px]' }) => (
    <button type={type} onClick={onClick} disabled={disabled}
        className={`relative overflow-hidden group w-full ${height}
            bg-gradient-to-b from-brand/72 to-brand-hover/78
            backdrop-blur-xl
            border border-border-card hover:border-border-card
            text-white rounded-3xl font-black text-body uppercase tracking-widest
            shadow-[var(--shadow-glass-2)]
            hover:shadow-[var(--shadow-glass-4)]
            flex items-center justify-center gap-2 transition-all duration-[var(--dur-base)]
            active:scale-[0.97] disabled:opacity-55 disabled:shadow-none disabled:cursor-not-allowed`}>
        <span className="absolute inset-0 overflow-hidden rounded-3xl pointer-events-none">
        </span>
        {children}
    </button>
);

const CameraScanner = ({ videoRef, compact }) => (
    <div style={{ animation: 'scannerReveal 450ms var(--ease-spring) both' }} className="flex flex-col gap-2.5">
        <div className="relative w-full overflow-hidden border border-white/[0.14] shadow-[var(--shadow-glass-5)]"
            style={{ height: compact ? 156 : 224, borderRadius: '1.5rem' }}>
            <div className="absolute inset-0 bg-slate-950/65 backdrop-blur-sm" />
            <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" autoPlay playsInline muted />
            <div style={{ position:'absolute', left:'8%', right:'8%', height:'2px', background:'linear-gradient(90deg, transparent, rgba(0,82,204,0.95), transparent)', animation:'scan-ln 2s ease-in-out infinite', zIndex:10, boxShadow:'0 0 18px rgba(0,82,204,0.75), 0 0 50px rgba(0,82,204,0.25)' }} />
            {[
                { top:14, left:14, bTop:'2.5px solid rgba(0,82,204,0.90)', bLeft:'2.5px solid rgba(0,82,204,0.90)', br:'5px 0 0 0' },
                { top:14, right:14, bTop:'2.5px solid rgba(0,82,204,0.90)', bRight:'2.5px solid rgba(0,82,204,0.90)', br:'0 5px 0 0' },
                { bottom:14, left:14, bBottom:'2.5px solid rgba(0,82,204,0.90)', bLeft:'2.5px solid rgba(0,82,204,0.90)', br:'0 0 0 5px' },
                { bottom:14, right:14, bBottom:'2.5px solid rgba(0,82,204,0.90)', bRight:'2.5px solid rgba(0,82,204,0.90)', br:'0 0 5px 0' },
            ].map((c,i) => (
                <div key={i} style={{ position:'absolute', top:c.top, left:c.left, right:c.right, bottom:c.bottom, width:26, height:26, borderTop:c.bTop, borderLeft:c.bLeft, borderRight:c.bRight, borderBottom:c.bBottom, borderRadius:c.br, zIndex:11, filter:'drop-shadow(0 0 5px rgba(0,82,204,0.55))' }} />
            ))}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 border border-border-card rounded-xl"
                style={{ width:'62%', height:'52%' }} />
            <div style={{ position:'absolute', inset:0, borderRadius:'1.5rem', background:'radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.35) 100%)', pointerEvents:'none' }} />
            <div style={{ position:'absolute', inset:0, borderRadius:'1.5rem', border:'1px solid rgba(255,255,255,0.07)', boxShadow:'inset 0 0 32px rgba(0,0,0,0.30)', pointerEvents:'none' }} />
        </div>
        <div className="flex items-center gap-2.5 px-4 py-2.5 bg-white/[0.22] backdrop-blur-xl border border-border-card rounded-2xl shadow-[var(--shadow-glass-1)]">
            <div className="relative shrink-0">
                <div className="w-2 h-2 rounded-full bg-brand" />
                <div className="absolute inset-0 rounded-full bg-brand/40 animate-ping" />
            </div>
            <p className="text-caption font-black uppercase tracking-widest text-content-2">Apunta la cámara al código de barras</p>
        </div>
    </div>
);

/* ─── LoginView ─────────────────────────────────────────────────────────── */

const LoginView = ({ setView, setActiveEmployee }) => {
    const { login, loginWithUsername, hasPermission, user, completePasswordChange } = useAuth();

    const [isLoading,         setIsLoading]         = useState(false);
    const [error,             setError]             = useState('');
    const [scanFeedback,      setScanFeedback]      = useState(null);
    const [formEngaged,       setFormEngaged]       = useState(false);
    const [cameraActive,      setCameraActive]      = useState(false);
    const [mounted,           setMounted]           = useState(false);
    const [leaving,           setLeaving]           = useState(false);
    const [newPassword,       setNewPassword]       = useState('');
    const [confirmPassword,   setConfirmPassword]   = useState('');
    const [changePassError,   setChangePassError]   = useState('');
    const [changePassLoading, setChangePassLoading] = useState(false);
    const [mustChangePwd,     setMustChangePwd]     = useState(false);
    const [pendingUserLocal,  setPendingUserLocal]  = useState(null);
    const [scanHoldLeft,      setScanHoldLeft]      = useState(SCAN_FOCUS_WAIT_MS / 1000);
    const [hasCamera,         setHasCamera]         = useState(false);
    // Equipo con lector: manda el cartel, la espera de 30s y hasta si el
    // bloque del lector se dibuja. Es estado y no una constante porque el
    // primer escaneo de un equipo nuevo lo enciende en vivo.
    const [conLector,         setConLector]         = useState(hayLector);
    const [scanHold,          setScanHold]          = useState(() => hayLector());
    const enMovil = isMobileOrApp();

    // Las tres preguntas de pantalla, todas por `matchMedia` y no por
    // `window.innerWidth` leído en el render: así el login se reacomoda solo al
    // cambiar de monitor, al girar la tablet o al mover la ventana, sin quedar
    // clavado en la medida que había al montar.
    const esAngosto = useMediaQuery('(max-width: 1023px)');
    const esBaja    = useMediaQuery('(max-height: 820px)');
    const modoOscuro = useMediaQuery('(prefers-color-scheme: dark)');

    const usernameRef     = useRef(null);
    const userPasswordRef = useRef(null);
    const videoRef        = useRef(null);
    const scannerRef      = useRef(null);
    const streamRef       = useRef(null);
    const cooldownRef     = useRef(false);
    const busyRef         = useRef(false);
    const scanBufRef      = useRef('');
    const scanLastKeyRef  = useRef(0);
    const tiemposRef      = useRef([]);   // marcas de tiempo de la ráfaga global
    const scanHoldTimeoutRef  = useRef(null);
    const scanHoldIntervalRef = useRef(null);

    useEffect(() => {
        const t = setTimeout(() => setMounted(true), 60);
        return () => clearTimeout(t);
    }, []);

    // ── Tema del login: claro u oscuro según el SISTEMA (2026-08-16) ─────
    // Antes esta vista era siempre clara, pasara lo que pasara. Ahora sigue
    // el modo del sistema operativo, que es lo único que existe ANTES de que
    // haya sesión: el tema del portal es una preferencia del empleado y vive
    // en su perfil, o sea del otro lado del login.
    // Son sólo dos estados a propósito (claro/oscuro), no los cuatro temas:
    // acá no hay quién haya elegido «sólido» ni «líquido».
    // El valor real de <html> se guarda al montar y se devuelve al salir —
    // como el kiosco, que fuerza `dark` mientras vive.
    const temaPrevioRef = useRef(null);
    useEffect(() => {
        const root = document.documentElement;
        temaPrevioRef.current = root.getAttribute('data-theme');
        const meta = document.querySelector('meta[name="theme-color"]');
        const colorPrevio = meta?.content;
        return () => {
            if (temaPrevioRef.current) root.setAttribute('data-theme', temaPrevioRef.current);
            else root.removeAttribute('data-theme');
            if (meta && colorPrevio) meta.content = colorPrevio;
        };
    }, []);

    // Efecto aparte del de arriba: éste se re-ejecuta si el sistema cambia de
    // claro a oscuro con el login abierto. Si guardara/restaurara el tema
    // previo, la segunda corrida guardaría el valor que puso la primera.
    useEffect(() => {
        const root = document.documentElement;
        if (modoOscuro) root.setAttribute('data-theme', 'dark');
        else root.removeAttribute('data-theme');
        const meta = document.querySelector('meta[name="theme-color"]');
        // Mismos valores que THEME_COLOR_MAP de ThemeContext (liquid / dark).
        if (meta) meta.content = modoOscuro ? '#130d35' : '#e2defc';
    }, [modoOscuro]);

    // Solo mostrar el botón de cámara si el dispositivo tiene una.
    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                if (!navigator.mediaDevices?.enumerateDevices) return;
                const devices = await navigator.mediaDevices.enumerateDevices();
                if (alive) setHasCamera(devices.some(d => d.kind === 'videoinput'));
            } catch { /* API no disponible → botón oculto */ }
        })();
        return () => { alive = false; };
    }, []);

    const endScanHold = useCallback(() => {
        clearTimeout(scanHoldTimeoutRef.current);
        clearInterval(scanHoldIntervalRef.current);
        setScanHold(false);
    }, []);

    // Prioridad inicial del lector: durante los primeros 30s nada tiene foco
    // (el navegador/gestor de contraseñas suele enfocar el primer input — se
    // libera); si no hubo login al vencer, el foco pasa a usuario.
    // En un equipo SIN lector no hay nada que esperar: el foco va derecho al
    // usuario y no se le quita a nadie.
    // Soltar el foco corre UNA vez, al montar, y sólo si hay lector: es para
    // el navegador o el gestor de contraseñas, que enfocan el primer campo
    // solos. Si quien lo enfocó fue una PERSONA —alcanzó a hacer clic dentro
    // de esos 50ms—, quitárselo le manda las teclas al lector global y el
    // campo se queda vacío sin que se entienda por qué. Lo destapó la prueba
    // de Playwright, que hace exactamente eso: cliquea apenas aparece.
    useEffect(() => {
        if (!conLector) return undefined;
        const tocado = { por_persona: false };
        const marcar = () => { tocado.por_persona = true; };
        window.addEventListener('pointerdown', marcar, true);
        const blurT = setTimeout(() => {
            if (tocado.por_persona) return;
            const ae = document.activeElement;
            if (ae === usernameRef.current || ae === userPasswordRef.current) ae.blur();
        }, 50);
        return () => { window.removeEventListener('pointerdown', marcar, true); clearTimeout(blurT); };
        // Sólo al montar: si un escaneo enciende `conLector` más tarde, robarle
        // el foco a quien está escribiendo sería peor que no hacer nada.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        // Sin lector no hay nada que esperar: el foco va derecho al usuario.
        if (!conLector) {
            setScanHold(false);
            const t = setTimeout(() => { if (!busyRef.current) usernameRef.current?.focus(); }, 60);
            return () => clearTimeout(t);
        }
        const start = Date.now();
        scanHoldIntervalRef.current = setInterval(() => {
            setScanHoldLeft(Math.max(0, Math.ceil((SCAN_FOCUS_WAIT_MS - (Date.now() - start)) / 1000)));
        }, 250);
        scanHoldTimeoutRef.current = setTimeout(() => {
            endScanHold();
            if (!busyRef.current) usernameRef.current?.focus();
        }, SCAN_FOCUS_WAIT_MS);
        return () => {
            clearTimeout(scanHoldTimeoutRef.current);
            clearInterval(scanHoldIntervalRef.current);
        };
    }, [conLector, endScanHold]);

    useEffect(() => {
        if (user) { if (hasPermission('staff_list', 'can_view') || hasPermission('overview', 'can_view')) setView('dashboard'); else { setActiveEmployee(user); setView('employee-detail'); } }
    }, [user, hasPermission, setView, setActiveEmployee]);

    useEffect(() => {
        if (error) { const t = setTimeout(() => setError(''), 4000); return () => clearTimeout(t); }
    }, [error]);

    /* ── Scan login (lector físico o cámara) ─────────────────────────────── */

    const handleScanLogin = async (rawCode) => {
        if (busyRef.current || mustChangePwd) return false;
        const code = String(rawCode ?? '').trim().toUpperCase();
        if (!code) return false;
        busyRef.current = true;
        endScanHold();
        setError('');
        // El código leído NO se guarda en el estado: la pantalla de login es
        // pública y llegó a mostrarlo en pantalla. Sólo viaja a `login()`.
        setScanFeedback({ status: 'reading', message: 'Verificando...' });
        setIsLoading(true);
        try {
            const result = await login(code);
            if (!result.ok) {
                setScanFeedback({ status: 'error', message: result.error || 'Carné no reconocido.' });
                setTimeout(() => setScanFeedback(cur => (cur?.status === 'error' ? null : cur)), 2500);
                return false;
            }
            setScanFeedback({ status: 'success', message: '¡Acceso concedido!' });
            return true;
        } catch {
            setScanFeedback({ status: 'error', message: 'Error de conexión' });
            setTimeout(() => setScanFeedback(cur => (cur?.status === 'error' ? null : cur)), 2500);
            return false;
        } finally {
            setIsLoading(false);
            busyRef.current = false;
        }
    };
    const handleScanLoginRef = useRef(handleScanLogin);
    handleScanLoginRef.current = handleScanLogin;

    // Captura global: el lector siempre está activo mientras el foco NO esté en un
    // input (si el usuario escribe usuario/contraseña, las teclas van al campo).
    //
    // Y se exige VELOCIDAD DE LECTOR, no sólo que termine en Enter (corregido
    // el 2026-08-16, a pedido del usuario: «cualquiera puede escribir un
    // código»). Sin eso, el carné —que es la contraseña— se podía teclear a
    // mano: alcanzaba con saberse el código de un compañero, escribirlo con la
    // pantalla de login enfocada y apretar Enter para entrar como esa persona.
    // El kiosco ya rechazaba el tecleo manual con esta misma medida
    // (`detectInputMethod`); el login era la puerta que quedaba abierta.
    useEffect(() => {
        const onKeyDown = (e) => {
            if (!e.isTrusted) return;   // ver la nota de `vigilarRafaga`
            const t = e.target;
            if (t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
            const now = Date.now();
            if (now - scanLastKeyRef.current > SCAN_KEY_GAP_MS) { scanBufRef.current = ''; tiemposRef.current = []; }
            scanLastKeyRef.current = now;
            if (e.key === 'Enter') {
                const code = scanBufRef.current.trim();
                const tiempos = tiemposRef.current;
                scanBufRef.current = '';
                tiemposRef.current = [];
                if (code.length < SCAN_MIN_LENGTH) return;
                e.preventDefault();
                if (!esVelocidadDeLector(tiempos)) {
                    // Tecleado a mano. No se dice «muy lento» ni se muestra
                    // nada del código: sólo que esto se lee con el lector.
                    setError('El carné se lee con el lector. Para entrar a mano, usa tu usuario y contraseña.');
                    usernameRef.current?.focus();
                    return;
                }
                recordarLector();
                setConLector(true);
                handleScanLoginRef.current(code);
            } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                scanBufRef.current += e.key;
                tiemposRef.current.push(now);
            }
        };
        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
    }, []);

    /* ── Cámara (scan por video) ─────────────────────────────────────────── */

    const stopCameraSafely = () => {
        if (scannerRef.current) { try { scannerRef.current.reset(); } catch { /* best-effort teardown */ } scannerRef.current = null; }
        if (streamRef.current)  { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
        if (videoRef.current?.srcObject) {
            try { videoRef.current.srcObject.getTracks().forEach(t => t.stop()); videoRef.current.srcObject = null; videoRef.current.src = ''; videoRef.current.removeAttribute('src'); } catch { /* best-effort teardown */ }
        }
    };
    useEffect(() => () => stopCameraSafely(), []);

    useEffect(() => {
        if (!cameraActive) return;
        let cancelled = false, isWarmup = true;
        const warmupTimer = setTimeout(() => { isWarmup = false; }, 500);
        (async () => {
            try {
                const { BrowserMultiFormatReader } = await import('@zxing/browser');
                const { DecodeHintType, BarcodeFormat }  = await import('@zxing/library');
                if (cancelled) return;
                const hints = new Map();
                hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.CODE_93, BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.QR_CODE]);
                hints.set(DecodeHintType.TRY_HARDER, true);
                const codeReader = new BrowserMultiFormatReader(hints);
                scannerRef.current = codeReader;
                await new Promise(r => setTimeout(r, 300));
                if (cancelled || !videoRef.current) return;
                cooldownRef.current = false;
                await codeReader.decodeFromVideoDevice(undefined, videoRef.current, async (result) => {
                    if (!result || cooldownRef.current || isWarmup || cancelled) return;
                    cooldownRef.current = true;
                    const scannedCode = result.getText().trim().toUpperCase();
                    if (videoRef.current?.srcObject) streamRef.current = videoRef.current.srcObject;
                    stopCameraSafely();
                    setCameraActive(false);
                    handleScanLoginRef.current(scannedCode);
                });
            } catch { if (!cancelled) { stopCameraSafely(); setCameraActive(false); setError('No se pudo acceder a la cámara. Verifica los permisos.'); } }
        })();
        return () => { cancelled = true; clearTimeout(warmupTimer); stopCameraSafely(); };
    }, [cameraActive]);

    const toggleCamera = () => {
        if (cameraActive) { cooldownRef.current = false; stopCameraSafely(); setCameraActive(false); }
        else { endScanHold(); setScanFeedback(null); cooldownRef.current = false; setCameraActive(true); }
    };

    /* ── Estado "lector en pausa" cuando el usuario usa el formulario ────── */

    const syncFormEngaged = useCallback(() => {
        // Diferido: tras blur/focus, activeElement recién queda actualizado.
        setTimeout(() => {
            const ae = document.activeElement;
            const focused = ae === usernameRef.current || ae === userPasswordRef.current;
            const hasText = !!(usernameRef.current?.value || userPasswordRef.current?.value);
            setFormEngaged(focused || hasText);
            if (focused || hasText) endScanHold();
        }, 0);
    }, [endScanHold]);

    /* ── El lector, cuando dispara con el foco DENTRO de un campo ────────── */

    // `prefijo` es lo que el usuario ya tenía escrito antes de la ráfaga: se
    // conserva para no borrarle su texto, y para poder devolvérselo entero si
    // resulta que no era un lector sino un tecleo veloz.
    const rafagaRef = useRef({ activa: false, buf: '', prefijo: '', teclas: 0, ultima: 0, campo: null, timer: null });

    const olvidarRafaga = useCallback(() => {
        const r = rafagaRef.current;
        clearTimeout(r.timer);
        r.activa = false; r.buf = ''; r.prefijo = ''; r.teclas = 0; r.campo = null; r.timer = null;
    }, []);

    // Falso positivo: alguien tecleando muy rápido. Se le devuelve el texto.
    const devolverRafaga = useCallback(() => {
        const r = rafagaRef.current;
        if (r.activa && r.campo) r.campo.value = r.prefijo + r.buf;
        olvidarRafaga();
        syncFormEngaged();
    }, [olvidarRafaga, syncFormEngaged]);

    const cobrarRafagaComoEscaneo = useCallback(() => {
        const r = rafagaRef.current;
        const codigo = r.buf;
        if (r.campo) r.campo.value = r.prefijo;   // el código NO se muestra
        olvidarRafaga();
        syncFormEngaged();
        if (codigo.length < SCAN_MIN_LENGTH) return;
        // Este equipo tiene lector: quedó demostrado recién.
        recordarLector();
        setConLector(true);
        handleScanLoginRef.current(codigo);
    }, [olvidarRafaga, syncFormEngaged]);

    const vigilarRafaga = (e) => {
        // Un lector es hardware: sus teclas llegan `isTrusted`. Las de un
        // gestor de contraseñas que RELLENA tecleando, no — y ésas hay que
        // dejarlas pasar enteras, o el gestor escribe la contraseña y el
        // detector se la come creyendo que es un carné.
        if (!e.isTrusted) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const r = rafagaRef.current;
        const campo = e.currentTarget;

        if (e.key === 'Enter') {
            // Enter del lector: el submit del formulario no llega a correr —
            // mandar el carné como contraseña sólo produce un error inútil.
            if (r.activa) { e.preventDefault(); cobrarRafagaComoEscaneo(); }
            return;
        }
        if (e.key.length !== 1) return;   // Shift, Tab, flechas, Backspace…

        const ahora  = Date.now();
        const hueco  = ahora - r.ultima;
        r.ultima = ahora;

        if (hueco > RAFAGA_GAP_MS || r.campo !== campo) {
            if (r.activa) devolverRafaga();   // el hueco humano deshace la sospecha
            const rr = rafagaRef.current;
            // `prefijo` se toma ACÁ, en la primera tecla de la posible ráfaga:
            // es el texto que el usuario ya tenía escrito, todavía sin ella.
            // Calcularlo después restando teclas no sirve — en `keydown` el
            // carácter aún no se insertó, y cuánto alcanzó a pintarse depende
            // de la carrera entre el lector y el navegador (medido: dejaba
            // «an» de «ana»).
            rr.prefijo = campo.value;
            rr.buf = e.key; rr.teclas = 1; rr.campo = campo; rr.activa = false; rr.ultima = ahora;
            return;
        }

        r.buf += e.key;
        r.teclas += 1;
        if (r.teclas < RAFAGA_MIN_TECLAS) return;

        if (!r.activa) {
            r.activa = true;
            // Lo que la ráfaga alcanzó a pintar desaparece; lo que el usuario
            // tenía escrito antes se respeta.
            campo.value = r.prefijo;
            syncFormEngaged();
        }
        e.preventDefault();               // el resto del código ya no llega al campo
        clearTimeout(r.timer);
        r.timer = setTimeout(() => { if (rafagaRef.current.activa) cobrarRafagaComoEscaneo(); }, RAFAGA_ESPERA_ENTER_MS);
    };

    useEffect(() => () => clearTimeout(rafagaRef.current.timer), []);

    // Pegar en usuario o contraseña queda prohibido (a pedido del usuario,
    // 2026-08-16): una credencial que viaja por el portapapeles queda ahí,
    // legible para cualquier otra app y para el siguiente que se siente.
    //
    // Pero SÓLO el pegado de una persona. `isTrusted` es la diferencia: lo que
    // viene de un Ctrl+V real llega en `true`, y lo que dispara una extensión
    // —un gestor de contraseñas rellenando el formulario— llega en `false`.
    // Sin esa distinción el bloqueo se lleva puesto al gestor: el usuario
    // reportó el 2026-08-16 que el campo de contraseña quedaba vacío y el
    // login devolvía error. Un candado que impide entrar no es un candado.
    const bloquearPegado = (e) => {
        if (!e.isTrusted) return;              // relleno del gestor: pasa
        e.preventDefault();
        setError('Por seguridad, escribe tus datos: aquí no se pega.');
    };

    /* ── Login usuario/contraseña ────────────────────────────────────────── */

    const handleUsernameLogin = async (e) => {
        e.preventDefault(); setError('');
        const username = usernameRef.current?.value?.trim() || '';
        const password = userPasswordRef.current?.value || '';
        if (!username || !password) { setError('Ingresa usuario y contraseña.'); return; }
        setIsLoading(true);
        try {
            const result = await loginWithUsername(username, password);
            if (!result.ok) { setError(result.error || 'Credenciales inválidas.'); setIsLoading(false); if (userPasswordRef.current) userPasswordRef.current.value = ''; userPasswordRef.current?.focus(); }
            else if (result.mustChangePassword) { setPendingUserLocal(result.user); setMustChangePwd(true); setIsLoading(false); }
            else { setIsLoading(false); }
        } catch { setError('Error de conexión. Intenta de nuevo.'); setIsLoading(false); }
    };

    const handleChangePassword = async () => {
        setChangePassError('');
        if (newPassword.length < 8)              { setChangePassError('Mínimo 8 caracteres.'); return; }
        if (!/[A-Z]/.test(newPassword))          { setChangePassError('Debe incluir al menos una mayúscula.'); return; }
        if (!/[0-9]/.test(newPassword))          { setChangePassError('Debe incluir al menos un número.'); return; }
        if (newPassword !== confirmPassword)      { setChangePassError('Las contraseñas no coinciden.'); return; }
        setChangePassLoading(true);
        try {
            const { error } = await supabase.auth.updateUser({ password: newPassword, data: { must_change_password: false } });
            if (error) { setChangePassError(mensajeAmigable(error)); setChangePassLoading(false); return; }
            completePasswordChange(pendingUserLocal); setMustChangePwd(false); setPendingUserLocal(null); setNewPassword(''); setConfirmPassword('');
        } catch { setChangePassError('Error de conexión. Intenta de nuevo.'); }
        setChangePassLoading(false);
    };

    const goToKiosko = () => {
        setLeaving(true);
        setTimeout(() => setView('timeclock'), 320);
    };

    /* ── Widgets (funciones que devuelven JSX inline: sin remounts) ──────── */

    const renderScanWidget = (compact) => {
        const st     = scanFeedback?.status; // 'reading' | 'success' | 'error' | undefined
        // Sin lector no hay «pausa» ni «activo» que anunciar: el bloque queda
        // como lo que es, el botón de escanear con la cámara.
        const paused = conLector && formEngaged && !st && !isLoading && !cameraActive;
        const active = conLector && !paused && !st && !isLoading && !cameraActive;

        return (
            <div className="flex flex-col gap-2.5">
                <div className={[
                    'flex items-center gap-3 px-4 rounded-3xl border backdrop-blur-md transition-all duration-[var(--dur-slow)]',
                    compact ? 'py-2.5' : 'py-3',
                    st === 'error'   ? 'bg-danger/10 border-danger/30' :
                    st === 'success' ? 'bg-success/10 border-success/30' :
                    paused           ? 'bg-white/[0.14] border-border-card' :
                                       'bg-brand/[0.05] border-brand/25 shadow-[var(--shadow-shine)]',
                ].join(' ')}>
                    <div className={[
                        'relative shrink-0 flex items-center justify-center rounded-2xl border transition-all duration-[var(--dur-slow)]',
                        compact ? 'w-10 h-10' : 'w-11 h-11',
                        st === 'error'   ? 'bg-danger/10 border-danger/30' :
                        st === 'success' ? 'bg-success/10 border-success/30' :
                        paused           ? 'bg-surface-card border-border-card' :
                                           'bg-surface-card border-border-card shadow-[var(--shadow-shine)]',
                    ].join(' ')}>
                        {st === 'reading' || isLoading
                            ? <Loader2 size={compact?17:19} className="text-brand-text animate-spin" strokeWidth={2} />
                            : st === 'success'
                                ? <CheckCircle2 size={compact?17:19} className="text-success" strokeWidth={2} />
                                : st === 'error'
                                    ? <AlertCircle size={compact?17:19} className="text-danger" strokeWidth={2} />
                                    : <ScanBarcode size={compact?17:19} className={paused || cameraActive ? 'text-content-3' : 'text-brand-text'} strokeWidth={2} />}
                        {active && (
                            <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand/50" />
                                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-brand border border-border-card" />
                            </span>
                        )}
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                        {scanFeedback ? (
                            <>
                                <p className="text-micro font-black uppercase tracking-widest text-content-3 truncate">Lector de carné</p>
                                <p className={`text-body-sm font-bold truncate ${st==='error'?'text-danger':st==='success'?'text-success':'text-brand-text'}`}>{scanFeedback.message}</p>
                            </>
                        ) : cameraActive ? (
                            <>
                                <p className="text-label font-black uppercase tracking-widest text-content-2">Cámara activa</p>
                                <p className="text-micro font-bold text-content-3 uppercase tracking-wide mt-0.5">Escaneando con la cámara</p>
                            </>
                        ) : paused ? (
                            <>
                                <p className="text-label font-black uppercase tracking-widest text-content-2">Lector en pausa</p>
                                <p className="text-micro font-bold text-content-3 uppercase tracking-wide mt-0.5">Toca fuera de los campos para reactivar</p>
                            </>
                        ) : conLector ? (
                            <>
                                <p className="text-label font-black uppercase tracking-widest text-brand-text">Lector activo</p>
                                <p className="text-micro font-bold text-content-3 uppercase tracking-wide mt-0.5">
                                    {scanHold ? `Escanea tu carné · usuario en ${scanHoldLeft}s` : 'Escanea tu carné para entrar'}
                                </p>
                            </>
                        ) : (
                            <>
                                <p className="text-label font-black uppercase tracking-widest text-content-2">Escanear carné</p>
                                <p className="text-micro font-bold text-content-3 uppercase tracking-wide mt-0.5">Con la cámara de este equipo</p>
                            </>
                        )}
                    </div>
                    {hasCamera && (
                        <button
                            type="button"
                            aria-pressed={cameraActive}
                            onClick={toggleCamera}
                            title={cameraActive ? 'Cerrar cámara' : 'Escanear con cámara'}
                            className={[
                                // `.blanco-tactil` y no un `min-w`: en compacto
                                // este botón mide 40 porque tiene que caber al
                                // lado del lector sin descuadrar la fila — el
                                // tamaño ES el diseño. Lo que crece es el ÁREA,
                                // con el pseudo-elemento canónico, y sólo en
                                // punteros gruesos. Necesita `relative`.
                                'relative blanco-tactil',
                                'shrink-0 flex items-center justify-center rounded-2xl border backdrop-blur-md',
                                'transition-all duration-[var(--dur-slow)] active:scale-[0.93]',
                                compact ? 'w-10 h-10' : 'w-11 h-11',
                                cameraActive
                                    ? 'bg-danger/[0.15] border-danger/45 text-danger shadow-[var(--shadow-shine)] hover:bg-danger/[0.25]'
                                    : 'bg-white/[0.28] border-border-card text-content-3 shadow-[var(--shadow-shine)] hover:bg-white/[0.55] hover:border-border-card hover:text-brand-text',
                            ].join(' ')}
                        >
                            {cameraActive
                                ? <X size={compact ? 15 : 17} strokeWidth={2.5} />
                                : <Camera size={compact ? 16 : 18} strokeWidth={2} />}
                        </button>
                    )}
                </div>
                {cameraActive && <CameraScanner videoRef={videoRef} compact={compact} />}
            </div>
        );
    };

    // Qué se ofrece además de usuario/contraseña:
    //   · En teléfono o en la app: NADA. Nadie escanea un carné con el
    //     teléfono del portal y el kiosco ya está oculto ahí — la pantalla
    //     queda con los dos campos y nada más (2026-08-16, a pedido del
    //     usuario).
    //   · En un equipo con lector: el bloque completo.
    //   · En un equipo sin lector pero con cámara: sólo el botón de cámara,
    //     sin cartel de «lector activo» ni cuenta regresiva. Pedir un escaneo
    //     que nadie puede hacer no es una opción, es un estorbo.
    const mostrarEscaneo = !enMovil && (conLector || hasCamera);

    const renderLoginForm = (compact) => (
        <div className={`flex flex-col ${compact ? 'gap-3' : 'gap-4'}`}>
            {mostrarEscaneo && renderScanWidget(compact)}

            {mostrarEscaneo && (
            <div className="relative flex items-center gap-3 px-1">
                <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[var(--lgn-linea)] to-[var(--lgn-linea)]" />
                <span className="text-micro font-black uppercase tracking-widest text-content-3 shrink-0">o con tu usuario</span>
                <div className="flex-1 h-px bg-gradient-to-l from-transparent via-[var(--lgn-linea)] to-[var(--lgn-linea)]" />
            </div>
            )}

            <form onSubmit={handleUsernameLogin} className={`flex flex-col ${compact ? 'gap-3' : 'gap-4'}`}>
                {[
                    { ref: usernameRef,     id: 'username', type: 'text',     placeholder: 'nombre.apellido', autoComplete: 'username',         Icon: UserIcon },
                    { ref: userPasswordRef, id: 'password', type: 'password', placeholder: 'Contraseña',      autoComplete: 'current-password', Icon: Lock },
                ].map(({ ref, id, type, placeholder, autoComplete, Icon }) => (
                    <div key={id} className="relative group flex items-center">
                        <Icon size={compact?16:18} strokeWidth={2} className="absolute left-4 text-content-3 group-focus-within:text-brand-text transition-colors pointer-events-none z-base" />
                        <input aria-label={placeholder} ref={ref} id={id} name={id} type={type} placeholder={placeholder}
                            autoComplete={autoComplete}
                            spellCheck="false"
                            onFocus={syncFormEngaged} onBlur={syncFormEngaged} onInput={syncFormEngaged}
                            onKeyDown={vigilarRafaga}
                            onPaste={bloquearPegado} onDrop={bloquearPegado} onDragOver={e => e.preventDefault()}
                            // Copiar y cortar sólo se bloquean en la contraseña:
                            // el usuario es un dato público (sale en la lista de
                            // personal), la contraseña no.
                            onCopy={id === 'password' ? (e => e.preventDefault()) : undefined}
                            onCut={id === 'password' ? (e => e.preventDefault()) : undefined}
                            className={`${inputCls} ${compact?'pl-11 pr-4 py-3 text-body-xl':'pl-12 pr-5 py-4 text-body-xl'} rounded-3xl`} />
                    </div>
                ))}
                {error && (
                    <div className="animate-in fade-in slide-in-from-top-1 duration-[var(--dur-base)] px-4 py-3 bg-danger/10 backdrop-blur-md border border-danger/30 rounded-2xl flex items-center gap-3">
                        <AlertCircle size={15} className="text-danger shrink-0" strokeWidth={2.5} />
                        <p className="text-danger text-caption font-black uppercase tracking-widest">{error}</p>
                    </div>
                )}
                <GlassButton height={compact ? 'h-[46px]' : 'h-[54px]'} disabled={isLoading}>
                    {isLoading
                        ? <Loader2 size={compact?16:20} className="animate-spin" />
                        : 'Ingresar al Portal'}
                </GlassButton>
            </form>
        </div>
    );

    /* ══════════════════════════════════════════════════════
       CHANGE PASSWORD SCREEN
    ══════════════════════════════════════════════════════ */
    if (mustChangePwd) {
        return (
            // `items-start` + `my-auto` en la tarjeta, y NO `items-center`: con
            // centrado flex, una tarjeta más alta que la ventana desborda por
            // los DOS lados y el tramo de arriba queda fuera del área
            // scrolleable. Es la misma receta que ModalShell.jsx (2026-08-15).
            <div className="lgn-fondo relative flex items-start justify-center w-full h-[100dvh] overflow-y-auto overflow-x-hidden px-5 py-8"
                style={{ background:'var(--lgn-bg)' }}>
                <style>{keyframeStyles}</style>
                <div className={`relative z-base w-full max-w-[420px] my-auto transition-all duration-[var(--dur-lento)] ease-[var(--ease-spring)] ${mounted?'opacity-100 translate-y-0 scale-100':'opacity-0 translate-y-6 scale-[0.96]'}`}>
                    <div className="rounded-header p-8 [@media(max-height:820px)]:p-6 bg-[var(--lgn-vidrio)] backdrop-blur-[48px] backdrop-saturate-[200%] border border-[var(--lgn-vidrio-borde)] shadow-[var(--shadow-glass-5)] flex flex-col gap-6 [@media(max-height:820px)]:gap-4">
                        <div className="absolute inset-0 bg-gradient-to-b from-[var(--lgn-brillo)] to-transparent pointer-events-none rounded-header" />
                        <div className="relative flex flex-col items-center gap-3">
                            <div className="w-14 h-14 rounded-2xl bg-warning/10 border border-warning/40 flex items-center justify-center shadow-[var(--shadow-shine)]">
                                <Lock size={22} className="text-warning" strokeWidth={2} />
                            </div>
                            <h3 className="text-title-lg font-black text-content tracking-tight text-center">Cambia tu contraseña</h3>
                            <p className="text-caption font-bold text-content-3 uppercase tracking-widest text-center">Primer acceso — establece una contraseña personal</p>
                        </div>
                        <form id="cpf" onSubmit={e=>{e.preventDefault();handleChangePassword();}} className="relative flex flex-col gap-3">
                            {[{ph:'Nueva contraseña (mín. 8 caracteres)',v:newPassword,s:e=>{setNewPassword(e.target.value);setChangePassError('');}},{ph:'Confirmar contraseña',v:confirmPassword,s:e=>{setConfirmPassword(e.target.value);setChangePassError('');}}].map((f,i)=>(
                                <div key={i} className="relative group flex items-center">
                                    <Lock size={15} strokeWidth={2.5} className="absolute left-4 text-content-3 group-focus-within:text-brand-text transition-colors pointer-events-none z-base" />
                                    <input aria-label={f.ph} type="password" placeholder={f.ph} value={f.v} onChange={f.s} className={`${inputCls} pl-11 pr-4 py-3.5 text-body-xl rounded-2xl`} />
                                </div>
                            ))}
                            {changePassError && <div className="flex items-center gap-3 text-danger-text bg-danger/10 backdrop-blur-sm px-4 py-3 rounded-2xl border border-danger/30 shadow-[var(--shadow-glow-danger)] animate-in fade-in slide-in-from-top-2"><AlertCircle size={18} className="text-danger shrink-0" strokeWidth={2.5}/><span className="text-body-sm font-bold leading-relaxed">{changePassError}</span></div>}
                            <GlassButton type="submit" disabled={changePassLoading||!newPassword||!confirmPassword} height="h-[52px]">
                                {changePassLoading?<Loader2 size={18} className="animate-spin"/>:'Guardar contraseña'}
                            </GlassButton>
                        </form>
                    </div>
                </div>
            </div>
        );
    }

    /* ══════════════════════════════════════════════════════
       LAYOUTS (JSX inline vía funciones: sin remounts)
    ══════════════════════════════════════════════════════ */

    const renderMobileLayout = () => (
        <div className="flex flex-col items-center justify-between flex-1 w-full px-5 py-8 [@media(max-height:700px)]:py-4 gap-4 [@media(max-height:700px)]:gap-2">
            <div className={`flex flex-col items-center gap-2 transition-all duration-[var(--dur-lento)] delay-[80ms] ease-[var(--ease-spring)] ${mounted?'opacity-100 translate-y-0':'opacity-0 -translate-y-4'}`}>
                <div className="relative">
                    <div className="absolute -inset-3 rounded-modal blur-xl opacity-40 bg-gradient-to-tr from-chart-3/60 to-chart-1/40" />
                    <div className="relative w-16 h-16 [@media(max-height:700px)]:w-12 [@media(max-height:700px)]:h-12 rounded-3xl bg-[var(--lgn-campo-foco)] backdrop-blur-xl border border-border-card flex items-center justify-center shadow-[var(--shadow-glass-2)]">
                        <img src="/Logo192.png" alt="FarmaLasa" className="w-10 h-10 [@media(max-height:700px)]:w-8 [@media(max-height:700px)]:h-8 object-contain" />
                    </div>
                </div>
                <div className="text-center mt-1">
                    <p className="font-black text-title text-content tracking-tight leading-none">Portal Farmalasa</p>
                    <p className="text-micro font-black text-brand-text/70 uppercase tracking-[0.22em] mt-1">Sistema de Gestión</p>
                </div>
            </div>

            <div className={`relative w-full max-w-[420px] transition-all duration-[var(--dur-lento)] delay-[160ms] ease-[var(--ease-spring)] ${mounted?'opacity-100 scale-100 translate-y-0':'opacity-0 scale-[0.94] translate-y-5'}`}>
                <div className="absolute inset-0 bg-gradient-to-b from-[var(--lgn-brillo)] to-transparent pointer-events-none rounded-header" />
                <div className="rounded-header p-5 [@media(max-height:700px)]:p-3.5 bg-[var(--lgn-vidrio)] backdrop-blur-[48px] backdrop-saturate-[200%] border border-[var(--lgn-vidrio-borde)] shadow-[var(--shadow-glass-5)] flex flex-col gap-4 [@media(max-height:700px)]:gap-2.5">
                    {renderLoginForm(true)}
                    {!isMobileOrApp() && (
                        <>
                            <div className="h-px bg-divider mx-2" />
                            <button type="button" onClick={goToKiosko}
                                className="group w-full p-3 [@media(max-height:700px)]:p-2 rounded-3xl bg-[var(--lgn-boton)] backdrop-blur-md border border-border-card flex items-center justify-between transition-all duration-[var(--dur-base)] active:scale-[0.97] hover:bg-[var(--lgn-boton-hover)] hover:border-border-card hover:shadow-[var(--shadow-elevation-sm)]">
                                <div className="flex items-center gap-3">
                                    <div className="w-9 h-9 rounded-xl bg-surface-card border border-border-card flex items-center justify-center group-hover:bg-surface-card-hover transition-colors shadow-sm">
                                        <Clock size={15} className="text-content-3 group-hover:text-brand-text transition-colors" strokeWidth={2} />
                                    </div>
                                    <div className="text-left">
                                        <p className="text-caption font-black text-content-2 uppercase tracking-widest">Terminal Kiosco</p>
                                        <p className="text-micro font-bold text-content-3 uppercase tracking-[0.1em] mt-0.5">Marcar entrada / salida</p>
                                    </div>
                                </div>
                                <div className="w-7 h-7 rounded-full bg-surface-card border border-border-card flex items-center justify-center group-hover:bg-brand group-hover:border-transparent transition-all duration-[var(--dur-base)]">
                                    <ArrowRight size={12} className="text-content-3 group-hover:text-white transition-colors" strokeWidth={2.5} />
                                </div>
                            </button>
                        </>
                    )}
                </div>
            </div>

            <div className={`flex gap-2 transition-all duration-[var(--dur-lento)] delay-[260ms] ease-[var(--ease-spring)] ${mounted?'opacity-100 translate-y-0':'opacity-0 translate-y-4'}`}>
                {[
                    {href:'https://clientesdte.oss.com.sv/farma_salud/dashboard.php',Icon:ShoppingCart,label:'Ventas',color:'#0052CC'},
                    {href:'https://farmalasa.com',Icon:Pill,label:'FarmaLasa',color:'#6929C4'},
                ].map(({href,Icon,label,color})=>(
                    /* `min-h-[var(--tap-min)]`: con `py-2.5` y `text-caption`
                       estos dos enlaces medían 39px de alto — cinco por debajo
                       del mínimo del dedo, en la única pantalla que todos tocan
                       sí o sí. En escritorio `--tap-min` vale 0 y no cambia
                       nada. Lo encontró la matriz de la fase 5: el barrido de
                       vistas nunca medía el login porque entraba con sesión y
                       `/login` redirigía a la app. */
                    <a key={label} href={href} target="_blank" rel="noopener noreferrer"
                        className="group flex items-center gap-2 px-4 py-2.5 min-h-[var(--tap-min)] bg-[var(--lgn-campo)] hover:bg-[var(--lgn-campo-foco)] backdrop-blur-md border border-border-card hover:border-border-card rounded-2xl transition-all duration-[var(--dur-base)] active:scale-[0.97] hover:scale-[1.03] hover:translate-y-[var(--lift-card)]">
                        <Icon size={14} strokeWidth={2} style={{color}} className="transition-transform duration-[var(--dur-base)] group-hover:scale-110" />
                        <span className="text-caption font-black uppercase tracking-widest text-content-3 group-hover:text-content-2 transition-colors">{label}</span>
                    </a>
                ))}
            </div>
        </div>
    );

    const renderDesktopLayout = () => (
        // `items-start` + `my-auto` en la tarjeta: ver la nota de la pantalla
        // de cambio de contraseña. Con `items-center`, un monitor bajo
        // (1366×768, 1280×720) recortaba el logo y no había forma de subir.
        <div className={`relative flex items-start justify-center w-full flex-1 px-6 ${esBaja ? 'py-5' : 'py-10'}`}>
            <div className={`relative w-full max-w-[480px] my-auto z-base transition-all duration-[var(--dur-lento)] delay-[80ms] ease-[var(--ease-spring)] ${mounted?'opacity-100 scale-100 translate-y-0':'opacity-0 scale-[0.93] translate-y-8'}`}>
                {/* El halo de la tarjeta pesa distinto según el fondo: el mismo
                    18% que apenas se insinúa sobre el degradado claro tiñe de
                    violeta media pantalla sobre el oscuro. */}
                <div className={`absolute -inset-6 rounded-header blur-2xl ${modoOscuro ? 'opacity-[0.09]' : 'opacity-18'} bg-gradient-to-b from-chart-3 via-chart-3/70 to-chart-1 pointer-events-none`} />

                <div className={`relative rounded-header ${esBaja ? 'px-8 py-6 gap-4' : 'px-10 py-10 gap-6'} bg-[var(--lgn-vidrio)] backdrop-blur-[52px] backdrop-saturate-[200%] border border-[var(--lgn-vidrio-borde)] shadow-[var(--shadow-glass-5)] flex flex-col overflow-hidden`}>
                    <div className="absolute inset-0 bg-gradient-to-b from-[var(--lgn-brillo)] via-transparent to-transparent pointer-events-none rounded-header" />

                    {/* Logo */}
                    <div className={`relative flex flex-col items-center ${esBaja ? 'gap-1.5' : 'gap-3'}`}>
                        <div className="relative group/logo">
                            <div className="absolute -inset-4 rounded-header blur-2xl opacity-32 group-hover/logo:opacity-60 transition-all duration-[var(--dur-lento)] bg-gradient-to-tr from-chart-3/55 to-chart-1/40" />
                            <div className={`relative ${esBaja ? 'w-[62px] h-[62px]' : 'w-[88px] h-[88px]'} rounded-card bg-[var(--lgn-campo-foco)] backdrop-blur-2xl border border-border-card flex items-center justify-center shadow-[var(--shadow-glass-4)]`}
                                style={{ animation:'lgn-logo 4.5s ease-in-out infinite' }}>
                                <img src="/Logo192.png" alt="FarmaLasa" className={`${esBaja ? 'w-10 h-10' : 'w-[58px] h-[58px]'} object-contain`} />
                            </div>
                        </div>
                        <div className="text-center">
                            <h1 className={`${esBaja ? 'text-display' : 'text-display-lg'} font-black text-content tracking-tight leading-none`}>Portal</h1>
                            <p className={`text-caption font-black text-brand-text/72 uppercase tracking-[0.22em] ${esBaja ? 'mt-1' : 'mt-2'}`}>Farmacias La Popular &amp; La Salud</p>
                        </div>
                    </div>

                    <div className="relative h-px"><div className="absolute inset-0 bg-gradient-to-r from-transparent via-[var(--lgn-linea)] to-transparent" /></div>

                    <div className={`relative flex flex-col ${esBaja ? 'gap-3' : 'gap-5'}`}>
                        {renderLoginForm(esBaja)}
                    </div>

                    <div className="relative h-px"><div className="absolute inset-0 bg-gradient-to-r from-transparent via-[var(--lgn-linea)] to-transparent" /></div>
                    {!isMobileOrApp() && (
                        <div className="relative">
                            <button type="button" onClick={goToKiosko}
                                className={`group w-full ${esBaja ? 'p-2.5' : 'p-4'} rounded-card bg-[var(--lgn-boton)] backdrop-blur-md border border-border-card flex items-center justify-between transition-all duration-[var(--dur-base)] active:scale-[0.97] hover:bg-[var(--lgn-boton-hover)] hover:border-border-card hover:shadow-[var(--shadow-elevation-md)] hover:translate-y-[var(--lift-card)]`}>
                                <div className="flex items-center gap-3.5">
                                    <div className={`${esBaja ? 'w-9 h-9' : 'w-11 h-11'} rounded-2xl bg-surface-card border border-border-card flex items-center justify-center group-hover:bg-surface-card-hover transition-all duration-[var(--dur-base)] shadow-sm group-hover:shadow-[var(--shadow-glow-brand)]`}>
                                        <Clock size={esBaja ? 15 : 18} className="text-content-3 group-hover:text-brand-text transition-colors" strokeWidth={2} />
                                    </div>
                                    <div className="text-left">
                                        <p className="text-body-sm font-black text-content-2 uppercase tracking-widest">Terminal Kiosco</p>
                                        <p className="text-micro font-bold text-content-3 uppercase tracking-[0.1em] mt-0.5">Marcar entrada / salida</p>
                                    </div>
                                </div>
                                <div className="w-8 h-8 rounded-full bg-surface-card border border-border-card flex items-center justify-center group-hover:bg-brand group-hover:border-transparent transition-all duration-[var(--dur-base)] group-hover:shadow-[var(--shadow-glow-brand)]">
                                    <ArrowRight size={14} className="text-content-3 group-hover:text-white transition-colors" strokeWidth={2.5} />
                                </div>
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Quick links */}
            <div className={`absolute right-8 top-1/2 -translate-y-1/2 hidden lg:flex flex-col gap-3 z-content transition-all duration-[var(--dur-lento)] delay-[300ms] ease-[var(--ease-spring)] ${mounted?'opacity-100 translate-x-0':'opacity-0 translate-x-8'}`}>
                <div className="rounded-modal p-4 bg-[var(--lgn-vidrio)] backdrop-blur-[40px] backdrop-saturate-[200%] border border-[var(--lgn-vidrio-borde)] shadow-[var(--shadow-glass-5)] flex flex-col gap-3 overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-b from-[var(--lgn-brillo)] to-transparent pointer-events-none rounded-modal" />
                    <div className="relative flex items-center gap-2 px-1 mb-1">
                        <Sparkles size={11} className="text-chart-3-text" strokeWidth={2} />
                        <p className="text-micro font-black uppercase tracking-widest text-content-3">Accesos rápidos</p>
                    </div>
                    {[
                        {href:'https://clientesdte.oss.com.sv/farma_salud/dashboard.php',Icon:ShoppingCart,label:'Sistema de Ventas',sub:'DTE · OSS',color:'#0052CC',glow:'rgba(0,82,204,0.22)'},
                        {href:'https://farmalasa.com',Icon:Pill,label:'Farmalasa',sub:'Sitio web oficial',color:'#6929C4',glow:'rgba(105,41,196,0.22)'},
                    ].map(({href,Icon,label,sub,color,glow})=>(
                        <a key={label} href={href} target="_blank" rel="noopener noreferrer"
                            className="relative group flex items-center gap-3 px-3.5 py-3 bg-[var(--lgn-campo)] hover:bg-[var(--lgn-campo-foco)] backdrop-blur-md border border-border-card hover:border-border-card rounded-2xl transition-all duration-[var(--dur-base)] active:scale-[0.97] hover:scale-[1.02] hover:translate-y-[var(--lift-card)] w-[210px] overflow-hidden"
                            onMouseEnter={e => { e.currentTarget.style.boxShadow = `0 8px 24px ${glow}, inset 0 1px 0 rgba(255,255,255,0.7)`; }}
                            onMouseLeave={e => { e.currentTarget.style.boxShadow = ''; }}>
                            <div className="absolute inset-0 overflow-hidden rounded-2xl pointer-events-none">
                            </div>
                            <div className="relative w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-all duration-[var(--dur-base)] group-hover:scale-110"
                                style={{ background:`${color}16`, border:`1px solid ${color}28` }}>
                                <Icon size={16} strokeWidth={2} style={{color}} />
                            </div>
                            <div className="relative min-w-0">
                                <p className="text-label font-black text-content-2 group-hover:text-content transition-colors truncate">{label}</p>
                                <p className="text-micro font-bold text-content-3 uppercase tracking-wide">{sub}</p>
                            </div>
                            <ChevronRight size={11} className="relative text-content-3 group-hover:text-content-3 ml-auto shrink-0 transition-all duration-[var(--dur-base)] group-hover:translate-x-0.5" strokeWidth={2.5} />
                        </a>
                    ))}
                </div>
            </div>
        </div>
    );

    return (
        // `h-[100dvh] overflow-y-auto` y NO `min-h-[100dvh] overflow-hidden`:
        // arriba de 1024px el reset deja `html, body, #root` en `overflow:
        // hidden` (index.css §3276), así que un contenedor de alto automático
        // no scrollea — crece, y lo que sobra lo recorta #root sin dejar forma
        // de llegar. Con alto fijo, el scroll vive acá y es la red que evita
        // que la tarjeta quede cortada en un monitor bajo. Mismo cambio que ya
        // se le había hecho al kiosco.
        <div className={`lgn-fondo relative w-full h-[100dvh] overflow-y-auto overflow-x-hidden transition-all duration-[var(--dur-slow)] ease-[var(--ease-spring)] ${leaving?'opacity-0 scale-[1.03]':'opacity-100 scale-100'}`}
            style={{ background:'var(--lgn-bg)' }}>
            <style>{keyframeStyles}</style>
            <div className="relative z-base w-full min-h-full flex flex-col">
                {esAngosto ? renderMobileLayout() : renderDesktopLayout()}
            </div>
        </div>
    );
};

export default LoginView;
