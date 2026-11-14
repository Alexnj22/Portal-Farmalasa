import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, ShieldCheck } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import PuntoDeEstado from '../../components/common/PuntoDeEstado';
import { EmptyState, LoadingState } from '../../components/common/StateViews';
import { fetchResumenDeCumplimiento, mensajeDeCumplimiento } from '@nucleo/data/cumplimiento';
import { pendientesDeLaRed, pendientesDeSala } from '@nucleo/utils/cumplimiento';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';

const RegistroModal = lazy(() => import('./RegistroModal'));

/*
 * El tablero de cumplimiento (2026-11-11; rehecho el 2026-11-14).
 *
 * Antes era una tarjeta por sala, y como a casi todas les falta lo mismo, la
 * pantalla era el mismo renglón repetido siete veces: no decía qué hacer
 * primero ni dónde. Ahora va por OBLIGACIÓN: «falta el reporte del semestre —
 * en estas salas», de lo más urgente a lo menos, y cada sala se toca:
 *   - si lo que falta se resuelve anotando un registro (el reporte cero, la
 *     autoinspección, la capacitación…), se abre ese formulario ya con la sala;
 *   - si no (una reacción por notificar, un retiro, una acreditación), lleva a
 *     la pestaña donde se resuelve, filtrada por esa sala.
 * Arriba, las salas: tocar una deja sólo lo suyo. Abajo, lo que está al día
 * en toda la red, para que el tablero también diga lo que ya se cumple.
 * Los números salen de `cumplimiento_resumen`; el agrupado, de
 * `pendientesDeLaRed` (núcleo).
 */

const PUNTO = { danger: 'bg-danger', warning: 'bg-warning', info: 'bg-content-3' };
const TONO_BADGE = { danger: 'danger', warning: 'warning', info: 'neutral' };

export default function TabResumen({ onIr, pestanas, puedeAnotar }) {
    const [salas, setSalas] = useState(null);
    const [error, setError] = useState(null);
    const [soloSala, setSoloSala] = useState(null);
    const [anotando, setAnotando] = useState(null); // { tipo, branchId, sala, inicial }
    const hoy = hoySV();

    const cargar = useCallback(() => {
        let vivo = true;
        fetchResumenDeCumplimiento().then(({ salas: s, error: e }) => {
            if (!vivo) return;
            setError(e ? mensajeDeCumplimiento(e) : null);
            setSalas(s);
        });
        return () => { vivo = false; };
    }, []);
    useEffect(() => cargar(), [cargar]);

    const porSala = useMemo(() => (salas || []).map((s) => {
        const p = pendientesDeSala(s, hoy, fechaTexto).filter((x) => pestanas.has(x.tab));
        const tono = p.some((x) => x.tono === 'danger') ? 'danger' : p.some((x) => x.tono === 'warning') ? 'warning' : p.length ? 'info' : 'success';
        return { id: s.branch_id, nombre: s.sala, cuantos: p.length, tono };
    }), [salas, hoy, pestanas]);

    const red = useMemo(() => pendientesDeLaRed(
        (salas || []).filter((s) => !soloSala || s.branch_id === soloSala), hoy, fechaTexto, pestanas,
    ), [salas, soloSala, hoy, pestanas]);

    if (!salas && !error) return <LoadingState label="Revisando cada sala…" />;
    if (error) return <Notice variant="danger">{error}</Notice>;
    if (salas.length === 0) return <EmptyState icon={ShieldCheck} title="Sin salas para revisar" />;

    const tocarSala = (g, x) => {
        // El reporte cero nace con el semestre que falta: es justo el que se está anotando.
        if (g.crea && puedeAnotar(g.tab)) setAnotando({ tipo: g.crea, branchId: x.branch_id, sala: x.sala, inicial: g.semestre ? { periodo: g.semestre } : null });
        else onIr(g.tab, x.branch_id);
    };
    const nombreSolo = porSala.find((s) => s.id === soloSala)?.nombre;

    return (
        <div className="space-y-6">
            {/* Las salas: cuánto le falta a cada una; tocar filtra. */}
            {porSala.length > 1 && (
                <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por sala">
                    {porSala.map((s) => {
                        const activa = soloSala === s.id;
                        return (
                            <button key={s.id} type="button" aria-pressed={activa}
                                onClick={() => setSoloSala(activa ? null : s.id)}
                                className={`inline-flex items-center gap-2 px-3 min-h-[var(--tap-min)] rounded-full border text-body-sm font-bold active:scale-[0.97] transition-colors ${activa
                                    ? 'bg-brand text-white border-brand'
                                    : 'bg-surface-card text-content-2 border-border-card hover:bg-surface-card-hover'}`}>
                                {s.tono === 'success'
                                    ? <CheckCircle2 size={14} className={activa ? '' : 'text-success'} aria-hidden />
                                    : <PuntoDeEstado tamano="md" className={activa ? 'bg-current' : PUNTO[s.tono]} />}
                                {s.nombre}
                                <span className={activa ? 'opacity-80' : 'text-content-3'}>{s.cuantos || 'al día'}</span>
                            </button>
                        );
                    })}
                </div>
            )}

            {red.grupos.length === 0 ? (
                <div data-surface="card" data-tono="success" className="p-6 flex items-center gap-3">
                    <CheckCircle2 size={22} className="text-success shrink-0" aria-hidden />
                    <p className="text-body text-content">
                        {nombreSolo ? `${nombreSolo} está al día` : 'Todas las salas están al día'} en lo que se lleva en el portal.
                    </p>
                </div>
            ) : (
                <ul className="space-y-3">
                    {red.grupos.map((g) => {
                        const anotable = g.crea && puedeAnotar(g.tab);
                        return (
                            <li key={g.clave} data-surface="card" data-tono={g.tono === 'danger' ? 'danger' : undefined} className="p-4 space-y-3">
                                <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                                    <PuntoDeEstado tamano="md" className={`mt-2 ${PUNTO[g.tono]}`} />
                                    <div className="min-w-0 flex-1">
                                        <p className="text-body font-bold text-content">{g.titulo}</p>
                                        <p className="text-body-sm text-content-3">
                                            {soloSala ? nombreSolo : g.salas.length === red.totalSalas
                                                ? 'Falta en todas las salas'
                                                : `Falta en ${g.salas.length} de ${red.totalSalas} salas`}
                                            {anotable && ' · toca una sala para anotarlo ahí mismo'}
                                        </p>
                                    </div>
                                    <Button variant="ghost" size="sm" icon={ArrowRight} className="max-sm:hidden"
                                        onClick={() => onIr(g.tab, soloSala || null)}>
                                        Ir a la pestaña
                                    </Button>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {g.salas.map((x) => (
                                        <button key={x.branch_id} type="button" onClick={() => tocarSala(g, x)}
                                            className="inline-flex items-center gap-2 px-3 min-h-[var(--tap-min)] rounded-full border border-border-card bg-surface-card text-body-sm text-content-2 hover:bg-surface-card-hover active:scale-[0.97] transition-colors">
                                            <span className="font-bold text-content">{x.sala}</span>
                                            {x.detalle && <Badge variant={TONO_BADGE[x.tono]} uppercase={false}>{x.detalle}</Badge>}
                                        </button>
                                    ))}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}

            {red.alDia.length > 0 && red.grupos.length > 0 && (
                <div className="space-y-2">
                    <p className="text-caption font-bold text-content-3">Al día {nombreSolo ? `en ${nombreSolo}` : 'en todas las salas'}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-2">
                        {red.alDia.map((t) => (
                            <span key={t} className="inline-flex items-center gap-1.5 text-body-sm text-content-2">
                                <CheckCircle2 size={14} className="text-success" aria-hidden />{t}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {anotando && (
                <Suspense fallback={null}>
                    <RegistroModal tipo={anotando.tipo} modo="crear" branchId={anotando.branchId} sala={anotando.sala} inicial={anotando.inicial}
                        onClose={() => setAnotando(null)}
                        onHecho={() => { setAnotando(null); cargar(); }} />
                </Suspense>
            )}
        </div>
    );
}
