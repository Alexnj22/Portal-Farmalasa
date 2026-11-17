import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Megaphone, Bell, ChevronRight, Sparkles, Smartphone, ListChecks } from 'lucide-react';
import LiquidModal from '../common/LiquidModal';
import PieDeModal from '../common/PieDeModal';
import Button from '../common/Button';
import * as almacen from '../../plataforma/almacen';
import { hoySV } from '@nucleo/utils/fecha';

/**
 * «Ya puedes ver las Novedades» — una vez por persona (2026-11-16).
 *
 * Pedido del usuario: «mañana cuando inicien sesión por primera vez, agrega una
 * pantalla de aviso que les salga que pueden ver las novedades y les diga
 * dónde». Sale desde `DESDE` (hora de El Salvador), a quien puede ver
 * Novedades, una sola vez: al tocar cualquiera de los dos botones queda
 * marcado en este dispositivo.
 *
 * `?aviso=novedades` en la dirección la muestra aunque no sea el día o ya se
 * haya visto: es para revisarla.
 */
const DESDE = '2026-11-17';
const clave = (empId) => `aviso-novedades-visto:${empId || 'anon'}`;
const yaLoVio = (empId) => { try { return almacen.leer(clave(empId)) === '1'; } catch { return false; } };
const marcar = (empId) => { try { almacen.guardar(clave(empId), '1'); } catch { /* sin espacio: vuelve a salir, no se pierde nada */ } };

export default function AvisoNovedades({ empId, puede, bloqueado = false }) {
    const navigate = useNavigate();
    const { pathname, search } = useLocation();
    const forzado = new URLSearchParams(search).get('aviso') === 'novedades';
    const [cerrado, setCerrado] = useState(false);

    const toca = forzado || (hoySV() >= DESDE && !yaLoVio(empId) && !pathname.startsWith('/novedades'));
    if (!puede || bloqueado || cerrado || !toca) return null;

    const cerrar = () => { marcar(empId); setCerrado(true); };
    const ver = () => { cerrar(); navigate('/novedades'); };

    return (
        <LiquidModal open onClose={cerrar} maxWidth="max-w-lg" ariaLabel="Novedades">
            <div className="relative overflow-hidden bg-gradient-to-br from-brand to-brand-purple text-white px-6 pt-8 pb-6">
                <div aria-hidden className="pointer-events-none absolute -right-12 -top-16 w-56 h-56 rounded-full bg-brand-purple/40" />
                <div aria-hidden className="pointer-events-none absolute -left-10 -bottom-20 w-48 h-48 rounded-full bg-brand/30" />
                <div className="relative flex flex-col items-start gap-3">
                    <span className="w-14 h-14 rounded-2xl bg-brand-purple/50 ring-1 ring-brand/30 grid place-items-center shadow-modal">
                        <Megaphone size={28} />
                    </span>
                    <h2 className="text-display font-black leading-tight tracking-tight">Ya puedes ver las Novedades</h2>
                    <p className="text-body text-white/85">Todo lo nuevo del portal y la app en un solo lugar, con lo que le toca a tu cargo.</p>
                </div>
            </div>

            <LiquidModal.Body>
                <div className="flex flex-col gap-5">
                    <div>
                        <p className="text-caption font-black uppercase tracking-widest text-content-3 mb-2">Dónde está</p>
                        <div className="rounded-card border border-border-subtle bg-surface-card-hover p-3 flex flex-col gap-1" aria-label="En el menú: Avisos, luego Novedades">
                            <div className="flex items-center gap-2.5 px-2 py-1.5 text-body-sm text-content-2">
                                <Bell size={16} /> <span className="font-semibold">Avisos</span>
                                <ChevronRight size={14} className="ml-auto rotate-90 text-content-3" />
                            </div>
                            <div className="flex items-center gap-2.5 ml-5 px-3 py-2 rounded-lg bg-brand/12 ring-1 ring-brand/30 text-body-sm text-brand-text">
                                <Megaphone size={16} /> <span className="font-black">Novedades</span>
                                <span className="ml-auto text-caption font-bold">Aquí</span>
                            </div>
                        </div>
                        <p className="text-body-sm text-content-2 mt-2">En el menú de la izquierda: <b className="text-content">Avisos → Novedades</b>.</p>
                    </div>

                    <ul className="flex flex-col gap-3">
                        {[
                            { Icono: Sparkles, t: 'Cada cambio con una animación de cómo se hace.' },
                            { Icono: ListChecks, t: 'Los pasos que te tocan según tu cargo.' },
                            { Icono: Smartphone, t: 'Ahí también descargas Portal Farmasalud, la app del personal.' },
                        ].map(({ Icono, t }) => (
                            <li key={t} className="flex items-start gap-3">
                                <span className="w-8 h-8 rounded-xl bg-brand/12 text-brand-text grid place-items-center shrink-0"><Icono size={16} /></span>
                                <span className="text-body text-content pt-1">{t}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            </LiquidModal.Body>

            <PieDeModal>
                <Button variant="ghost" onClick={cerrar}>Después</Button>
                <Button icon={Megaphone} onClick={ver}>Ver novedades</Button>
            </PieDeModal>
        </LiquidModal>
    );
}
