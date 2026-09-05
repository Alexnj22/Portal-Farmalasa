import React, { useEffect, useMemo, useState } from 'react';
import {
    Layers, Search, AlertTriangle, Download, Package, FileText, Users, DollarSign,
} from 'lucide-react';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
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

                        <DataTable
                            columns={[
                                { key: 'nombre',     label: 'Vendedor' },
                                { key: 'sala',       label: 'Sala', hideBelow: 'md' },
                                { key: 'unidades',   label: 'Unidades', align: 'right' },
                                { key: 'documentos', label: 'Documentos', align: 'right', hideBelow: 'lg' },
                                { key: 'bono',       label: 'Se habría ganado', align: 'right' },
                            ]}
                            minWidth="320px"
                            /* La fila no lleva a ningún lado: es el detalle
                               final. Sin `usarAccionDeFila` el canónico abre su
                               hoja genérica, que acá es exactamente lo correcto. */
                            empty={{ icon: Layers, message: 'Sin ventas todavía',
                                     subtext: 'Nadie ha vendido productos de esta promoción en su vigencia.' }}
                        >
                            {vendedores.map((v, i) => (
                                <DataRow key={`${v.cod_vendedor}-${i}`} index={i}>
                                    <DataCell>
                                        <span className="font-medium text-content">{v.nombre}</span>
                                        {v.sin_dueno && (
                                            <Badge variant="warning" size="sm" className="ml-2">Sin dueño</Badge>
                                        )}
                                    </DataCell>
                                    <DataCell hideBelow="md">
                                        <span className="text-caption text-content-3">{v.sala || '—'}</span>
                                    </DataCell>
                                    <DataCell align="right">{fmtUnidades(v.unidades)}</DataCell>
                                    <DataCell align="right" hideBelow="lg">{fmtUnidades(v.documentos)}</DataCell>
                                    <DataCell align="right">
                                        <span className={v.sin_dueno ? 'text-content-3' : 'text-brand font-semibold'}>
                                            {fmtMoneda(v.bono)}
                                        </span>
                                    </DataCell>
                                </DataRow>
                            ))}
                        </DataTable>

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
            <div className="flex items-start gap-2 flex-wrap">
                <h4 className="text-body font-semibold text-content flex-1 min-w-0 truncate">
                    {r.producto}
                </h4>
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
                <ul className="space-y-1 pt-1 border-t border-border-muted">
                    {r.reparto.map((s) => (
                        <li key={s.branch_id} className="flex items-baseline gap-2 text-caption tabular-nums">
                            <span className="text-content-2 flex-1 truncate">{s.sala}</span>
                            <span className="text-content">{fmtUnidades(s.vendido)}</span>
                            <span className="text-content-3">/ {fmtUnidades(s.asignado_vigente)}</span>
                            {s.asignado_vigente !== s.asignado_original && (
                                <Badge variant="info" size="sm">
                                    {s.asignado_vigente > s.asignado_original ? '+' : ''}
                                    {s.asignado_vigente - s.asignado_original}
                                </Badge>
                            )}
                        </li>
                    ))}
                </ul>
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
