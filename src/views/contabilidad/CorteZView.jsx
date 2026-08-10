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
//   · La línea GRAVADAS y la línea TOTAL del ticket difieren en Salud 3 por la
//     RETENCIÓN, que el ticket imprime al lado y resta. Desde el 2026-08-04 el
//     libro la tiene documento por documento, así que la resta se verifica de
//     los dos lados en vez de aceptarse del ticket.
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
//
// El cotejo son cuatro columnas —el rótulo y tres cifras— y en el teléfono NO
// caben. Medido el 2026-08-09 en WebKit iPhone 13: las tres cifras pedían
// `6rem + 6rem + 5rem` más tres separaciones = **308px fijos**, y la tarjeta
// sólo tiene 316px útiles a 390px de ancho (390 − 40 del margen de la vista −
// 32 del relleno de la tarjeta). El rótulo no podía bajar de su palabra más
// larga, así que la tarjeta se plantaba en **471px dentro de una pista de
// 334px** y arrastraba la vista entera fuera de la pantalla: 333 elementos
// desbordando y scroll lateral en toda la página.
//
// La salida NO es encoger el rótulo hasta la elipsis —eso esconde el dato en
// vez de mostrarlo—, sino cambiar la FORMA en el teléfono: una sola grilla,
// dos plantillas. Abajo de `md:` el rótulo toma su propia línea y las tres
// cifras van debajo en tres columnas iguales; de `md:` en adelante vuelve la
// fila de cuatro columnas, idéntica a la de siempre.
//
// Las dos plantillas las comparten la cabecera y las líneas, que es lo que
// mantiene las cifras alineadas entre filas — sin eso un cotejo no se puede
// leer. Y las columnas del teléfono son `minmax(0,1fr)` (vía `grid-cols-3`):
// su mínimo es 0, así que ninguna cifra puede volver a empujar la tarjeta.
const GRILLA_COTEJO = 'grid grid-cols-3 md:grid-cols-[minmax(0,1fr)_6rem_6rem_5rem] '
                    + 'gap-x-3 gap-y-0.5 items-baseline';

const LineaCotejo = ({ rotulo, z, portal, dif }) => {
    const ok = cuadra(dif);
    return (
        <div className={`${GRILLA_COTEJO} py-1.5 border-b border-divider last:border-0`}>
            <span className="col-span-3 md:col-span-1 min-w-0 text-caption text-content-2 truncate">{rotulo}</span>
            <span className="font-mono text-caption tabular-nums text-right">{formatMoney(z)}</span>
            <span className="font-mono text-caption tabular-nums text-right text-content-3">{formatMoney(portal)}</span>
            <span className={`font-mono text-caption tabular-nums text-right ${ok ? 'text-content-3' : 'font-bold'}`}>
                {ok ? '—' : formatMoney(dif)}
            </span>
        </div>
    );
};

// ── Una sección del ticket ───────────────────────────────────────────────────
//
// Se pintan las cinco líneas aunque vayan en cero: en el documento del origen
// están las cinco, y esconder una porque vale cero es decidir por quien lo lee
// que ese cero no importa.
//
// `TOTAL = GRAVADAS − RETENCIÓN`, y se cumple en las 12 filas cargadas con
// desviación cero. Una versión anterior marcaba `gravadas ≠ total` como si el
// ticket se contradijera; lo corrigió el usuario mirando la tarjeta —la resta
// estaba a la vista— y la marca se retiró: no había nada que marcar.
const SeccionTicket = ({ titulo, datos = {} }) => (
    <div className="min-w-0">
        <h4 className="text-caption font-semibold text-content-2 mb-1 truncate">{titulo}</h4>
        <dl className="space-y-0.5">
            {[
                ['Exentas', datos.exentas],
                ['Gravadas', datos.gravadas],
                ['No sujetas', datos.no_sujetas],
                ['Retención', datos.retencion],
            ].map(([r, v]) => (
                <div key={r} className="flex justify-between items-center gap-2 min-w-0">
                    <dt className="text-micro text-content-3 truncate">{r}</dt>
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

// ── Por qué difiere ─────────────────────────────────────────────────────────
//
// «Difiere $9.00» no sirve de nada si no dice de dónde sale.
//
// Antes de llegar acá ya se descontó la RETENCIÓN: el Corte Z declara el total
// NETO (`TOTAL = GRAVADAS − RETENCIÓN`) y `sales_invoices.total` es el BRUTO,
// así que compararlos de frente inventaba una diferencia que no existía —
// Salud 3 aparecía con $42.92 y en realidad cuadraba. Lo que llega hasta este
// panel es el residuo REAL: documentos que un lado tiene y el otro no.
// Qué significa cada causa que encontró el cuadre diario, y qué hacer con ella.
// El texto es de negocio: quien lee esto está armando una declaración, no
// depurando un sync.
const CAUSAS = {
    // «El sistema perdió…» se leía como si el portal fuera el que la perdió, que
    // es justo al revés. Se dice el HECHO —la venta ya no está registrada— sin
    // atribuirlo, que además es la regla de no nombrar de dónde viene el dato.
    origen_perdio_fila: {
        que: 'Venta que ya no está registrada',
        hacer: 'Tiene sello de Hacienda y sigue siendo válida, pero su registro se perdió. Volver a traerla no la recupera: hay que reportarlo para que la restauren.',
    },
    anulado_sin_invalidar: {
        que: 'Venta anulada que nunca se invalidó ante Hacienda',
        hacer: 'Tiene sello y no está en el anexo de anulados, así que para Hacienda sigue vigente. Hay que invalidarla como corresponde, o el libro tiene que llevarla.',
    },
    falta_en_portal: {
        que: 'Falta esta venta',
        hacer: 'Se recupera volviendo a traer ese día.',
    },
    sin_sello: {
        que: 'Todavía sin el sello de Hacienda',
        hacer: 'Sin sello no entra al libro. Se resuelve solo cuando el sello llega.',
    },
    anulado: {
        que: 'Documento anulado',
        hacer: 'El libro lo excluye con razón.',
    },
    dte_inexistente: {
        que: 'El documento no existe en Hacienda',
        hacer: 'Hay que revisarlo: el libro no puede llevar una venta sin documento.',
    },
    monto_distinto: {
        que: 'El monto no coincide',
        hacer: 'Se corrige volviendo a traer ese día.',
    },
    sin_clasificar: {
        que: 'Sin causa determinada',
        hacer: 'Hay que revisarlo a mano.',
    },
};

const PorQueDifiere = ({ fila, dias, cargandoDias, onVerDias }) => {
    const residuo = Number(fila.residuo) || 0;
    // El cuadre diario ya bajó al documento y guardó la causa. Antes esto
    // mandaba a comparar día por día A MANO contra el reporte del origen —
    // que es exactamente lo que se automatizó (2026-08-03).
    const hallazgos = Array.isArray(fila.hallazgos) ? fila.hallazgos : [];
    const docs = hallazgos.flatMap(h => (h.documentos ?? []).map(d => ({ ...d, fecha: h.fecha })));
    const sinExplicar = hallazgos.reduce((s, h) => s + Math.abs(Number(h.sin_explicar) || 0), 0);

    return (
        <div className="rounded-card border bg-warning/10 border-warning/30 text-warning-text p-3 space-y-2">
            <h4 className="text-caption font-semibold flex items-center gap-1.5">
                <AlertTriangle size={13} aria-hidden="true" />
                Por qué difiere {formatMoney(Math.abs(residuo))}
            </h4>

            {docs.length > 0 ? (
                <div className="space-y-1.5">
                    {docs.map(d => {
                        const c = CAUSAS[d.causa] || CAUSAS.sin_clasificar;
                        return (
                            <div key={`${d.fecha}-${d.erp_invoice_id}`}
                                 className="rounded-card bg-surface-card-hover border border-divider p-2">
                                <div className="flex items-baseline justify-between gap-2">
                                    <span className="text-micro font-semibold text-content">{c.que}</span>
                                    <span className="font-mono text-micro tabular-nums font-bold shrink-0 text-content">
                                        {formatMoney(Math.abs(Number(d.impacto) || 0))}
                                    </span>
                                </div>
                                <p className="text-micro text-content-3 mt-0.5">
                                    {d.fecha} · documento {d.correlativo || d.erp_invoice_id}
                                </p>
                                <p className="text-micro text-content-2 mt-1 leading-relaxed">{c.hacer}</p>
                            </div>
                        );
                    })}
                    {sinExplicar >= CUADRA && (
                        // Lo que las causas NO explican se dice. Un diagnóstico que
                        // declara «ya está» sobre una diferencia todavía abierta es
                        // peor que no diagnosticar.
                        <p className="text-micro leading-relaxed">
                            Quedan <b>{formatMoney(sinExplicar)}</b> sin explicar: hay que revisarlos
                            a mano contra el reporte del día.
                        </p>
                    )}
                </div>
            ) : (
                <p className="text-micro leading-relaxed">
                    El libro tiene <b>{residuo > 0 ? 'más' : 'menos'}</b> que el Corte Z, y ya está
                    descontada la retención. Todavía no hay un diagnóstico de este período — se
                    genera con el cuadre diario, que corre cada mañana.
                    {!cuadra(fila.dif_ccf) && (
                        <> Parte de la diferencia está en los créditos fiscales
                        ({formatMoney(fila.dif_ccf)}), y esos se persiguen en el libro de
                        contribuyentes, que los lista uno por uno.</>
                    )}
                </p>
            )}

            {!dias && (
                <Button size="sm" variant="secondary" onClick={onVerDias} disabled={cargandoDias}>
                    {cargandoDias ? 'Cargando…' : 'Ver día por día'}
                </Button>
            )}

            {dias && (
                <div className="max-h-64 overflow-y-auto rounded-card bg-surface-card-hover border border-divider">
                    <p className="px-2 pt-2 text-micro text-content-3">
                        Ventas con factura, día por día — para enfrentarlo al reporte diario.
                    </p>
                    <table className="w-full text-micro">
                        <thead className="sticky top-0 bg-surface-modal">
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
        <section data-surface="card" className="flex flex-col p-4 md:p-5 gap-4">
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

            <div className="flex items-baseline justify-between gap-3 rounded-card bg-surface-card-hover border border-divider px-4 py-3">
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
                {/* La misma grilla que `LineaCotejo`: los tres rótulos de
                    columna tienen que caer sobre sus cifras en los dos
                    tamaños, también cuando en el teléfono bajan de línea. */}
                <div className={`${GRILLA_COTEJO} pb-1 border-b border-divider`}>
                    <span className="col-span-3 md:col-span-1 text-micro font-semibold text-content-3 uppercase tracking-wide">
                        Cotejo contra el libro
                    </span>
                    <span className="text-micro text-content-3 text-right">Corte Z</span>
                    <span className="text-micro text-content-3 text-right">Libro</span>
                    <span className="text-micro text-content-3 text-right">Dif.</span>
                </div>
                <LineaCotejo rotulo="Ventas con factura" z={fila.factura_total}
                    portal={fila.portal_factura} dif={fila.dif_factura} />
                <LineaCotejo rotulo="Ventas con crédito fiscal" z={fila.ccf_total}
                    portal={fila.portal_ccf} dif={fila.dif_ccf} />
                {/* La retención ya no se acepta del ticket: el libro la tiene
                    documento por documento, así que va como una línea más y con
                    su diferencia. Antes era el único número del cotejo que salía
                    de un solo lado — se le restaba al portal para que las otras
                    líneas cuadraran, y nadie podía verificar la resta. */}
                {(!cuadra(fila.retencion) || !cuadra(fila.portal_retencion)) && (
                    <LineaCotejo rotulo="Retención de IVA" z={fila.retencion}
                        portal={fila.portal_retencion} dif={fila.dif_retencion} />
                )}
                <LineaCotejo rotulo="Total general" z={fila.total_general}
                    portal={fila.portal_total} dif={fila.dif_total} />
            </div>

            {/* Por qué las dos columnas de arriba muestran números distintos con
                un guión en la diferencia: es la resta que el propio ticket hace
                —TOTAL = GRAVADAS − RETENCIÓN— y no un error de la tabla. */}
            {!cuadra(fila.retencion) && (
                <p className="text-micro text-content-3 leading-relaxed">
                    El Corte Z declara <b>{formatMoney(fila.retencion)}</b> de retención de IVA y
                    la resta de su total, por eso su cifra es menor que la del libro. Descontada,
                    los dos coinciden. Es el 1% que el cliente retiene y entera él mismo (Art. 162
                    del Código Tributario): no es una venta menos, es un anticipo ya pagado.
                </p>
            )}

            {!ok && (
                <PorQueDifiere fila={fila} dias={dias}
                    cargandoDias={cargandoDias} onVerDias={onVerDias} />
            )}

            {/* `mt-auto`: la grilla estira las tarjetas a la misma altura, así
                que sin esto la que no tiene observación dejaba un hueco debajo
                del cotejo y los botones colgando en el medio. Anclados abajo, el
                aire sobrante queda repartido y las dos filas de botones se leen
                alineadas. */}
            <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                <Button size="sm" variant="secondary" icon={FileText} onClick={() => onVerTicket(fila)}>
                    {verTicket ? 'Ocultar el original' : 'Ver el original'}
                </Button>
                {/* Sin `corte_z_descargar` el llamador no pasa `onPdf` — el botón
                    no existe en vez de existir y fallar. */}
                {onPdf && (
                    <Button size="sm" variant="secondary" icon={Download} onClick={() => onPdf(fila)}>
                        PDF
                    </Button>
                )}
            </div>

            {verTicket && (
                // El texto tal cual lo emitió el origen. Es la prueba: el día que
                // haya que defender una cifra, esto es lo que se muestra.
                <pre className="rounded-card bg-surface-card-hover border border-divider p-3 overflow-x-auto font-mono text-micro leading-tight text-content-2">
                    {fila.ticket}
                </pre>
            )}
        </section>
    );
};

export default function CorteZView() {
    const { getScope, user, hasPermission } = useAuth();
    // Canon de permisos 2026-08-03.
    const canDownload  = hasPermission('corte_z_descargar');
    const canVerMontos = hasPermission('corte_z_ver_montos');


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
            acciones={!canDownload ? [] : [{
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
                <div className="flex flex-col lg:flex-row lg:flex-wrap lg:items-center gap-3">
                    <CarrilCards className="flex-1" ariaLabel="Resumen del Corte Z">
                        <StatCard icon={Receipt} label="Sucursales" value={totales.sucursales}
                            sub="Del período" loading={loading} />
                        {/* Las dos de dinero van con `corte_z_ver_montos`. Sucursales y
                            "Con observación" quedan siempre: son las que dicen si el
                            período está completo y si hay algo que perseguir, sin
                            revelar ninguna cifra. */}
                        {canVerMontos && (
                            <>
                                <StatCard icon={FileText} label="Total general" value={formatMoney(totales.total)}
                                    sub="Del período" loading={loading} />
                                <StatCard icon={Percent} label="Crédito fiscal" value={formatMoney(totales.ccf)}
                                    sub="Ventas con CCF" loading={loading} />
                            </>
                        )}
                        {/* El recuento y nada más. El detalle —cuánto, por qué, y
                            si hay algo que perseguir— vive en la tarjeta de cada
                            sucursal, que es donde se puede hacer algo con él;
                            repetirlo acá arriba solo lo aleja de su contexto. */}
                        <StatCard icon={AlertTriangle} label="Con observación" value={totales.difieren}
                            sub={totales.difieren
                                ? `${totales.sucursales - totales.difieren} sin diferencia`
                                : 'Todas cuadran'}
                            loading={loading} />
                    </CarrilCards>
                    <div className="flex justify-end min-w-0">{barraFiltros}</div>
                </div>

                {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}

                {loading ? (
                    <div className="grid gap-4 xl:grid-cols-2">
                        {[0, 1].map(i => (
                            <div key={i} data-surface="card" className="h-64 animate-pulse" />
                        ))}
                    </div>
                ) : filas.length === 0 ? (
                    // El vacío se explica: un mes que todavía no se procesó y un
                    // fallo de la consulta se ven igual, y confundirlos es lo que
                    // haría dar por bueno un período que nadie trajo.
                    <div data-surface="card" className="p-10 text-center space-y-2">
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
                                onPdf={canDownload ? pdfDe : null}
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
