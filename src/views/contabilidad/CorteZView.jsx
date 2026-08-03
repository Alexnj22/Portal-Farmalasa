import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Receipt, Download, AlertTriangle, FileText, Percent, Archive } from 'lucide-react';
import GlassViewLayout from '../../components/GlassViewLayout';
import ViewTabBar from '../../components/common/ViewTabBar';
import FilterBar from '../../components/common/FilterBar';
import PeriodStepper from '../../components/common/PeriodStepper';
import CarrilCards from '../../components/common/CarrilCards';
import StatCard from '../../components/common/StatCard';
import Notice from '../../components/common/Notice';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import LiquidTooltip from '../../components/common/LiquidTooltip';

import { useAuth } from '../../context/AuthContext';
import { formatMoney } from '../../utils/formatNumber';
import { mensajeAmigable } from '../../utils/errorMessages';
import { fetchCortesZ, fetchCorteZDias } from '../../data/corteZ';
import { descargarCorteZPdf, etiquetaPeriodo } from '../../utils/corteZPrint';

// ─────────────────────────────────────────────────────────────────────────────
// CORTE Z — el Gran Z mensual de cada sucursal.
//
// Lo que se muestra es **lo que declaró el sistema de origen**, no lo que
// calcularía el portal. Es un documento que la sucursal emite: lo que vale es lo
// que dijo. El número del portal va al lado, como COTEJO — y ahí es donde
// aparece lo que importa.
//
// El origen lo imprime en formato de ticket, en una tipografía de 40 columnas.
// Acá NO se replica ese formato: el ticket crudo se guarda y se puede abrir, y
// lo que se presenta son los números en una tarjeta por sucursal. Replicar el
// ticket sería copiar una limitación de la impresora, no un requisito del dato.
//
// Dos hallazgos del cotejo que la vista tiene que dejar ver (2026-08-03):
//   · El ticket puede contradecirse a sí mismo: su línea GRAVADAS y su línea
//     TOTAL difieren en Salud 3, y GRAVADAS coincide con el libro al centavo.
//   · El origen puede omitir una venta sellada: Salud 1 julio, $9.00.
// Por eso el cotejo se muestra SIEMPRE, cuadre o no.
// ─────────────────────────────────────────────────────────────────────────────

const mesActual = () => {
    const sv = new Date(Date.now() - 6 * 3600_000);
    return `${sv.getUTCFullYear()}-${String(sv.getUTCMonth() + 1).padStart(2, '0')}`;
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

// Medio centavo: por debajo de eso es ruido de coma flotante, no una diferencia.
const CUADRA = 0.005;
const cuadra = (n) => Math.abs(Number(n) || 0) < CUADRA;

// ── Una línea del cotejo ─────────────────────────────────────────────────────
const LineaCotejo = ({ rotulo, z, portal, dif }) => {
    const ok = cuadra(dif);
    return (
        <div className="flex items-baseline gap-3 py-1.5 border-b border-divider last:border-0">
            <span className="flex-1 min-w-0 text-caption text-content-2 truncate">{rotulo}</span>
            <span className="font-mono text-caption tabular-nums w-24 text-right">{formatMoney(z)}</span>
            <span className="font-mono text-caption tabular-nums w-24 text-right text-content-3">{formatMoney(portal)}</span>
            <span className={`font-mono text-caption tabular-nums w-20 text-right ${ok ? 'text-content-3' : 'font-bold'}`}>
                {ok ? '—' : formatMoney(dif)}
            </span>
        </div>
    );
};

// ── Una sección del ticket ───────────────────────────────────────────────────
//
// Se pintan las cinco líneas aunque vayan en cero: en el documento del origen
// están las cinco, y esconder una porque vale cero es decidir por quien lo lee
// que ese cero no importa. Lo que SÍ se marca es cuando `gravadas` y `total`
// discrepan — que no debería pasar nunca y en Salud 3 pasa.
const SeccionTicket = ({ titulo, datos = {} }) => {
    const discrepa = !cuadra((Number(datos.gravadas) || 0) - (Number(datos.total) || 0));
    return (
        <div className="min-w-0">
            <h4 className="text-caption font-semibold text-content-2 mb-1 truncate">{titulo}</h4>
            <dl className="space-y-0.5">
                {[
                    ['Exentas', datos.exentas, false],
                    ['Gravadas', datos.gravadas, discrepa],
                    ['No sujetas', datos.no_sujetas, false],
                    ['Retención', datos.retencion, false],
                ].map(([r, v, marcar]) => (
                    <div key={r} className="flex justify-between items-center gap-2 min-w-0">
                        <dt className="text-micro text-content-3 flex items-center gap-1 min-w-0">
                            <span className="truncate">{r}</span>
                            {/* El aviso va PEGADO a la cifra que discrepa, no en
                                el título: como badge de encabezado ocupaba más
                                ancho que la columna y partía la grilla de tres.
                                Y acá además es más preciso — la contradicción es
                                entre esta línea y el total, no de la sección. */}
                            {marcar && (
                                <LiquidTooltip content="El origen imprime esta línea distinta de su propio TOTAL. En el resto de las sucursales son iguales.">
                                    <AlertTriangle size={11} className="shrink-0 text-warning-text"
                                        aria-label="No coincide con el total de esta sección" />
                                </LiquidTooltip>
                            )}
                        </dt>
                        <dd className="font-mono text-micro tabular-nums text-content-2 shrink-0">{formatMoney(v)}</dd>
                    </div>
                ))}
                <div className="flex justify-between gap-2 pt-1 border-t border-divider">
                    <dt className="text-micro font-semibold text-content-2">Total</dt>
                    <dd className="font-mono text-caption tabular-nums font-bold shrink-0">{formatMoney(datos.total)}</dd>
                </div>
            </dl>
        </div>
    );
};

// ── Por qué difiere ──────────────────────────────────────────────────────────
//
// «Difiere $42.92» no sirve de nada si no dice de dónde sale. La diferencia se
// parte en dos sumandos que llevan a acciones OPUESTAS:
//
//   · lo que el Corte Z se contradice a sí mismo — su línea GRAVADAS contra su
//     línea TOTAL. No hay ningún documento que buscar: es un defecto del
//     reporte, y se le reclama al proveedor del sistema.
//   · el residuo — eso sí es un hueco de documentos y se persigue uno por uno.
//
// Medido el 2026-08-03: en Salud 3 la diferencia entera es del primer tipo
// (6.03 de 6.03 en junio, 42.92 de 42.92 en julio, residuo CERO). En Salud 1 es
// del segundo: contradicción 0.00 y residuo 9.00.
const PorQueDifiere = ({ fila, dias, cargandoDias, onVerDias }) => {
    const interna = Number(fila.contradiccion_interna) || 0;
    const residuo = Number(fila.residuo) || 0;

    return (
        <div className="rounded-xl border border-warning-border bg-warning-surface p-3 space-y-2">
            <h4 className="text-caption font-semibold flex items-center gap-1.5">
                <AlertTriangle size={13} aria-hidden="true" />
                Por qué difiere {formatMoney(Math.abs(fila.dif_total))}
            </h4>

            {!cuadra(interna) && (
                <p className="text-micro leading-relaxed">
                    <b>{formatMoney(interna)}</b> — el Corte Z <b>se contradice a sí mismo</b>:
                    imprime una cifra en «gravadas» y otra en «total». La de gravadas es la que
                    coincide con el libro. No hay documentos que buscar por esta parte.
                </p>
            )}

            {!cuadra(residuo) ? (
                <>
                    <p className="text-micro leading-relaxed">
                        <b>{formatMoney(residuo)}</b> — sin explicar. El libro tiene{' '}
                        {residuo > 0 ? 'más' : 'menos'} que el Corte Z, y el Corte Z es mensual:
                        no lista documentos. Para ubicarlo hay que comparar día por día contra el
                        reporte diario, y de ahí bajar al documento.
                        {!cuadra(fila.dif_ccf) && (
                            <> Ojo: parte de la diferencia está en los créditos fiscales
                            ({formatMoney(fila.dif_ccf)}), y esos se persiguen en el libro de
                            contribuyentes, que los lista uno por uno.</>
                        )}
                    </p>
                    {!dias && (
                        <Button size="sm" variant="secondary" onClick={onVerDias} disabled={cargandoDias}>
                            {cargandoDias ? 'Cargando…' : 'Ver día por día'}
                        </Button>
                    )}
                </>
            ) : (
                <p className="text-micro leading-relaxed">
                    <b>Sin residuo.</b> La diferencia se explica entera por la contradicción de
                    arriba — no falta ni sobra ningún documento.
                </p>
            )}

            {dias && (
                <div className="max-h-64 overflow-y-auto rounded-lg bg-surface-1">
                    {/* Solo ventas con factura: es lo que el reporte diario del
                        origen también lista, y mezclarle los créditos fiscales daba
                        rangos de control imposibles (dos series distintas). */}
                    <p className="px-2 pt-2 text-micro text-content-3">
                        Ventas con factura, día por día — para enfrentarlo al reporte diario.
                    </p>
                    <table className="w-full text-micro">
                        <thead className="sticky top-0 bg-surface-1">
                            <tr className="text-content-3 text-left">
                                <th className="px-2 py-1 font-semibold">Día</th>
                                <th className="px-2 py-1 font-semibold text-right">Docs</th>
                                <th className="px-2 py-1 font-semibold text-right">Total</th>
                                <th className="px-2 py-1 font-semibold">N.º de control</th>
                            </tr>
                        </thead>
                        <tbody>
                            {dias.map(d => (
                                <tr key={d.fecha} className="border-t border-divider">
                                    <td className="px-2 py-1 whitespace-nowrap">{d.fecha}</td>
                                    <td className="px-2 py-1 text-right tabular-nums">{d.documentos}</td>
                                    <td className="px-2 py-1 text-right font-mono tabular-nums">{formatMoney(d.total)}</td>
                                    <td className="px-2 py-1 font-mono text-content-3">
                                        {/* Solo el correlativo: el prefijo DTE-01-SxxxPxxx es
                                            igual en toda la columna y solo gasta ancho. */}
                                        {(d.numero_control_del || '—').slice(-9)} → {(d.numero_control_al || '—').slice(-9)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

// ── La tarjeta de una sucursal ───────────────────────────────────────────────
const TarjetaSucursal = ({ fila, onPdf, verTicket, onVerTicket, dias, cargandoDias, onVerDias }) => {
    const sec = fila.detalle?.secciones || {};
    const ok = cuadra(fila.dif_total);

    return (
        <section className="rounded-2xl border border-divider bg-surface-1 p-4 md:p-5 space-y-4">
            <header className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="text-body font-bold truncate">{fila.sucursal}</h3>
                    <p className="text-micro text-content-3">
                        Del {fila.fecha_inicio} al {fila.fecha_fin}
                    </p>
                </div>
                <Badge variant={ok ? 'success' : 'warning'} dot>
                    {ok ? 'Cuadra con el libro' : `Difiere ${formatMoney(Math.abs(fila.dif_total))}`}
                </Badge>
            </header>

            <div className="flex items-baseline justify-between gap-3 rounded-xl bg-surface-2 px-4 py-3">
                <span className="text-caption font-semibold text-content-2">TOTAL GENERAL</span>
                <span className="font-mono text-title tabular-nums font-black">
                    {formatMoney(fila.total_general)}
                </span>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
                <SeccionTicket titulo="Con tiquete"        datos={sec.tiquete} />
                <SeccionTicket titulo="Con factura"        datos={sec.factura} />
                <SeccionTicket titulo="Con crédito fiscal" datos={sec.ccf} />
            </div>

            <div>
                <div className="flex items-baseline gap-3 pb-1 border-b border-divider">
                    <span className="flex-1 text-micro font-semibold text-content-3 uppercase tracking-wide">
                        Cotejo contra el libro
                    </span>
                    <span className="text-micro text-content-3 w-24 text-right">Corte Z</span>
                    <span className="text-micro text-content-3 w-24 text-right">Libro</span>
                    <span className="text-micro text-content-3 w-20 text-right">Dif.</span>
                </div>
                <LineaCotejo rotulo="Ventas con factura" z={fila.factura_total}
                    portal={fila.portal_factura} dif={fila.dif_factura} />
                <LineaCotejo rotulo="Ventas con crédito fiscal" z={fila.ccf_total}
                    portal={fila.portal_ccf} dif={fila.dif_ccf} />
                <LineaCotejo rotulo="Total general" z={fila.total_general}
                    portal={fila.portal_total} dif={fila.dif_total} />
            </div>

            {!ok && (
                <PorQueDifiere fila={fila} dias={dias}
                    cargandoDias={cargandoDias} onVerDias={onVerDias} />
            )}

            <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="secondary" icon={FileText} onClick={() => onVerTicket(fila)}>
                    {verTicket ? 'Ocultar el original' : 'Ver el original'}
                </Button>
                <Button size="sm" variant="secondary" icon={Download} onClick={() => onPdf(fila)}>
                    PDF
                </Button>
            </div>

            {verTicket && (
                // El texto tal cual lo emitió el origen. Es la prueba: el día que
                // haya que defender una cifra, esto es lo que se muestra.
                <pre className="rounded-xl bg-surface-2 p-3 overflow-x-auto font-mono text-micro leading-tight text-content-2">
                    {fila.ticket}
                </pre>
            )}
        </section>
    );
};

export default function CorteZView() {
    const { getScope, user } = useAuth();


    const [mes, setMes] = useState(mesActual);
    const [filterBranch, setFilterBranch] = useState(
        getScope('corte_z') === 'BRANCH' ? String(user?.branchId || '') : '');
    const [filas, setFilas] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [abierto, setAbierto] = useState(null);   // branch_id con el ticket desplegado
    const [pdfeando, setPdfeando] = useState(false);
    // El desglose por día se pide BAJO DEMANDA y por sucursal: son ~31 filas
    // cada uno y solo hacen falta cuando alguien va a investigar un residuo.
    const [dias, setDias] = useState({});            // branch_id → filas
    const [cargandoDias, setCargandoDias] = useState(null);

    const [desde, hasta] = useMemo(() => rangoDelMes(mes), [mes]);

    const cargar = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            setFilas(await fetchCortesZ(desde, hasta, filterBranch));
            setDias({});   // el desglose es del período viejo: no sirve para el nuevo
        } catch (e) {
            setError(mensajeAmigable(e, 'No se pudo cargar el Corte Z'));
            setFilas([]);
        } finally {
            setLoading(false);
        }
    }, [desde, hasta, filterBranch]);

    useEffect(() => { cargar(); }, [cargar]);

    // Las sucursales que TIENEN Corte Z del período, no el catálogo entero: si
    // una no se trajo, ofrecerla como filtro promete un dato que no existe.
    // El nombre sale del RPC (ya viene resuelto), no de `branches`.
    const branchOptions = useMemo(
        () => filas.map(f => ({ value: String(f.branch_id), label: f.sucursal })),
        [filas]);

    const totales = useMemo(() => {
        let total = 0, factura = 0, ccf = 0, difieren = 0;
        for (const f of filas) {
            total   += Number(f.total_general) || 0;
            factura += Number(f.factura_total) || 0;
            ccf     += Number(f.ccf_total) || 0;
            if (!cuadra(f.dif_total)) difieren++;
        }
        return { total, factura, ccf, difieren, sucursales: filas.length };
    }, [filas]);

    const verDias = useCallback(async (fila) => {
        setCargandoDias(fila.branch_id);
        try {
            const filas = await fetchCorteZDias(fila.branch_id, fila.periodo);
            setDias(d => ({ ...d, [fila.branch_id]: filas }));
        } catch (e) {
            setError(mensajeAmigable(e, 'No se pudo cargar el desglose por día'));
        } finally {
            setCargandoDias(null);
        }
    }, []);

    const pdfDe = useCallback(async (fila) => {
        setPdfeando(true);
        try {
            await descargarCorteZPdf([fila],
                `corte-z_${mes}_${String(fila.sucursal).replace(/\s+/g, '-')}.pdf`);
        } catch (e) {
            setError(mensajeAmigable(e, 'No se pudo generar el PDF'));
        } finally {
            setPdfeando(false);
        }
    }, [mes]);

    const pdfTodas = useCallback(async () => {
        setPdfeando(true);
        try {
            await descargarCorteZPdf(filas, `corte-z_${mes}_todas-las-sucursales.pdf`);
        } catch (e) {
            setError(mensajeAmigable(e, 'No se pudo generar el PDF'));
        } finally {
            setPdfeando(false);
        }
    }, [filas, mes]);

    const puedeElegirSucursal = getScope('corte_z') !== 'BRANCH';

    const barraFiltros = (
        <FilterBar
            onClear={() => { setFilterBranch(''); setMes(mesActual()); }}
            activeCount={[filterBranch, mes !== mesActual()].filter(Boolean).length}
            acciones={[{
                key: 'pdf-todas',
                icon: Archive,
                // Rótulo constante: `FilterBar` mide la fila con los rótulos de
                // las acciones, así que cambiarlo mientras trabaja hace
                // parpadear la píldora (el defecto de v2.349.1).
                label: 'PDF de todas',
                title: `Descargar el Corte Z de ${etiquetaPeriodo(desde)} de las ${filas.length} sucursales en un PDF, una por hoja`,
                onClick: pdfTodas,
                disabled: loading || pdfeando || filas.length === 0,
            }]}>
            {puedeElegirSucursal && branchOptions.length > 0 && (
                <FilterBar.Section active={!!filterBranch} onClear={() => setFilterBranch('')} label="sucursal">
                    <FilterBar.Sucursal value={filterBranch}
                        onChange={val => setFilterBranch(val || '')} options={branchOptions} />
                </FilterBar.Section>
            )}
            <FilterBar.Section active={mes !== mesActual()} onClear={() => setMes(mesActual())} label="período">
                <PeriodStepper
                    unit="mes"
                    label={etiquetaPeriodo(desde)}
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
            icon={Receipt}
            title="Corte Z"
            filtersContent={<ViewTabBar tabs={[{ key: 'z', label: 'Corte Z' }]} activeTab="z" onTabChange={() => {}} />}
            transparentBody={true}
        >
            <div className="p-5 md:p-6 space-y-5">
                <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                    <CarrilCards className="flex-1" ariaLabel="Resumen del Corte Z">
                        <StatCard icon={Receipt} label="Sucursales" value={totales.sucursales}
                            sub={totales.difieren ? `${totales.difieren} con diferencia` : 'Todas cuadran'}
                            loading={loading} />
                        <StatCard icon={FileText} label="Total general" value={formatMoney(totales.total)}
                            sub="Del período" loading={loading} />
                        <StatCard icon={Percent} label="Crédito fiscal" value={formatMoney(totales.ccf)}
                            sub="Ventas con CCF" loading={loading} />
                    </CarrilCards>
                    <div className="flex justify-end min-w-0">{barraFiltros}</div>
                </div>

                {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}

                <Notice variant="info" icon={Receipt} compact>
                    Lo que declaró cada sucursal en su Corte Z mensual, tal como lo emitió.
                    Al lado va el mismo número calculado desde las facturas selladas por
                    Hacienda, para cotejarlo. El período se cierra solo el día 1 del mes
                    siguiente.
                </Notice>

                {!loading && totales.difieren > 0 && (
                    <Notice variant="warning" icon={AlertTriangle}>
                        <b>{totales.difieren}</b> sucursal(es) con diferencia contra el libro.
                        Revisa el cotejo de cada tarjeta antes de presentar: la diferencia puede
                        estar en el Corte Z y no en el libro.
                    </Notice>
                )}

                {loading ? (
                    <div className="grid gap-4 xl:grid-cols-2">
                        {[0, 1].map(i => (
                            <div key={i} className="h-64 rounded-2xl border border-divider bg-surface-1 animate-pulse" />
                        ))}
                    </div>
                ) : filas.length === 0 ? (
                    // El vacío se explica: un mes que todavía no se procesó y un
                    // fallo de la consulta se ven igual, y confundirlos es lo que
                    // haría dar por bueno un período que nadie trajo.
                    <div className="rounded-2xl border border-divider bg-surface-1 p-10 text-center space-y-2">
                        <Receipt className="mx-auto text-content-3" size={28} aria-hidden="true" />
                        <p className="text-body font-semibold">
                            Sin Corte Z de {etiquetaPeriodo(desde)}
                        </p>
                        <p className="text-caption text-content-3 max-w-md mx-auto">
                            {mes >= mesActual()
                                ? 'El mes en curso todavía no se cierra. El Corte Z se trae el día 1 del mes siguiente, cuando el período ya no cambia.'
                                : 'Este período no se ha traído todavía. No es un mes sin ventas: es que nadie lo procesó.'}
                        </p>
                    </div>
                ) : (
                    <div className="grid gap-4 xl:grid-cols-2">
                        {filas.map(f => (
                            <TarjetaSucursal
                                key={`${f.branch_id}-${f.periodo}`}
                                fila={f}
                                onPdf={pdfDe}
                                verTicket={abierto === f.branch_id}
                                onVerTicket={() => setAbierto(a => (a === f.branch_id ? null : f.branch_id))}
                                dias={dias[f.branch_id]}
                                cargandoDias={cargandoDias === f.branch_id}
                                onVerDias={() => verDias(f)}
                            />
                        ))}
                    </div>
                )}
            </div>
        </GlassViewLayout>
    );
}
