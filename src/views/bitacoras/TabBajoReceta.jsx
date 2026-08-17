import React, { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, BookOpen } from 'lucide-react';
import Badge from '../../components/common/Badge';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import ExpedienteMovil from '../../components/common/ExpedienteMovil';
import Notice from '../../components/common/Notice';
import { LoadingState } from '../../components/common/StateViews';
import DetalleDeFolio from '../../components/bitacoras/DetalleDeFolio';
import { ESTADO_RENGLON, faltantesDelRenglon } from '../../data/bitacoras';

// ═══════════════════════════════════════════════════════════════════════════
// El libro foliado de dispensación bajo receta.
//
// ── El folio es la primera columna, y no es decoración ─────────────────────
// Es lo único que un inspector trae escrito en la mano. Todo lo demás de la
// fila es contexto para reconocerla; el folio es la dirección.
//
// ── «Falta completar» NO es un error de la sala ────────────────────────────
// El renglón nace del sistema con todo lo que la venta ya sabía —producto,
// cantidad, lote, vencimiento, cliente, quién vendió— y queda pendiente sólo de
// lo que ningún sistema puede saber: el paciente, el médico y la foto de la
// receta. Por eso el estado dice qué falta, no que algo salió mal.
// ═══════════════════════════════════════════════════════════════════════════

const num = (v) => (v === null || v === undefined ? '—' : String(Number(v)));

const fmtFecha = (f) => (f
    ? new Date(`${f}T12:00:00Z`).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', timeZone: 'UTC' })
    : '—');

// El ancla del teléfono es el FOLIO, no un monto: acá no hay dinero, y el
// número por el que se entra a este libro es el folio. Sin declararlo, la
// inferencia elegiría la primera columna útil y el orden de la ficha quedaría
// al azar.
const MOVIL = { ancla: 'folio_txt', identidad: 'producto_nombre', chips: ['estado', 'paciente'] };

const COLUMNAS = [
    { key: 'folio_txt',       label: 'Folio',       sortable: true },
    { key: 'fecha',           label: 'Fecha',       sortable: true },
    { key: 'producto_nombre', label: 'Medicamento', sortable: true },
    { key: 'cantidad',        label: 'Cant.',       align: 'right', sortable: true },
    { key: 'lote',            label: 'Lote',        hideBelow: 'md' },
    { key: 'vence',           label: 'Vence',       hideBelow: 'lg' },
    { key: 'paciente',        label: 'Paciente' },
    { key: 'medico',          label: 'Médico',      hideBelow: 'lg' },
    { key: 'vendedor',        label: 'Vendió',      hideBelow: '2xl' },
    { key: 'estado',          label: 'Estado' },
];

// Qué campo crudo ordena cada columna. Las columnas compuestas se pintan como
// nodos de React y ordenarlas por eso daría un orden estable pero arbitrario —
// peor que uno visiblemente roto, porque no se nota.
const CLAVE_DE_ORDEN = {
    folio_txt: 'folio', fecha: 'fecha', producto_nombre: 'producto_nombre',
    cantidad: 'cantidad', lote: 'lote', vence: 'vence',
    paciente: 'paciente', medico: 'medico', vendedor: 'vendedor', estado: 'estado',
};

export default function TabBajoReceta({ renglones, cargando, error, branchId, sucursalNombre }) {
    // Se guarda el ID, no la fila. Con la fila entera haría falta un efecto que
    // la cierre cuando la lista se recarga y ese renglón ya no está — y un panel
    // abierto sobre una fila que no existe muestra datos viejos como si fueran
    // los de ahora. Derivándola, el caso se resuelve solo: si el id ya no está
    // en la lista, no hay panel.
    const [abiertoId, setAbiertoId] = useState(null);
    const [sortKey, setSortKey] = useState('folio_txt');
    const [sortDir, setSortDir] = useState('desc');

    const abierto = useMemo(
        () => renglones.find(r => r.id === abiertoId) || null,
        [renglones, abiertoId],
    );

    const ordenadas = useMemo(() => {
        const campo = CLAVE_DE_ORDEN[sortKey] || 'folio';
        const dir = sortDir === 'asc' ? 1 : -1;
        return [...renglones].sort((a, b) => {
            const ka = a[campo], kb = b[campo];
            if (ka === kb) return 0;
            if (ka === null || ka === undefined) return 1;
            if (kb === null || kb === undefined) return -1;
            return (ka > kb ? 1 : -1) * dir;
        });
    }, [renglones, sortKey, sortDir]);

    const ordenar = useCallback((key) => {
        setSortDir(d => (key === sortKey ? (d === 'asc' ? 'desc' : 'asc') : 'desc'));
        setSortKey(key);
    }, [sortKey]);

    if (cargando) return <LoadingState label="Cargando el libro…" />;

    // Un rechazo de permiso no se puede ver como una lista vacía: quien lo sufre
    // sólo puede reportar «me sale vacío» (§2-bis del checklist de vista nueva).
    if (error) {
        return (
            <Notice variant="danger" icon={AlertTriangle}>
                {error.code === '42501'
                    ? 'Tu cargo no tiene el módulo de bitácoras. Hay que otorgarlo en Permisos.'
                    : (error.message || 'No se pudo cargar el libro.')}
            </Notice>
        );
    }

    const pendientes = renglones.filter(r => r.estado === 'pendiente').length;

    return (
        <div className="space-y-4">
            {pendientes > 0 && (
                <Notice variant="warning" icon={AlertTriangle}>
                    <span className="font-bold">
                        {pendientes} {pendientes === 1 ? 'renglón espera' : 'renglones esperan'} que se complete la receta.
                    </span>
                    <span className="block mt-0.5 font-normal text-content-2">
                        El medicamento, la cantidad, el lote y el vencimiento ya están: falta el paciente,
                        el médico y la foto de la receta. Toca un renglón para completarlo.
                    </span>
                </Notice>
            )}

            <DataTable
                columns={COLUMNAS}
                loading={cargando}
                onSort={ordenar}
                sortKey={sortKey}
                sortDir={sortDir}
                minWidth="980px"
                movil={MOVIL}
                empty={{
                    icon: BookOpen,
                    message: 'Sin renglones en este período — el libro se llena solo con cada venta bajo receta',
                }}
            >
                {ordenadas.map((r, i) => {
                    const est = ESTADO_RENGLON[r.estado] || ESTADO_RENGLON.pendiente;
                    const faltan = faltantesDelRenglon(r);
                    // Un lote vencido al momento de dispensar es un ítem CRÍTICO
                    // de la guía (6.1). Se marca en la FILA y no sólo adentro:
                    // si hay que abrir el renglón para enterarse, no se entera
                    // nadie.
                    const vencidoAlVender = r.vence && r.fecha && r.vence < r.fecha;

                    return (
                        <DataRow key={r.id} index={i} onClick={() => setAbiertoId(r.id)}
                            className={r.estado === 'anulada' ? 'opacity-60' : ''}>
                            <DataCell>
                                <span className="text-body-sm font-black tabular-nums text-content whitespace-nowrap">{r.folio_txt}</span>
                            </DataCell>
                            <DataCell>
                                <p className="text-body-sm text-content-2 tabular-nums">{fmtFecha(r.fecha)}</p>
                                {r.hora && <p className="text-caption text-content-3 tabular-nums">{String(r.hora).slice(0, 5)}</p>}
                            </DataCell>
                            <DataCell>
                                <p className="text-body-sm font-bold text-content-2 leading-snug">{r.producto_nombre}</p>
                                {r.laboratorio && <p className="text-caption text-content-3">{r.laboratorio}</p>}
                            </DataCell>
                            <DataCell align="right">
                                <span className="tabular-nums">{num(r.cantidad)}</span>
                            </DataCell>
                            <DataCell hideBelow="md">
                                {r.lote
                                    ? <Badge variant="chart-3" size="sm" uppercase={false}>{r.lote}</Badge>
                                    : <span className="text-content-3">—</span>}
                            </DataCell>
                            <DataCell hideBelow="lg">
                                <span className={`tabular-nums ${vencidoAlVender ? 'text-danger-text font-bold' : ''}`}>
                                    {fmtFecha(r.vence)}
                                </span>
                            </DataCell>
                            <DataCell>
                                {r.paciente
                                    ? <span className="text-body-sm text-content-2">{r.paciente}</span>
                                    : <span className="text-body-sm text-content-3">—</span>}
                            </DataCell>
                            <DataCell hideBelow="lg">
                                {r.medico ? (
                                    <>
                                        <p className="text-body-sm text-content-2 leading-snug">{r.medico}</p>
                                        {r.numero_junta && <p className="text-caption text-content-3 tabular-nums">JVPM {r.numero_junta}</p>}
                                    </>
                                ) : <span className="text-body-sm text-content-3">—</span>}
                            </DataCell>
                            <DataCell hideBelow="2xl">
                                <span className="text-body-sm text-content-3">{r.vendedor || '—'}</span>
                            </DataCell>
                            <DataCell>
                                <div className="flex flex-wrap items-center gap-1">
                                    <Badge variant={est.variant} size="sm" uppercase={false}>{est.label}</Badge>
                                    {vencidoAlVender && <Badge variant="danger" size="sm" uppercase={false}>Lote vencido</Badge>}
                                    {/* Sólo cuántos, no cuáles. La lista entera
                                        —«falta paciente, médico, foto de la
                                        receta»— ocupaba tres renglones en CADA
                                        fila y duplicaba el alto de la tabla; el
                                        detalle está en el renglón abierto, que
                                        es donde se va a completar. */}
                                    {faltan.length > 0 && r.estado === 'pendiente' && (
                                        <span className="text-label text-content-3 whitespace-nowrap">
                                            faltan {faltan.length}
                                        </span>
                                    )}
                                </div>
                            </DataCell>
                        </DataRow>
                    );
                })}
            </DataTable>

            <ExpedienteMovil
                abierto={abierto}
                onClose={() => setAbiertoId(null)}
                titulo={abierto ? `Folio ${abierto.folio_txt}` : ''}
                subtitulo={abierto ? `${sucursalNombre} · ${fmtFecha(abierto.fecha)}` : ''}
                variante="pantalla"
            >
                {(fila) => <DetalleDeFolio renglon={fila} branchId={branchId} />}
            </ExpedienteMovil>
        </div>
    );
}
