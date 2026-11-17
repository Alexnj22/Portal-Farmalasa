import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@nucleo/context/AuthContext';
import useCapturaDeCarne from '@plataforma/useCapturaDeCarne';
import { sesionDeCaja, INACTIVO_MS } from './sesionDeCaja';
import { esDemo, EVENTO_CARNE_DEMO } from './demoDelKiosco';

// Lo que decide el kiosco de caja, sin nada de cómo se ve: quién está, qué
// eligió, el carné leído que espera, la cuenta de los 2 minutos. Lo usan los
// dos diseños del kiosco mientras se elige uno (2026-11-17).

const EVENTOS_DE_USO = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
const ELEGIR_MS = 20_000;

function leerEquipo() {
    try { return JSON.parse(localStorage.getItem('kiosk_config') || 'null') ?? {}; } catch { return {}; }
}

export default function useKioscoDeCaja({ marcadorOcupado, feedbackAbierto, onMarcadorActivo }) {
    const { isAuthenticated, user, login, logout } = useAuth();
    const [, setParams] = useSearchParams();
    const [equipo] = useState(leerEquipo);
    const [accion, setAccion] = useState(null);
    const [, setTick] = useState(0);
    const [pendiente, setPendiente] = useState(null);
    const [entrando, setEntrando] = useState(false);
    const [error, setError] = useState(null);
    const [restante, setRestante] = useState(INACTIVO_MS);
    const [vista, setVistaState] = useState(sesionDeCaja.vista || 'vender');
    const abierta = isAuthenticated && sesionDeCaja.abiertaPorCarne;
    const marcando = accion === 'marcar' || marcadorOcupado;

    const setVista = useCallback((v) => { sesionDeCaja.vista = v; setVistaState(v); }, []);

    // Mi caja y la venta leen la sucursal de la dirección: la del equipo.
    useEffect(() => {
        if (!equipo.branchId) return;
        setParams((p) => {
            if (p.get('sala') === String(equipo.branchId)) return p;
            p.set('sala', String(equipo.branchId));
            return p;
        }, { replace: true });
    }, [equipo.branchId, setParams]);

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

    // Un carné leído sin elegir nada espera 20 s; después se olvida.
    useEffect(() => {
        if (!pendiente) return undefined;
        const t = setTimeout(() => setPendiente(null), ELEGIR_MS);
        return () => clearTimeout(t);
    }, [pendiente]);

    const terminar = useCallback(() => {
        sesionDeCaja.abiertaPorCarne = false;
        sesionDeCaja.ultimoUso = 0;
        setAccion(null);
        if (!esDemo()) logout?.();
        setTick((n) => n + 1);
    }, [logout]);

    // Dos minutos sin tocar nada: se cierra sola. La cuenta se ve arriba.
    useEffect(() => {
        if (!abierta) return undefined;
        if (!sesionDeCaja.ultimoUso) sesionDeCaja.ultimoUso = Date.now();
        const usar = () => { sesionDeCaja.ultimoUso = Date.now(); };
        EVENTOS_DE_USO.forEach((ev) => window.addEventListener(ev, usar, { passive: true, capture: true }));
        const id = setInterval(() => {
            const queda = sesionDeCaja.ultimoUso + INACTIVO_MS - Date.now();
            setRestante(queda);
            if (queda <= 0) terminar();
        }, 1000);
        return () => {
            clearInterval(id);
            EVENTOS_DE_USO.forEach((ev) => window.removeEventListener(ev, usar, { capture: true }));
        };
    }, [abierta, terminar]);

    const entrar = useCallback(async (codigo, destino) => {
        setPendiente(null);
        setEntrando(true);
        setError(null);
        // Se marca ANTES de entrar: el portal desmonta el kiosco mientras
        // verifica la sesión, y al volver tiene que saber que es del carné.
        sesionDeCaja.abiertaPorCarne = true;
        sesionDeCaja.ultimoUso = Date.now();
        setVista(destino);
        // Muestra: la sesión es la cuenta con la que ya se entró al navegador.
        const r = esDemo() && isAuthenticated ? { ok: true } : await login(codigo);
        setEntrando(false);
        if (!r?.ok) {
            sesionDeCaja.abiertaPorCarne = false;
            setError(r?.error || 'Ese carné no abrió la sesión. Intenta de nuevo.');
        }
    }, [login, setVista, isAuthenticated]);

    // Muestra: tocar Vender o Caja entra directo, sin carné (la laptop no
    // tiene lector). Marcar sigue pidiendo el carné: escribe una marcación.
    const elegir = useCallback((v) => {
        const valor = typeof v === 'function' ? v(accion) : v;
        if (esDemo() && (valor === 'vender' || valor === 'caja')) { entrar('DEMO', valor); return; }
        setAccion(valor);
    }, [accion, entrar]);

    const alLeer = useCallback((codigo) => {
        if (accion === 'vender' || accion === 'caja') entrar(codigo, accion);
        else { setError(null); setPendiente(codigo); }
    }, [accion, entrar]);

    const elegirDespues = useCallback((destino) => {
        if (destino === 'marcar') { setPendiente(null); setAccion('marcar'); return; }
        if (pendiente) entrar(pendiente, destino);
    }, [pendiente, entrar]);

    // Muestra: un botón hace de carné.
    useEffect(() => {
        if (!esDemo()) return undefined;
        const f = () => { if (!abierta && !marcando) alLeer('DEMO'); };
        window.addEventListener(EVENTO_CARNE_DEMO, f);
        return () => window.removeEventListener(EVENTO_CARNE_DEMO, f);
    }, [abierta, marcando, alLeer]);

    const escuchando = !abierta && !entrando && !marcando && !feedbackAbierto && !pendiente;
    const { manual } = useCapturaDeCarne(escuchando, alLeer);
    const aviso = manual ? 'Pasa el carné por el lector. Escrito a mano no cuenta.' : error;

    return {
        user, equipo, abierta, marcando, accion, setAccion: elegir, pendiente, setPendiente,
        entrando, aviso, restante, vista, setVista, terminar, elegirDespues,
    };
}
