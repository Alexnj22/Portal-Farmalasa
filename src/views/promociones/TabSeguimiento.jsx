import React, { useEffect, useMemo, useState } from 'react';
import {
    Layers, Search, AlertTriangle, Download, Package, FileText, Users, DollarSign, Store,
} from 'lucide-react';
import { shortEmployeeName } from '../../utils/nameUtils';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import { EmptyState, LoadingState } from '../../components/common/StateViews';
import { fetchPromocion } from '../../data/promociones';
import { exportCsv } from '../../utils/csvExport';
import MatrizLaboratorio from './MatrizLaboratorio';
import {
    fmtMoneda, fmtUnidades, porLaboratorio, rotuloPresentacion, MOTIVO_CIERRE,
    esLaboratorio,
} from './promocionesUtils';

/**
 * El avance de UNA promoción: por producto, por sala y por persona.
 *
 * Se elige la promoción con un desplegable en vez de mostrarlas todas porque el
 * cálculo cruza los renglones de venta del período: pedirlo para todas a la vez
 * sería pagar esa consulta N veces para que alguien mire una.
 */
export default function TabSeguimiento({ promos, busqueda, elegida, onResumen }) {
    const [detalle, setDetalle] = useState(null);
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState(null);

    // Una promoción de laboratorio no tiene renglones: pedirle `get_promocion`
    // devolvería un detalle vacío que se leería como «no vendió nada». Su
    // avance lo trae `MatrizLaboratorio`, así que acá no se consulta.
    const elegidaObj = useMemo(
        () => promos.find((p) => String(p.id) === String(elegida)) || null,
        [promos, elegida],
    );
    const esLab = esLaboratorio(elegidaObj);

    useEffect(() => {
        if (!elegida || esLab) { setDetalle(null); return undefined; }
        let vivo = true;
        setCargando(true);
        setError(null);
        fetchPromocion(elegida)
            .then((d) => { if (vivo) setDetalle(d); })
            .catch((e) => { if (vivo) setError(e); })
            .finally(() => { if (vivo) setCargando(false); });
        return () => { vivo = false; };
    }, [elegida, esLab]);


    /* `useMemo` y no `?? []` suelto: el arreglo nuevo de cada render haría que
       el efecto de abajo se dispare siempre, y ése llama al padre. */
    const renglones  = useMemo(() => detalle?.renglones ?? [], [detalle]);
    const vendedores = useMemo(() => detalle?.vendedores ?? [], [detalle]);
    const sinDueno   = detalle?.sin_dueno;

    /* Las tarjetas de arriba las pinta la vista, pero los números salen de ACÁ:
       son de la promoción elegida, y pedir `get_promocion` otra vez desde el
       padre para mostrarlos sería pagar dos veces la consulta que cruza los
       renglones de venta del período. */
    useEffect(() => {
        if (!detalle) { onResumen?.(null); return; }
        onResumen?.([
            { key: 'u', icon: Package, label: 'Unidades vendidas',
              value: fmtUnidades(renglones.reduce((a, r) => a + (r.vendido_base || 0), 0)) },
            { key: 'd', icon: FileText, label: 'Documentos',
              value: fmtUnidades(renglones.reduce((a, r) => a + (r.documentos || 0), 0)) },
            { key: 'v', icon: Users, label: 'Vendedores', value: vendedores.length },
            { key: 'b', icon: DollarSign, label: 'Se habría ganado',
              value: fmtMoneda(vendedores.reduce((a, v) => a + Number(v.bono || 0), 0)),
              iconBg: 'bg-brand/10', iconCls: 'text-brand-text', valueCls: 'text-brand' },
        ]);
    }, [detalle, renglones, vendedores, onResumen]);

    if (!promos.length) {
        return busqueda.trim()
            ? <EmptyState icon={Search} title="Sin resultados"
                subtitle={`Ninguna promoción coincide con "${busqueda.trim()}".`} />
            : <EmptyState icon={Layers} title="Sin promociones activas"
                subtitle="Cuando haya una en marcha, aquí se ve cuánto lleva vendido cada sala." />;
    }

    const exportar = () => {
        exportCsv(
            ['VENDEDOR', 'SALA', 'UNIDADES', 'DOCUMENTOS', 'SE HABRIA GANADO'],
            vendedores.map((v) => [v.nombre, v.sala || '', v.unidades, v.documentos, v.bono]),
            `promocion_${(detalle?.nombre || '').replace(/\W+/g, '_')}.csv`,
            'promociones',
        );
    };

    return (
        <div className="space-y-4">

            {esLab && elegida && (
                <MatrizLaboratorio key={elegida} promocionId={elegida} />
            )}

            {!esLab && cargando && <LoadingState label="Calculando el avance…" />}

            {!esLab && error && (
                <Notice variant="danger" icon={AlertTriangle}>
                    {error.code === '42501'
                        ? 'Tu cargo todavía no tiene el módulo de Promociones. Hay que otorgarlo en Ajustes → Permisos.'
                        : (error.message || 'No se pudo calcular el avance.')}
                </Notice>
            )}

            {!esLab && !cargando && !error && detalle && (
                <>
                    {porLaboratorio(renglones).map(({ laboratorio, items }) => (
                        <section key={laboratorio} className="space-y-2">
                            <h3 className="text-label uppercase tracking-wide text-content-3 font-semibold">
                                {laboratorio}
                            </h3>
                            <div className="grid gap-3 md:grid-cols-2">
                                {items.map((r) => <TarjetaRenglon key={r.id} r={r} />)}
                            </div>
                        </section>
                    ))}

                    <section className="space-y-2">
                        <div className="flex items-baseline gap-3 flex-wrap">
                            <h3 className="text-subtitle font-semibold text-content">Quién vendió</h3>
                            <span className="text-caption text-content-3">unidades base</span>
                            <span className="flex-1" />
                            {vendedores.length > 0 && (
                                <Button variant="secondary" size="sm" icon={Download} onClick={exportar}>
                                    Exportar
                                </Button>
                            )}
                        </div>

                        {vendedores.length === 0 ? (
                            <EmptyState icon={Layers} title="Sin ventas todavía"
                                subtitle="Nadie ha vendido productos de esta promoción en su vigencia." />
                        ) : (
                            /* Por sucursal (usuario, 24-sep: «separa en secciones
                               por sucursal»): lo que se compara es cómo va cada
                               sala, y en una lista plana ordenada por nombre la
                               sala era una columna más que había que ir leyendo. */
                            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                                {porSala(vendedores).map((g) => (
                                    <SeccionSala key={g.sala} g={g} conBono={renglones.some((r) => r.tiene_bono)} />
                                ))}
                            </div>
                        )}

                        {sinDueno?.unidades > 0 && (
                            <Notice variant="warning" icon={AlertTriangle} compact>
                                <span className="font-semibold">{fmtUnidades(sinDueno.unidades)} unidades</span>{' '}
                                ({fmtMoneda(sinDueno.monto)}) se vendieron con un código que no da con nadie activo.
                                Ese bono <span className="font-semibold">no se paga</span> y no se reparte entre los demás.
                            </Notice>
                        )}
                    </section>
                </>
            )}
        </div>
    );
}

function TarjetaRenglon({ r }) {
    const pct = Number(r.pct) || 0;
    const tono = pct >= 100 ? 'bg-success' : pct >= 80 ? 'bg-warning' : 'bg-brand';

    return (
        <div
            data-surface="card"
            className="rounded-card border border-border-card bg-surface-card shadow-card p-4 space-y-3"
        >
            {/* El nombre va solo en su línea: compartiéndola con las etiquetas,
                en el teléfono le quedaba ancho cero y se partía letra por letra. */}
            <h4 className="text-body font-semibold text-content break-words">
                {r.producto}
            </h4>
            <div className="flex items-center gap-2 flex-wrap -mt-1">
                <Badge variant={r.factor_unidades == null ? 'neutral' : 'info'} size="sm">
                    {rotuloPresentacion(r.factor_unidades)}
                </Badge>
                {/* Sin esto, «sólo mide» y «todavía no vendió nada» se leían
                    iguales: los dos con las columnas de dinero en $0.00. */}
                {!r.tiene_bono && (
                    <Badge variant="neutral" size="sm">Sólo mide</Badge>
                )}
            </div>

            {r.tiene_bono && r.paga && (
                <p className="text-caption text-content-3">
                    Lo paga {r.paga === 'empresa'
                        ? 'la empresa'
                        : (r.proveedor || 'un proveedor sin nombre')}
                </p>
            )}

            {r.estado === 'cerrado' && (
                <p className="text-caption text-content-3">
                    Terminado · {MOTIVO_CIERRE[r.cerrado_motivo] || r.cerrado_motivo}
                </p>
            )}

            {/* Sin lote no hay techo contra el cual medir: una barra al 0%
                sobre un total que no existe dice algo que no es. */}
            {r.lote_total ? (
                <div>
                    <div className="flex items-baseline justify-between text-caption text-content-3 mb-1.5 tabular-nums">
                        <span>
                            <span className="text-content font-semibold">{fmtUnidades(r.vendido_base)}</span>
                            {' de '}{fmtUnidades(r.lote_total)}
                        </span>
                        <span className="font-semibold text-content-2">{pct}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-surface-card-hover overflow-hidden">
                        <div className={`h-full rounded-full ${tono}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                    </div>
                </div>
            ) : (
                <p className="text-caption text-content-3 tabular-nums">
                    <span className="text-content font-semibold">{fmtUnidades(r.vendido_base)}</span>
                    {' unidades vendidas · sin lote declarado'}
                </p>
            )}

            {r.tiene_bono && (
                <div className="grid grid-cols-3 gap-2 pt-1 border-t border-border-muted">
                    <Mini rotulo="A vendedores" valor={fmtMoneda(r.costo_vendedor)} destacado />
                    <Mini rotulo="Fondo admón." valor={fmtMoneda(r.fondo_adm)} />
                    <Mini rotulo="Fondo bodega" valor={fmtMoneda(r.fondo_bodega)} />
                </div>
            )}

            {Array.isArray(r.reparto) && r.reparto.length > 0 && (
                <BarrasPorSala reparto={r.reparto} />
            )}
        </div>
    );
}

function Mini({ rotulo, valor, destacado }) {
    return (
        <div className="min-w-0">
            <span className="block text-micro uppercase tracking-wide text-content-3 font-semibold truncate">
                {rotulo}
            </span>
            <span className={`text-body font-semibold tabular-nums ${destacado ? 'text-brand' : 'text-content'}`}>
                {valor}
            </span>
        </div>
    );
}

/* Cuánto vendió cada sala, en barras (usuario, 24-sep: «agrega una gráfica, más
 * visual»). Con cupo, la barra es lo vendido contra SU cupo; sin cupo no hay
 * techo contra el cual medir, y la barra es contra la sala que más vendió — el
 * «/ 0» de antes decía un cupo que no existe. */
function BarrasPorSala({ reparto }) {
    const conCupo = reparto.some((s) => Number(s.asignado_vigente) > 0);
    const mayor = Math.max(1, ...reparto.map((s) => Number(s.vendido) || 0));
    const total = reparto.reduce((a, s) => a + (Number(s.vendido) || 0), 0);
    return (
        <div className="pt-3 border-t border-border-muted space-y-2">
            <p className="text-micro uppercase tracking-wide text-content-3 font-semibold">
                {conCupo ? 'Por sala, contra su cupo' : 'Por sala'}
            </p>
            <ul className="space-y-2">
                {reparto.map((s) => {
                    const v = Number(s.vendido) || 0;
                    const cupo = Number(s.asignado_vigente) || 0;
                    const pct = conCupo
                        ? (cupo > 0 ? Math.min(100, (v / cupo) * 100) : 0)
                        : (v / mayor) * 100;
                    const tono = conCupo && cupo > 0 && v >= cupo ? 'bg-success'
                        : conCupo && cupo > 0 && v >= cupo * 0.8 ? 'bg-warning' : 'bg-brand';
                    return (
                        <li key={s.branch_id} className={`grid ${conCupo ? 'grid-cols-[5.5rem_minmax(0,1fr)_7rem]' : 'grid-cols-[5.5rem_minmax(0,1fr)_4.5rem]'}
                            items-center gap-2.5 text-caption tabular-nums`}>
                            <span className="text-content-2 break-words">{s.sala}</span>
                            <span className="h-2.5 rounded-full bg-surface-card-hover overflow-hidden" data-medida="dato">
                                <span className={`block h-full rounded-full ${tono}`} style={{ width: `${Math.max(pct, v > 0 ? 3 : 0)}%` }} />
                            </span>
                            <span className="text-right">
                                <span className="text-content font-semibold">{fmtUnidades(v)}</span>
                                {conCupo && cupo > 0 && <span className="text-content-3"> de {fmtUnidades(cupo)}</span>}
                                {!conCupo && total > 0 && (
                                    <span className="text-content-3"> · {Math.round((v / total) * 100)}%</span>
                                )}
                                {s.asignado_vigente !== s.asignado_original && (
                                    <Badge variant="info" size="sm" className="ml-1.5">
                                        {s.asignado_vigente > s.asignado_original ? '+' : ''}
                                        {s.asignado_vigente - s.asignado_original}
                                    </Badge>
                                )}
                            </span>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

/* Los vendedores, agrupados por sala y ordenados por nombre de sala —el mismo
 * orden que el resto del portal—; adentro, quien más vendió primero. */
function porSala(vendedores) {
    const mapa = new Map();
    for (const v of vendedores) {
        const sala = v.sala || 'Sin sala';
        if (!mapa.has(sala)) mapa.set(sala, { sala, gente: [], unidades: 0, bono: 0 });
        const g = mapa.get(sala);
        g.gente.push(v);
        g.unidades += Number(v.unidades) || 0;
        g.bono += v.sin_dueno ? 0 : Number(v.bono) || 0;
    }
    return [...mapa.values()]
        .map((g) => ({ ...g, gente: g.gente.sort((a, b) => (b.unidades || 0) - (a.unidades || 0)) }))
        .sort((a, b) => a.sala.localeCompare(b.sala, 'es', { numeric: true }));
}

function SeccionSala({ g, conBono }) {
    const mayor = Math.max(1, ...g.gente.map((v) => Number(v.unidades) || 0));
    return (
        <section data-surface="card"
            className="rounded-card border border-border-card bg-surface-card shadow-card p-4 space-y-3">
            <header className="flex items-center gap-2.5">
                <span className="shrink-0 grid place-items-center size-9 rounded-full bg-brand/10 text-brand-text">
                    <Store size={16} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                    <h4 className="text-body font-semibold text-content break-words">{g.sala}</h4>
                    <p className="text-caption text-content-3 tabular-nums">
                        {fmtUnidades(g.unidades)} {g.unidades === 1 ? 'unidad' : 'unidades'}
                        {' · '}{g.gente.length} {g.gente.length === 1 ? 'persona' : 'personas'}
                    </p>
                </div>
                {conBono && (
                    <span className="shrink-0 text-body font-semibold text-brand tabular-nums">{fmtMoneda(g.bono)}</span>
                )}
            </header>
            <ul className="space-y-2 pt-3 border-t border-border-muted">
                {g.gente.map((v, i) => {
                    const u = Number(v.unidades) || 0;
                    return (
                        <li key={`${v.cod_vendedor}-${i}`} className="space-y-1">
                            <div className="flex items-baseline gap-2 text-caption tabular-nums">
                                <span className="text-content font-medium flex-1 min-w-0 break-words">
                                    {shortEmployeeName(v.nombre)}
                                    {v.sin_dueno && <Badge variant="warning" size="sm" className="ml-2">Sin dueño</Badge>}
                                </span>
                                <span className="text-content font-semibold">{fmtUnidades(u)}</span>
                                {conBono && (
                                    <span className={`w-16 text-right ${v.sin_dueno ? 'text-content-3' : 'text-brand'}`}>
                                        {fmtMoneda(v.bono)}
                                    </span>
                                )}
                            </div>
                            <span className="block h-1.5 rounded-full bg-surface-card-hover overflow-hidden" data-medida="dato">
                                <span className="block h-full rounded-full bg-brand/70" style={{ width: `${(u / mayor) * 100}%` }} />
                            </span>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
