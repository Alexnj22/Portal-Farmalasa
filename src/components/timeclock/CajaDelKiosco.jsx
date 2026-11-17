import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Clock3, LogOut, ShoppingCart, Wallet } from 'lucide-react';
import Button from '../common/Button';
import SegmentedControl from '../common/SegmentedControl';
import AvatarConEstado from '../common/AvatarConEstado';
import { LoadingState } from '../common/StateViews';
import ColaDeCaja from './ColaDeCaja';
import PasaTuCarne from './PasaTuCarne';
import { useAuth } from '@nucleo/context/AuthContext';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { hora12 } from '@nucleo/utils/hora';
import useCapturaDeCarne from '@plataforma/useCapturaDeCarne';
import { sesionDeCaja, INACTIVO_MS } from './sesionDeCaja';

// El kiosco de caja entero (rediseño del 2026-11-17, pedido del usuario: «que
// sea práctico… ¿por qué vender y preventas está separado?»).
//
// Tres pantallas en una barra fija arriba: **Ventas** (la cola de caja y, con
// el carné, la venta), **Caja** (con el carné, Mi caja de hoy) y **Marcar**.
// La barra dice siempre de qué sucursal es el equipo, la hora y, con una
// sesión abierta, quién está operando y cuánto falta para que se cierre sola.
//
// El carné abre la sesión de esa persona (la misma entrada que el carné en la
// pantalla de inicio): lo que se haga queda a su nombre, con sus permisos y
// sus frenos. Se cierra con «Terminar», al pasar a Marcar y tras 2 minutos sin
// tocar nada. Ventas y Caja comparten la sesión.
const MiCajaView = lazy(() => import('../../views/MiCajaView'));
const PreventaView = lazy(() => import('../../views/PreventaView'));

const PANTALLAS = [
    { value: 'ventas', label: 'Ventas', icon: ShoppingCart },
    { value: 'caja', label: 'Caja', icon: Wallet },
    { value: 'marcar', label: 'Marcar', icon: Clock3 },
];

const EVENTOS_DE_USO = ['pointerdown', 'keydown', 'wheel', 'touchstart'];

function leerEquipo() {
    try { return JSON.parse(localStorage.getItem('kiosk_config') || 'null') ?? {}; } catch { return {}; }
}

const mmss = (ms) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Quién opera, cuánto le queda y «Terminar». */
function QuienOpera({ user, restante, onTerminar }) {
    const poco = restante <= 30_000;
    return (
        <div className="flex items-center gap-3 min-w-0">
            <AvatarConEstado emp={user} px={36} mostrarChip={false} />
            <div className="min-w-0 leading-tight hidden md:block">
                <p className="text-body-sm font-bold text-content truncate">{shortEmployeeName(user)}</p>
                <p className={`text-label tabular-nums ${poco ? 'text-warning-text' : 'text-content-3'}`}>
                    Se cierra en {mmss(restante)}
                </p>
            </div>
            <Button variant="secondary" size="sm" icon={LogOut} onClick={onTerminar}>Terminar</Button>
        </div>
    );
}

export default function CajaDelKiosco({ pantalla, onPantalla, marcar, ahora, onSalir }) {
    const { isAuthenticated, user, login, logout } = useAuth();
    const [, setParams] = useSearchParams();
    const [equipo] = useState(leerEquipo);
    const [entrando, setEntrando] = useState(false);
    const [error, setError] = useState(null);
    const [restante, setRestante] = useState(INACTIVO_MS);
    const conCarne = pantalla === 'ventas' || pantalla === 'caja';
    const abierta = isAuthenticated && sesionDeCaja.abiertaPorCarne;

    // Mi caja y la venta leen la sucursal de la dirección: la del equipo.
    useEffect(() => {
        if (!equipo.branchId) return;
        setParams((p) => {
            if (p.get('sala') === String(equipo.branchId)) return p;
            p.set('sala', String(equipo.branchId));
            return p;
        }, { replace: true });
    }, [equipo.branchId, setParams]);

    const terminar = useCallback(() => {
        sesionDeCaja.abiertaPorCarne = false;
        sesionDeCaja.ultimoUso = 0;
        logout?.();
    }, [logout]);

    // Al pasar a Marcar, la sesión del carné se cierra.
    useEffect(() => {
        if (!conCarne && sesionDeCaja.abiertaPorCarne) terminar();
    }, [conCarne, terminar]);

    // Dos minutos sin tocar nada: se cierra sola. La cuenta se ve en la barra.
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

    const alLeer = useCallback(async (codigo) => {
        setEntrando(true);
        setError(null);
        // Se marca ANTES de entrar: el portal desmonta el kiosco mientras
        // verifica la sesión, y al volver tiene que saber que es del carné.
        sesionDeCaja.abiertaPorCarne = true;
        sesionDeCaja.ultimoUso = Date.now();
        const r = await login(codigo);
        setEntrando(false);
        if (!r?.ok) {
            sesionDeCaja.abiertaPorCarne = false;
            setError(r?.error || 'Ese carné no abrió la sesión. Intenta de nuevo.');
        }
    }, [login]);

    const { manual } = useCapturaDeCarne(conCarne && !abierta && !entrando, alLeer);
    const aviso = manual ? 'Pasa el carné por el lector. Escrito a mano no cuenta.' : error;

    const carne = (titulo, detalle) => (
        <PasaTuCarne titulo={entrando ? 'Abriendo…' : titulo} detalle={detalle} aviso={aviso} />
    );

    let cuerpo;
    if (pantalla === 'marcar') {
        cuerpo = marcar;
    } else if (pantalla === 'caja') {
        cuerpo = abierta
            ? <Suspense fallback={<LoadingState />}><MiCajaView comoPestana /></Suspense>
            : (
                <div className="flex-1 flex items-center justify-center">
                    <div className="w-full max-w-[420px]">
                        {carne('Pasa tu carné para abrir la caja', 'Apertura, cortes y cierre del día quedan a tu nombre.')}
                    </div>
                </div>
            );
    } else {
        cuerpo = abierta
            ? <Suspense fallback={<LoadingState />}><PreventaView enKiosco /></Suspense>
            : (
                <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] items-start">
                    <ColaDeCaja />
                    <aside className="order-first lg:order-none lg:sticky lg:top-24">
                        {carne('Pasa tu carné para vender', 'La venta llega a la cola con tu nombre.')}
                    </aside>
                </div>
            );
    }

    return (
        <div className="relative z-base flex-1 w-full flex flex-col">
            {/* La barra del kiosco: dónde, qué pantalla y quién. */}
            <header data-surface="page-header" className="sticky top-0 z-header">
                <div className="mx-auto max-w-[1400px] px-4 py-2.5 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                        <img src="/Logo192.png" alt="" className="w-8 h-8 object-contain shrink-0" draggable="false" />
                        <div className="min-w-0 leading-tight hidden sm:block">
                            <p className="text-body-sm font-bold text-content truncate">{equipo.branchName || 'Kiosco de caja'}</p>
                            <p className="text-label text-content-3 tabular-nums">{hora12(ahora)}</p>
                        </div>
                    </div>
                    <SegmentedControl label="Pantalla del kiosco" tone="neutro" options={PANTALLAS} value={pantalla} onChange={onPantalla} />
                    <div className="flex justify-end min-w-0">
                        {abierta && conCarne
                            ? <QuienOpera user={user} restante={restante} onTerminar={terminar} />
                            : <Button variant="ghost" size="sm" icon={LogOut} title="Salir del kiosco (Esc)" onClick={onSalir}>Salir</Button>}
                    </div>
                </div>
            </header>

            <main className="flex-1 w-full mx-auto max-w-[1400px] px-4 py-6 flex flex-col">
                {cuerpo}
            </main>
        </div>
    );
}
