import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarCheck, AlertTriangle, Check, Lock, Unlock, TrendingDown } from 'lucide-react';
import GlassViewLayout from '../../components/GlassViewLayout';
import CarrilCards from '../../components/common/CarrilCards';
import StatCard from '../../components/common/StatCard';
import Notice from '../../components/common/Notice';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import SegmentedControl from '../../components/common/SegmentedControl';
import { EmptyState, LoadingState } from '../../components/common/StateViews';
import PromptModal from '../../components/common/PromptModal';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import { formatMoney } from '../../utils/formatNumber';
import { mensajeAmigable } from '../../utils/errorMessages';
import { fetchPeriodosFiscales, cerrarPeriodoFiscal, reabrirPeriodoFiscal } from '../../data/cierrePeriodo';

/**
 * Cierre de período fiscal — la cadena del remanente.
 *
 * ── Qué resuelve ─────────────────────────────────────────────────────────
 * Dos cosas que hoy no ocurren:
 *
 *  1. **El remanente a favor no se arrastra** (Art. 67 LIVA). Cada mes se
 *     declara como si el anterior no hubiera existido.
 *  2. **El libro cambia después de declarado y nadie se entera.** Ya pasó dos
 *     veces: los sellos que llegaron el 2026-08-02 subieron el débito de mayo
 *     $27.23 y el de junio $5.29, después de presentadas. Sin una foto de lo
 *     declarado no hay contra qué comparar.
 *
 * ── El interruptor es la decisión de la pantalla ─────────────────────────
 * «El que se declara hoy» vs «El declarable» recalcula la cadena entera. La
 * diferencia no es cosmética: en julio 2026 el remanente pasa de $112.55 a
 * $1,302.31. Elegir cuál se presenta es de la contadora — la pantalla muestra
 * las dos y no decide.
 *
 * ── Los frenos los decide el servidor ────────────────────────────────────
 * `puede_cerrarse` y `motivo_no_puede` vienen del RPC. Las cuatro condiciones
 * viven en `cerrar_periodo_fiscal`; re-deducirlas acá sería la misma regla
 * escrita dos veces, y el día que una cambie la otra seguiría opinando.
 */

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const etiquetaMes = (iso) => {
    const [y, m] = String(iso).slice(0, 10).split('-').map(Number);
    return `${MESES[m - 1]} ${y}`;
};
const mesCorto = (iso) => MESES[Number(String(iso).slice(5, 7)) - 1];

// El saldo del período con el libro elegido. Es la MISMA fórmula que
// `cerrar_periodo_fiscal`, y por eso lo que se congela sale del servidor: acá
// sólo se previsualiza para que la cadena se pueda ver antes de decidir.
function saldoDe(p, usarDeclarable, entra) {
    const credito = Number(usarDeclarable ? p.credito_declarable : p.credito_fiscal) || 0;
    const saldo = Number(p.debito_fiscal || 0) - credito
        - Number(p.percepcion_pagada || 0) - Number(p.retencion_sufrida || 0) - entra;
    const r = Math.round(saldo * 100) / 100;
    return { credito, aPagar: r > 0 ? r : 0, remanente: r < 0 ? -r : 0 };
}

// ── Un eslabón de la cadena ─────────────────────────────────────────────────
function Eslabon({ fila, siguiente }) {
    const paga = fila.aPagar > 0;
    return (
        <div data-surface="card" className={`flex-1 min-w-[132px] p-3.5 flex flex-col gap-0.5
            ${fila.en_curso ? 'border-dashed' : ''}`}>
            <span className="text-caption font-black uppercase tracking-widest text-content-3">
                {mesCorto(fila.periodo)}{fila.en_curso ? ' · en curso' : ''}
            </span>
            <span className={`text-title-sm font-black tracking-tight tabular-nums leading-tight
                ${paga ? 'text-danger-text' : 'text-success-text'}`}>
                {formatMoney(paga ? fila.aPagar : fila.remanente)}
            </span>
            <span className={`text-micro font-black uppercase tracking-widest
                ${paga ? 'text-danger-text' : 'text-success-text'}`}>
                {paga ? 'a pagar' : 'a favor'}
            </span>
            <span className="text-caption text-content-3 tabular-nums mt-1">
                {fila.en_curso
                    ? 'todavía no se cierra'
                    : fila.remanente > 0 && siguiente
                        ? <>↓ pasa a {mesCorto(siguiente.periodo)}: <b className="text-success-text">{formatMoney(fila.remanente)}</b></>
                        : '↓ no pasa nada'}
            </span>
        </div>
    );
}

// ── Un período ──────────────────────────────────────────────────────────────
function Periodo({ fila, usarDeclarable, canEdit, busy, onCerrar, onReabrir }) {
    const paga = fila.aPagar > 0;
    const cerrado = fila.estado === 'cerrado';
    const deltaCred = Math.round((Number(fila.credito_declarable || 0) - Number(fila.credito_fiscal || 0)) * 100) / 100;
    const derivo = cerrado && (Math.abs(Number(fila.deriva_debito || 0)) > 0.005
                            || Math.abs(Number(fila.deriva_credito || 0)) > 0.005);

    const dato = (k, v, extra) => (
        <div data-surface="card" className={`px-3 py-2.5 ${extra ? 'ring-1 ring-brand/30' : ''}`}>
            <span className="block text-micro uppercase tracking-widest font-black text-content-3">{k}</span>
            <span className="block text-body-lg font-bold tabular-nums mt-0.5">{v}</span>
            {extra && <span className="block text-micro font-bold text-success-text tabular-nums mt-0.5">{extra}</span>}
        </div>
    );

    return (
        <article data-surface="card"
            className={`p-4 space-y-3 ${fila.en_curso ? 'border-dashed' : ''}
                ${cerrado ? 'border-l-[3px] border-l-success' : fila.puede_cerrarse ? 'border-l-[3px] border-l-brand' : 'opacity-75'}`}>

            <div className="flex items-start gap-3.5 flex-wrap">
                <div className="min-w-0">
                    <h4 className="text-body-lg font-black text-content">{etiquetaMes(fila.periodo)}</h4>
                    <p className="text-caption text-content-3 mt-0.5">
                        {cerrado
                            ? `Cerrado${fila.cerrado_por ? ` por ${fila.cerrado_por}` : ''}${fila.cerrado_at ? ` el ${String(fila.cerrado_at).slice(0, 10).split('-').reverse().join('/')}` : ''}`
                            : fila.en_curso ? 'En curso — se cierra cuando termine el mes' : 'Abierto · nunca se cerró'}
                    </p>
                </div>
                <Badge variant={cerrado ? 'success' : fila.en_curso ? 'neutral' : 'info'} size="sm">
                    {cerrado ? 'cerrado' : fila.en_curso ? 'en curso' : 'abierto'}
                </Badge>
                <div className="ml-auto text-right">
                    <span className={`block text-title font-black tracking-tight tabular-nums leading-tight
                        ${paga ? 'text-danger-text' : 'text-success-text'}`}>
                        {formatMoney(paga ? fila.aPagar : fila.remanente)}
                    </span>
                    <span className="text-micro uppercase tracking-widest font-black text-content-3">
                        {paga ? 'a pagar' : 'remanente a favor'}
                    </span>
                </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                {dato('Débito fiscal', formatMoney(fila.debito_fiscal))}
                {dato('Crédito fiscal', `− ${formatMoney(fila.credito)}`,
                    usarDeclarable && deltaCred !== 0 ? `+${formatMoney(deltaCred)} vs el de hoy` : null)}
                {dato('Percepción pagada', `− ${formatMoney(fila.percepcion_pagada)}`)}
                {dato('Retención sufrida', `− ${formatMoney(fila.retencion_sufrida)}`)}
                {dato('Remanente que entra', `− ${formatMoney(fila.entra)}`)}
            </div>

            {/* El primer período del portal arranca en cero por definición, no por
                cálculo. Sin decirlo, ese cero se lee como un resultado. */}
            {fila.es_inicial && (
                <Notice variant="warning" icon={AlertTriangle}>
                    <p className="text-body font-black text-content mb-1">
                        {etiquetaMes(fila.periodo)} es el primer mes que lleva el portal.
                    </p>
                    <p className="text-body-sm text-content-2">
                        Su remanente que entra es <b>cero por definición</b>, no un resultado: lo
                        anterior se declaró por fuera y no se reclama por esta vía.
                    </p>
                </Notice>
            )}

            {/* La deriva: para esto se congela. */}
            {derivo && (
                <Notice variant="danger" icon={TrendingDown}>
                    <p className="text-body font-black text-content mb-1">El libro se movió después de cerrarlo.</p>
                    <p className="text-body-sm text-content-2 tabular-nums">
                        Débito {formatMoney(fila.deriva_debito)} · Crédito {formatMoney(fila.deriva_credito)} respecto
                        de lo que se congeló. Si el período ya se presentó, esta diferencia no está declarada.
                    </p>
                </Notice>
            )}

            {canEdit && (
                <div className="flex flex-wrap items-center gap-2">
                    {cerrado ? (
                        <Button size="sm" variant="secondary" icon={Unlock} disabled={busy}
                            onClick={() => onReabrir(fila)}>
                            Reabrir
                        </Button>
                    ) : fila.puede_cerrarse ? (
                        <Button size="sm" icon={Check} disabled={busy} onClick={() => onCerrar(fila)}
                            title="Congela estas cifras con tu nombre y la fecha. El mes siguiente arranca del remanente que salga de aquí.">
                            Cerrar {mesCorto(fila.periodo)}
                        </Button>
                    ) : (
                        <>
                            <Button size="sm" icon={Lock} disabled>Cerrar {mesCorto(fila.periodo)}</Button>
                            <span className="text-body-sm text-content-3">{fila.motivo_no_puede}</span>
                        </>
                    )}
                </div>
            )}
        </article>
    );
}

// ── La vista ────────────────────────────────────────────────────────────────
export default function CierrePeriodoView() {
    const { hasPermission } = useAuth();
    const canEdit = hasPermission('libros_iva', 'can_edit');

    const [filas, setFilas] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [usarDeclarable, setUsarDeclarable] = useState(false);
    const [reabriendo, setReabriendo] = useState(null);   // la fila cuyo motivo se está pidiendo

    const cargar = useCallback(async () => {
        setLoading(true); setError('');
        try {
            setFilas(await fetchPeriodosFiscales());
        } catch (e) {
            setError(mensajeAmigable(e, 'No se pudo cargar el cierre de período'));
            setFilas([]);
        } finally { setLoading(false); }
    }, []);
    useEffect(() => { cargar(); }, [cargar]);

    // La cadena: cada mes arranca del remanente del anterior. Un mes CERRADO
    // conserva el suyo congelado —es lo que se declaró— y sólo los abiertos se
    // recalculan con el libro elegido.
    const cadena = useMemo(() => {
        let entra = 0;
        return filas.map(p => {
            const cerrado = p.estado === 'cerrado';
            const base = cerrado
                ? { credito: Number(p.cong_credito || 0),
                    aPagar: Number(p.cong_a_pagar || 0),
                    remanente: Number(p.cong_remanente_sale || 0) }
                : saldoDe(p, usarDeclarable, entra);
            const fila = { ...p, ...base, entra: cerrado ? Number(p.cong_entra || 0) : entra };
            if (!p.en_curso) entra = base.remanente;
            return fila;
        });
    }, [filas, usarDeclarable]);

    const totales = useMemo(() => {
        const cerrados = cadena.filter(f => f.estado === 'cerrado').length;
        const perdido = cadena
            .filter(f => !f.en_curso && f.estado !== 'cerrado' && f.remanente > 0)
            .reduce((s, f) => s + f.remanente, 0);
        return { cerrados, abiertos: cadena.filter(f => !f.en_curso && f.estado !== 'cerrado').length, perdido };
    }, [cadena]);

    const confirmarYCerrar = useCallback(async (fila) => {
        setBusy(true);
        try {
            await cerrarPeriodoFiscal(fila.periodo, null, null);
            useStaffStore.getState().appendAuditLog('CIERRE_PERIODO_CERRAR', fila.periodo, {
                debito: fila.debito_fiscal, credito: fila.credito,
                a_pagar: fila.aPagar, remanente: fila.remanente,
            });
            useToastStore.getState().showToast('Período cerrado',
                `${etiquetaMes(fila.periodo)} queda congelado. El mes siguiente arranca de ${formatMoney(fila.remanente)}.`, 'success');
            await cargar();
        } catch (e) {
            useToastStore.getState().showToast('No se pudo cerrar', mensajeAmigable(e, 'Intenta de nuevo.'), 'error');
        } finally { setBusy(false); }
    }, [cargar]);

    // El motivo lo exige el servidor. Se pide con el diálogo canónico y no con
    // `prompt()`: el nativo bloquea la pestaña entera y no se puede leer en
    // táctil, además de estar prohibido por el gate de diseño.
    const confirmarYReabrir = useCallback(async (motivo) => {
        const fila = reabriendo;
        if (!fila || !motivo?.trim()) return;
        setBusy(true);
        try {
            await reabrirPeriodoFiscal(fila.periodo, motivo.trim());
            useStaffStore.getState().appendAuditLog('CIERRE_PERIODO_REABRIR', fila.periodo, { motivo: motivo.trim() });
            useToastStore.getState().showToast('Período reabierto', `${etiquetaMes(fila.periodo)} vuelve a estar abierto.`, 'info');
            await cargar();
        } catch (e) {
            useToastStore.getState().showToast('No se pudo reabrir', mensajeAmigable(e, 'Intenta de nuevo.'), 'error');
        } finally { setBusy(false); setReabriendo(null); }
    }, [cargar, reabriendo]);

    return (
        <GlassViewLayout icon={CalendarCheck} title="Cierre de período">
            <div className="p-5 md:p-6 space-y-5">

                <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                    <CarrilCards className="flex-1" ariaLabel="Resumen del cierre">
                        <StatCard icon={Lock} label="Períodos cerrados" value={totales.cerrados}
                            sub={`${totales.abiertos} sin cerrar`} loading={loading} />
                        {totales.perdido > 0 && (
                            <StatCard icon={TrendingDown} label="Remanente sin arrastrar"
                                value={formatMoney(totales.perdido)}
                                sub="Se pierde si no se cierra" loading={loading} />
                        )}
                    </CarrilCards>
                    <div className="flex justify-end">
                        <SegmentedControl
                            label="Qué libro de compras usar"
                            size="sm"
                            value={usarDeclarable ? 'decl' : 'hoy'}
                            onChange={(v) => setUsarDeclarable(v === 'decl')}
                            options={[
                                { value: 'hoy',  label: 'El que se declara hoy' },
                                { value: 'decl', label: 'El declarable' },
                            ]}
                        />
                    </div>
                </div>

                {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}

                {loading ? <LoadingState label="Cargando los períodos…" />
                : cadena.length === 0 ? (
                    <EmptyState icon={CalendarCheck} title="Sin períodos"
                        subtitle="Falta configurar desde qué mes lleva el portal la contabilidad." />
                ) : (<>
                    <div>
                        <p className="text-label font-black uppercase tracking-widest text-content-2 mb-2.5">
                            El remanente, mes a mes
                        </p>
                        {/* overflow-x propio: la cadena crece un eslabón por mes y el
                            cuerpo de la vista nunca debe desplazarse en horizontal. */}
                        <div className="overflow-x-auto">
                            <div className="flex items-stretch gap-2 min-w-[640px]">
                                {cadena.map((f, i) => (
                                    <Eslabon key={f.periodo} fila={f} siguiente={cadena[i + 1]} />
                                ))}
                            </div>
                        </div>
                        {totales.perdido > 0 && (
                            <p className="text-body-sm text-content-2 max-w-[74ch] mt-2.5">
                                Hoy ese arrastre <b>no ocurre</b>: el mes siguiente se declara como si el
                                anterior no hubiera existido. Son <b>{formatMoney(totales.perdido)}</b> que se pierden.
                            </p>
                        )}
                    </div>

                    <div className="space-y-2.5">
                        {cadena.map(f => (
                            <Periodo key={f.periodo} fila={f} usarDeclarable={usarDeclarable}
                                canEdit={canEdit} busy={busy}
                                onCerrar={confirmarYCerrar} onReabrir={setReabriendo} />
                        ))}
                    </div>
                </>)}
            </div>

            <PromptModal
                isOpen={!!reabriendo}
                onClose={() => setReabriendo(null)}
                onConfirm={confirmarYReabrir}
                title={reabriendo ? `Reabrir ${etiquetaMes(reabriendo.periodo)}` : 'Reabrir período'}
                message="Vuelve a quedar abierto y sus cifras dejan de estar congeladas. El motivo queda en la bitácora del período."
                placeholder="Por qué se reabre"
                confirmText="Reabrir"
                isProcessing={busy}
                required
            />
        </GlassViewLayout>
    );
}
