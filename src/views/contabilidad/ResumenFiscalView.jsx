// ─────────────────────────────────────────────────────────────────────────────
// Resumen Fiscal — el movimiento del mes, en un número por concepto.
//
// Consolida lo que ya está repartido en las pestañas de Libros IVA (débito,
// crédito, percepción, retención, notas) y agrega el pago a cuenta, que no vivía
// en ninguna pantalla.
//
// **Es un indicador, no una declaración**, y la pantalla lo dice. Le falta a
// propósito una línea que el portal no puede saber: el saldo a favor que viene
// del mes anterior. El impuesto es encadenado y ese saldo sólo existe en lo que
// se declaró, que hoy no se guarda en ningún lado. Por eso esto da el
// MOVIMIENTO del mes y nunca el SALDO a pagar.
//
// Las dos tasas salen de la ley y su fundamento viaja en el propio dato que
// devuelve el servidor (`fundamento`), para que no haya un número mágico en el
// frontend: 1.75% de pago a cuenta (Art. 151 CT) y 2% de anticipo sobre cobros
// con tarjeta (Art. 162-A CT). El segundo va **aparte y marcado como estimado**:
// lo retiene el procesador de la tarjeta, no la farmacia, así que el portal sabe
// cuánto se cobró con tarjeta pero no puede ver la liquidación.
//
// NOTA DE ESTRUCTURA: mismo shell que `LibroComprasCompletoView`, que es la
// vista hermana y la que está probada. Si hay que cambiar algo, mirar primero
// cómo lo hace la de al lado.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Calculator, AlertTriangle, Percent, TrendingUp, TrendingDown, CreditCard, Landmark } from 'lucide-react';
import GlassViewLayout from '../../components/GlassViewLayout';
import FilterBar from '../../components/common/FilterBar';
import PeriodStepper from '../../components/common/PeriodStepper';
import CarrilCards from '../../components/common/CarrilCards';
import StatCard from '../../components/common/StatCard';
import Notice from '../../components/common/Notice';
import { useStaffStore } from '../../store/staffStore';
import { useAuth } from '../../context/AuthContext';
import { formatMoney } from '../../utils/formatNumber';
import { mensajeAmigable } from '../../utils/errorMessages';
import { fetchResumenFiscal } from '../../data/resumenFiscal';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const mesActual = () => {
    const sv = new Date(Date.now() - 6 * 3600_000);
    return `${sv.getUTCFullYear()}-${String(sv.getUTCMonth() + 1).padStart(2, '0')}`;
};
const etiquetaMes = (mes) => {
    const [y, m] = mes.split('-').map(Number);
    return `${MESES[m - 1]} ${y}`;
};
const rangoDelMes = (mes) => {
    const [y, m] = mes.split('-').map(Number);
    const fin = new Date(y, m, 0).getDate();
    return [`${mes}-01`, `${mes}-${String(fin).padStart(2, '0')}`];
};
const correrMes = (mes, delta) => {
    const [y, m] = mes.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const pct = (t) => `${(Number(t || 0) * 100).toFixed(2).replace(/\.?0+$/, '')}%`;

// Una fila del desglose. `signo` es lo que se muestra, no una operación: el
// servidor ya mandó el movimiento calculado, y acá sólo se explica cómo llegó.
function Linea({ etiqueta, detalle, monto, signo, fuerte }) {
    return (
        <div className={`flex items-baseline justify-between gap-4 py-2 ${fuerte ? 'border-t border-divider pt-3 mt-1' : ''}`}>
            <div className="min-w-0">
                <p className={`truncate ${fuerte ? 'text-body-sm font-black text-content' : 'text-body-sm text-content-2'}`}>
                    {etiqueta}
                </p>
                {detalle && <p className="text-caption text-content-3 truncate">{detalle}</p>}
            </div>
            <p className={`shrink-0 tabular-nums ${fuerte ? 'text-body font-black text-content' : 'text-body-sm font-semibold text-content-2'}`}>
                {signo}{formatMoney(Math.abs(Number(monto || 0)))}
            </p>
        </div>
    );
}

export default function ResumenFiscalView() {
    const { getScope } = useAuth();
    const branches = useStaffStore(s => s.branches);

    const [mes, setMes]           = useState(mesActual());
    const [filterBranch, setFB]   = useState('');
    const [datos, setDatos]       = useState(null);
    const [loading, setLoading]   = useState(true);
    const [error, setError]       = useState('');

    const puedeElegirSucursal = getScope('resumen_fiscal') === 'ALL';

    const branchOptions = useMemo(
        () => (branches || []).map(b => ({ value: String(b.id), label: b.name })),
        [branches]);

    const cargar = useCallback(async () => {
        setLoading(true);
        setError('');
        const [desde, hasta] = rangoDelMes(mes);
        const { data, error: err } = await fetchResumenFiscal(desde, hasta, filterBranch || null);
        if (err) {
            setError(mensajeAmigable(err));
            setDatos(null);
        } else if (data?.error === 'FORBIDDEN') {
            setError('No tienes permiso para ver el resumen fiscal.');
            setDatos(null);
        } else {
            setDatos(data);
        }
        setLoading(false);
    }, [mes, filterBranch]);

    // eslint-disable-next-line react-hooks/set-state-in-effect -- `cargar` enciende el skeleton antes de pedir el resumen; es carga inicial y re-fetch al cambiar mes/sucursal
    useEffect(() => { cargar(); }, [cargar]);

    const v   = datos?.ventas ?? {};
    const c   = datos?.compras ?? {};
    const pac = datos?.pago_a_cuenta ?? {};
    const tar = datos?.anticipo_tarjeta ?? {};

    const movimiento = Number(datos?.movimiento_iva ?? 0);
    const aFavor     = movimiento < 0;

    const barraFiltros = (
        <FilterBar
            onClear={() => { setFB(''); setMes(mesActual()); }}
            activeCount={[filterBranch, mes !== mesActual()].filter(Boolean).length}>
            {puedeElegirSucursal && branchOptions.length > 0 && (
                <FilterBar.Section active={!!filterBranch} onClear={() => setFB('')} label="sucursal">
                    <FilterBar.Sucursal value={filterBranch}
                        onChange={val => setFB(val || '')} options={branchOptions} />
                </FilterBar.Section>
            )}
            <FilterBar.Section active={mes !== mesActual()} onClear={() => setMes(mesActual())} label="período">
                <PeriodStepper
                    unit="mes"
                    label={etiquetaMes(mes)}
                    onPrev={() => setMes(m => correrMes(m, -1))}
                    onNext={() => setMes(m => correrMes(m, 1))}
                    nextDisabled={mes >= mesActual()}
                    onReset={() => setMes(mesActual())}
                    isCurrent={mes === mesActual()}
                    resetLabel="Ir al mes actual"
                />
            </FilterBar.Section>
        </FilterBar>
    );

    return (
        <GlassViewLayout
            icon={Calculator}
            title="Resumen fiscal"
            transparentBody={true}
        >
            <div className="p-5 md:p-6 space-y-5">
                <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                    <CarrilCards className="flex-1" ariaLabel="Movimiento del período">
                        <StatCard
                            icon={aFavor ? TrendingDown : TrendingUp}
                            label="Movimiento de IVA"
                            value={formatMoney(Math.abs(movimiento))}
                            sub={aFavor ? 'A favor, antes del saldo anterior' : 'A pagar, antes del saldo anterior'}
                            loading={loading} />
                        <StatCard
                            icon={Landmark}
                            label="Pago a cuenta"
                            value={formatMoney(pac.monto)}
                            sub={`${pct(pac.tasa)} sobre las ventas del mes`}
                            loading={loading} />
                        <StatCard
                            icon={CreditCard}
                            label="Anticipo por tarjeta"
                            value={formatMoney(tar.monto)}
                            sub={`${pct(tar.tasa)} de lo cobrado con tarjeta · estimado`}
                            loading={loading} />
                    </CarrilCards>
                    <div className="flex justify-end min-w-0">{barraFiltros}</div>
                </div>

                {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}

                {/* El aviso va antes del desglose a propósito: quien abra esto
                    tiene que leer qué NO es antes de leer los números. */}
                <Notice variant="warning" icon={AlertTriangle}>
                    <b>Es un indicador, no una declaración.</b> No incluye el saldo a favor
                    que viene del mes anterior, porque el portal no guarda todavía lo que se
                    declaró cada mes. Tampoco decide qué compras dan derecho a crédito: eso
                    depende de que el gasto sea indispensable para el giro.
                </Notice>

                {!loading && datos && (
                    <div data-surface="card" className="rounded-2xl border border-divider p-5 md:p-6">
                        <p className="text-caption font-black text-content-2 uppercase tracking-wider mb-2">
                            Cómo se llega ahí
                        </p>

                        <Linea etiqueta="Débito fiscal — ventas del mes"
                            detalle={`${v.documentos ?? 0} documentos con sello`}
                            monto={v.debito_fiscal} signo="+" />
                        <Linea etiqueta="Crédito fiscal — compras registradas"
                            detalle={`${c.documentos_registrados ?? 0} compras`}
                            monto={c.credito_registrado} signo="−" />
                        <Linea etiqueta="Crédito fiscal — documentos sin registrar"
                            detalle={`${c.documentos_sin_registrar ?? 0} llegaron del proveedor y no están como compra`}
                            monto={c.credito_sin_registrar} signo="−" />
                        <Linea etiqueta="Notas de débito"
                            detalle={`${c.notas_debito_docs ?? 0} documentos`}
                            monto={c.notas_debito_iva} signo="−" />
                        <Linea etiqueta="Notas de crédito"
                            detalle={`${c.notas_credito_docs ?? 0} documentos — reducen el crédito`}
                            monto={c.notas_credito_iva} signo="+" />
                        <Linea etiqueta="Percepción pagada a proveedores"
                            detalle="Anticipo que se acredita"
                            monto={c.percepcion_pagada} signo="−" />
                        <Linea etiqueta="Retención que le hicieron a la empresa"
                            detalle="Anticipo que se acredita"
                            monto={v.retencion_recibida} signo="−" />

                        <Linea
                            etiqueta={aFavor ? 'Movimiento del mes — a favor' : 'Movimiento del mes — a pagar'}
                            monto={movimiento} signo="" fuerte />
                    </div>
                )}

                {!loading && datos && (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div data-surface="card" className="rounded-2xl border border-divider p-5">
                            <div className="flex items-center gap-2 mb-2">
                                <Landmark size={16} className="text-content-3" />
                                <p className="text-body-sm font-black text-content">Pago a cuenta</p>
                            </div>
                            <p className="text-heading font-black text-content tabular-nums">{formatMoney(pac.monto)}</p>
                            <p className="text-caption text-content-3 mt-1">
                                {pct(pac.tasa)} sobre {formatMoney(pac.base)} de ventas del mes.
                                Se paga <b>siempre</b>, no depende del IVA. {pac.fundamento}.
                            </p>
                        </div>

                        <div data-surface="card" className="rounded-2xl border border-divider p-5">
                            <div className="flex items-center gap-2 mb-2">
                                <CreditCard size={16} className="text-content-3" />
                                <p className="text-body-sm font-black text-content">Anticipo por tarjeta</p>
                            </div>
                            <p className="text-heading font-black text-content tabular-nums">{formatMoney(tar.monto)}</p>
                            <p className="text-caption text-content-3 mt-1">
                                {pct(tar.tasa)} de {formatMoney(tar.base)} cobrados con tarjeta. Lo retiene
                                el procesador, así que <b>aquí es estimado</b>: se confirma en el estado de
                                cuenta. {tar.fundamento}.
                            </p>
                        </div>
                    </div>
                )}

                <Notice variant="info" icon={Percent} compact>
                    Las dos declaraciones se presentan dentro de los <b>primeros diez días
                    hábiles</b> del mes siguiente.
                </Notice>
            </div>
        </GlassViewLayout>
    );
}
