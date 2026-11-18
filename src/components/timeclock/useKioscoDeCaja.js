import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@nucleo/context/AuthContext';
import useCapturaDeCarne from '@plataforma/useCapturaDeCarne';
import { sesionDeCaja, INACTIVO_MS, INACTIVO_CON_VENTANA_MS } from './sesionDeCaja';
import { esDemo, EVENTO_CARNE_DEMO } from './demoDelKiosco';

// Lo que decide el kiosco de caja, sin nada de cómo se ve: quién está, qué
// eligió, el carné leído que espera, la cuenta de los 2 minutos. Lo usan los
// dos diseños del kiosco mientras se elige uno (2026-11-17).

const EVENTOS_DE_USO = ['pointerdown', 'keydown', 'wheel', 'touchstart'];

function leerEquipo() {
    try { return JSON.parse(localStorage.getItem('kiosk_config') || 'null') ?? {}; } catch { return {}; }
}

// `enPortal`: la vista previa desde el portal. Todo igual que en la sucursal
// (inicio, carné o usuario, cuenta regresiva), pero entrar no cambia de
// cuenta y terminar no cierra la sesión: se usa la de quien mira.
export default function useKioscoDeCaja({ marcadorOcupado, feedbackAbierto, onMarcadorActivo, enPortal = false }) {
    const { isAuthenticated, user, login, loginWithUsername, logout } = useAuth();
    const [, setParams] = useSearchParams();
    const [equipo] = useState(leerEquipo);
    const [accion, setAccion] = useState(null);
    const [, setTick] = useState(0);
    // Sin carné a mano: entrar con usuario y contraseña (el lector se apaga).
    const [conClave, setConClave] = useState(false);
    const [entrando, setEntrando] = useState(false);
    const [error, setError] = useState(null);
    const [restante, setRestante] = useState(INACTIVO_MS);
    const [vista, setVistaState] = useState(sesionDeCaja.vista || 'vender');
    // Mientras el carné abre la sesión, quien estaba antes NO cuenta como abierta.
    const abierta = isAuthenticated && sesionDeCaja.abiertaPorCarne && !(sesionDeCaja.previo && user?.id === sesionDeCaja.previo);
    const marcando = accion === 'marcar' || marcadorOcupado;

    const setVista = useCallback((v) => { sesionDeCaja.vista = v; setVistaState(v); }, []);

    // Mi caja y la venta leen la sucursal de la dirección: la del equipo.
    useEffect(() => {
        if (enPortal || !equipo.branchId) return;
        setParams((p) => {
            if (p.get('sala') === String(equipo.branchId)) return p;
            p.set('sala', String(equipo.branchId));
            return p;
        }, { replace: true });
    }, [equipo.branchId, setParams, enPortal]);

    // El marcador sólo escucha cuando se eligió Marcar.
    useEffect(() => { onMarcadorActivo?.(marcando && !abierta); }, [marcando, abierta, onMarcadorActivo]);

    // Al terminar la marcación (se cierra el aviso), vuelve al mostrador.
    const habiaAviso = useRef(false);
    useEffect(() => {
        const termino = habiaAviso.current && !feedbackAbierto && !marcadorOcupado;
        habiaAviso.current = feedbackAbierto;
        if (!termino) return undefined;
        const t = setTimeout(() => setAccion(null), 0);
        return () => clearTimeout(t);
    }, [feedbackAbierto, marcadorOcupado]);

    const terminar = useCallback(() => {
        sesionDeCaja.abiertaPorCarne = false;
        sesionDeCaja.ultimoUso = 0;
        setAccion(null);
        if (!esDemo() && !enPortal) logout?.();
        setTick((n) => n + 1);
    }, [logout, enPortal]);

    // Dos minutos sin tocar nada: se cierra sola. La cuenta se ve arriba.
    useEffect(() => {
        if (!abierta) return undefined;
        if (!sesionDeCaja.ultimoUso) sesionDeCaja.ultimoUso = Date.now();
        const usar = () => { sesionDeCaja.ultimoUso = Date.now(); };
        EVENTOS_DE_USO.forEach((ev) => window.addEventListener(ev, usar, { passive: true, capture: true }));
        const id = setInterval(() => {
            // Con un trámite o una ventana abierta (un ajuste a medio llenar) el
            // plazo es más largo: cerrar ahí perdía lo escrito (usuario,
            // 2026-11-18). Sigue teniendo tope: un modal olvidado no deja la
            // sesión de alguien abierta para siempre.
            const plazo = document.querySelector('[role="dialog"]') ? INACTIVO_CON_VENTANA_MS : INACTIVO_MS;
            const queda = sesionDeCaja.ultimoUso + plazo - Date.now();
            setRestante(queda);
            if (queda <= 0) terminar();
        }, 1000);
        return () => {
            clearInterval(id);
            EVENTOS_DE_USO.forEach((ev) => window.removeEventListener(ev, usar, { capture: true }));
        };
    }, [abierta, terminar]);

    // `cred`: el código del carné, o `{ usuario, clave }` sin carné.
    const entrar = useCallback(async (cred, destino) => {
        setEntrando(true);
        setError(null);
        // Se marca ANTES de entrar: el portal desmonta el kiosco mientras
        // verifica la sesión, y al volver tiene que saber que es del carné.
        sesionDeCaja.abiertaPorCarne = true;
        sesionDeCaja.ultimoUso = Date.now();
        const simulado = (esDemo() || enPortal) && isAuthenticated;
        sesionDeCaja.previo = isAuthenticated && !simulado ? user?.id ?? null : null;
        setVista(destino);
        // Muestra: la sesión es la cuenta con la que ya se entró al navegador.
        const conUsuario = typeof cred === 'object' && cred;
        const r = simulado ? { ok: true }
            : conUsuario ? await loginWithUsername(cred.usuario, cred.clave) : await login(cred);
        setEntrando(false);
        sesionDeCaja.previo = null;
        if (!r?.ok) {
            sesionDeCaja.abiertaPorCarne = false;
            setError(r?.error || (conUsuario ? 'Usuario o contraseña incorrectos.' : 'Ese carné no abrió la sesión. Intenta de nuevo.'));
        } else {
            setConClave(false);
            // Simulado no espera nada: sin esto ningún estado cambia y la
            // pantalla no se entera de que la sesión del kiosco se abrió.
            setTick((n) => n + 1);
        }
    }, [login, loginWithUsername, setVista, isAuthenticated, user?.id, enPortal]);

    // Muestra: tocar Vender o Caja entra directo, sin carné (la laptop no
    // tiene lector). Marcar sigue pidiendo el carné: escribe una marcación.
    const elegir = useCallback((v) => {
        const valor = typeof v === 'function' ? v(accion) : v;
        if (esDemo() && (valor === 'vender' || valor === 'caja')) { entrar('DEMO', valor); return; }
        setError(null);
        setConClave(false);
        setAccion(valor);
    }, [accion, entrar]);

    // Primero se elige y AHÍ se pide el carné (pedido del usuario,
    // 2026-11-17): en la pantalla principal el lector no escucha.
    const pidiendo = accion === 'vender' || accion === 'caja' || accion === 'mas';
    const alLeer = useCallback((codigo) => { if (pidiendo) entrar(codigo, accion); }, [pidiendo, accion, entrar]);
    const entrarConClave = useCallback((usuario, clave) => {
        if (pidiendo && usuario && clave) entrar({ usuario, clave }, accion);
    }, [pidiendo, accion, entrar]);

    // Muestra: un botón hace de carné.
    useEffect(() => {
        if (!esDemo()) return undefined;
        const f = () => { if (!abierta && !marcando) alLeer('DEMO'); };
        window.addEventListener(EVENTO_CARNE_DEMO, f);
        return () => window.removeEventListener(EVENTO_CARNE_DEMO, f);
    }, [abierta, marcando, alLeer]);

    const escuchando = pidiendo && !conClave && !abierta && !entrando && !marcando && !feedbackAbierto;
    const { manual } = useCapturaDeCarne(escuchando, alLeer);
    const aviso = manual ? 'Pasa el carné por el lector. Escrito a mano no cuenta.' : error;

    return {
        user, equipo, abierta, marcando, accion, setAccion: elegir,
        entrando, aviso, restante, vista, setVista, terminar,
        conClave, setConClave: (v) => { setError(null); setConClave(v); }, entrarConClave,
    };
}
