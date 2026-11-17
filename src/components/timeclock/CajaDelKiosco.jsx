import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LogOut, AlertCircle } from 'lucide-react';
import Button from '../common/Button';
import Notice from '../common/Notice';
import AvatarConEstado from '../common/AvatarConEstado';
import { LoadingState } from '../common/StateViews';
import { ScanReadyRing } from './IdleScanPanel';
import { useAuth } from '@nucleo/context/AuthContext';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import useCapturaDeCarne from '@plataforma/useCapturaDeCarne';
import { sesionDeCaja } from './sesionDeCaja';

// La pestaña «Caja» del kiosco de caja (fase 2, 2026-11-17).
//
// Decisión del usuario: el carné ABRE Mi caja. Se pasa el carné, se entra con
// la sesión de esa persona —la misma entrada que el carné en la pantalla de
// inicio— y se ve Mi caja de hoy, idéntica, con sus permisos y sus frenos: lo
// que se haga queda a su nombre. No hay menú ni otras pantallas.
//
// La sesión no se queda en la computadora de la sucursal: se cierra con
// «Terminar», al cambiar de pestaña y tras 2 minutos sin tocar nada. Es lo que
// separa esto de dejar una sesión abierta en la caja, que era el problema de
// partida (datos de una persona a la vista de todos).
const MiCajaView = lazy(() => import('../../views/MiCajaView'));

const INACTIVO_MS = 2 * 60_000;

const EVENTOS_DE_USO = ['pointerdown', 'keydown', 'wheel', 'touchstart'];

export default function CajaDelKiosco({ branchId }) {
    const { isAuthenticated, user, login, logout } = useAuth();
    const [, setParams] = useSearchParams();
    const [entrando, setEntrando] = useState(false);
    const [error, setError] = useState(null);

    // Mi caja lee la sucursal de la dirección: la del equipo, siempre.
    useEffect(() => {
        if (!branchId) return;
        setParams((p) => {
            if (p.get('sala') === String(branchId)) return p;
            p.set('sala', String(branchId));
            return p;
        }, { replace: true });
    }, [branchId, setParams]);

    const terminar = useCallback(() => { sesionDeCaja.abiertaPorCarne = false; logout?.(); }, [logout]);


    // Dos minutos sin tocar nada: se cierra sola.
    useEffect(() => {
        if (!isAuthenticated) return undefined;
        let t = setTimeout(terminar, INACTIVO_MS);
        const reiniciar = () => { clearTimeout(t); t = setTimeout(terminar, INACTIVO_MS); };
        EVENTOS_DE_USO.forEach((ev) => window.addEventListener(ev, reiniciar, { passive: true, capture: true }));
        return () => {
            clearTimeout(t);
            EVENTOS_DE_USO.forEach((ev) => window.removeEventListener(ev, reiniciar, { capture: true }));
        };
    }, [isAuthenticated, terminar]);

    const alLeer = useCallback(async (codigo) => {
        setEntrando(true);
        setError(null);
        const r = await login(codigo);
        setEntrando(false);
        if (r?.ok) sesionDeCaja.abiertaPorCarne = true;
        if (!r?.ok) setError(r?.error || 'Ese carné no abre la caja. Intenta de nuevo.');
    }, [login]);

    const { manual } = useCapturaDeCarne(!isAuthenticated && !entrando, alLeer);
    const aviso = manual ? 'Pasa el carné por el lector. Escrito a mano no cuenta.' : error;

    if (!isAuthenticated) {
        return (
            <section aria-label="Caja" className="w-full max-w-[420px] mx-auto my-auto flex flex-col items-center text-center gap-5 py-6">
                <ScanReadyRing specialMode={false} />
                <div className="flex flex-col items-center gap-1">
                    <p className="text-title-lg font-bold text-white">{entrando ? 'Abriendo la caja…' : 'Pasa tu carné para abrir la caja'}</p>
                    <p className="text-body text-white/55">Apertura, cortes y cierre del día quedan a tu nombre.</p>
                </div>
                {aviso && <Notice variant="warning" icon={AlertCircle}>{aviso}</Notice>}
            </section>
        );
    }

    return (
        <section aria-label="Caja" className="w-full max-w-[1200px] mx-auto flex flex-col gap-3">
            <div data-surface="card" className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                    <AvatarConEstado emp={user} px={36} mostrarChip={false} />
                    <div className="min-w-0">
                        <p className="text-body font-bold text-content truncate">{user ? shortEmployeeName(user) : ''}</p>
                        <p className="text-label text-content-3">Se cierra sola tras 2 minutos sin usarla.</p>
                    </div>
                </div>
                <Button variant="secondary" icon={LogOut} onClick={terminar}>Terminar</Button>
            </div>
            <Suspense fallback={<LoadingState />}>
                <MiCajaView comoPestana />
            </Suspense>
        </section>
    );
}
