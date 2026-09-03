import React, { Suspense, lazy, useCallback, useMemo, useState } from 'react';
import { AlertTriangle, BookOpen, Check, Download, ImageOff, PenLine } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import LiquidModal from '../../components/common/LiquidModal';
import Notice from '../../components/common/Notice';
import { LoadingState } from '../../components/common/StateViews';
import DetalleDeFolio from '../../components/bitacoras/DetalleDeFolio';

/* El formulario se baja al apretar «Completar», no al abrir el libro: arrastra
 * el canónico de archivo, el recorte de la foto y el buscador de médico. */
const CompletarRenglon = lazy(() => import('../../components/bitacoras/CompletarRenglon'));
import {
    CLASE_ANTIBIOTICO, ESTADO_RENGLON, faltantesDelRenglon, rotularLibro,
} from '../../data/bitacoras';
import { exportCsv } from '../../utils/csvExport';

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
// `usarAccionDeFila`: el toque abre el renglón completo —los campos que faltan,
// el lote, la anulación—, que es un `LiquidModal` de verdad. Sin declararlo gana
// la hoja genérica de `DataTable`, que sólo repite las columnas de la ficha.
const MOVIL = { ancla: 'folio_txt', identidad: 'producto_nombre', chips: ['cantidad', 'lote'], usarAccionDeFila: true };

// El folio manda pero no necesita ser grande: son 10 caracteres fijos y
// tabulares, y se reconocen por la forma. Lo que sí necesita aire es el
// medicamento, que es lo que se lee de un vistazo para saber de qué fila se
// habla. Y «Vendió» se fusionó con la fecha: quién atendió es contexto de
// CUÁNDO, no una columna propia — así entra el botón sin sacar nada útil.
const COLUMNAS = [
    { key: 'folio_txt',       label: 'Folio',       sortable: true },
    { key: 'fecha',           label: 'Fecha',       sortable: true },
    { key: 'producto_nombre', label: 'Medicamento', sortable: true },
    { key: 'cantidad',        label: 'Cant.',       align: 'right', sortable: true },
    { key: 'lote',            label: 'Lote',        hideBelow: 'lg' },
    { key: 'paciente',        label: 'Paciente y médico' },
    { key: 'estado',          label: '', align: 'right' },
];

// Qué campo crudo ordena cada columna. Las columnas compuestas se pintan como
// nodos de React y ordenarlas por eso daría un orden estable pero arbitrario —
// peor que uno visiblemente roto, porque no se nota.
const CLAVE_DE_ORDEN = {
    folio_txt: 'folio', fecha: 'fecha', producto_nombre: 'producto_nombre',
    cantidad: 'cantidad', lote: 'lote', paciente: 'paciente', estado: 'estado',
};

export default function TabBajoReceta({
    renglones, cargando, error, branchId, sucursalNombre, onRecargar, puedeCompletar,
    clase = CLASE_ANTIBIOTICO, periodo = '',
}) {
    // Completar desde la FILA, sin abrir el expediente primero: con 26
    // pendientes, el camino «abrir → leer → completar → cerrar» son tres clics
    // de más por renglón. El expediente sigue estando para mirar el detalle.
    const [completando, setCompletando] = useState(null);
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

    // El orden del archivo es por FOLIO ascendente, siempre — aunque la
    // pantalla esté ordenada por otra columna. Un libro foliado se lee en el
    // orden de sus folios, y un archivo que sale en el orden en que alguien
    // dejó la tabla no se puede cotejar contra el papel.
    const descargar = useCallback(() => {
        const filas = [...renglones]
            .sort((a, b) => a.folio - b.folio)
            .map(r => [
                r.folio_txt, r.fecha, r.hora ? String(r.hora).slice(0, 5) : '',
                r.producto_nombre, r.laboratorio || '', r.lote || '', r.vence || '',
                r.cantidad, r.prescrito ?? '', r.paciente || '', r.medico || '',
                r.numero_junta || '', r.receta_correlativo || '',
                r.tiene_foto ? 'SI' : 'NO', r.correlativo_doc || '',
                r.vendedor || '', ESTADO_RENGLON[r.estado]?.label || r.estado,
                r.motivo_anulacion || '',
            ]);
        exportCsv(
            ['FOLIO', 'FECHA', 'HORA', 'MEDICAMENTO', 'LABORATORIO', 'LOTE', 'VENCE',
             'CANTIDAD DISPENSADA', 'CANTIDAD PRESCRITA', 'PACIENTE', 'PRESCRIPTOR',
             'N JUNTA', 'RECETA', 'COPIA DE RECETA', 'DOCUMENTO', 'DESPACHO',
             'ESTADO', 'MOTIVO DE ANULACION'],
            filas,
            `libro-${clase === CLASE_ANTIBIOTICO ? 'antibioticos' : 'bajo-receta'}-${
                (sucursalNombre || 'sala').toLowerCase().replace(/\s+/g, '-')}-${periodo || 'periodo'}.csv`,
            'bitacoras',
        );
    }, [renglones, clase, sucursalNombre, periodo]);

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
    const completos  = renglones.filter(r => r.estado === 'completa').length;
    // Un renglón «completo» sin la copia de la receta no cumple el ítem 3.12, y
    // desde afuera se ve idéntico a uno que sí. Se cuenta aparte para poder
    // decirlo, en vez de dejarlo escondido detrás de una insignia verde.
    const sinCopia = renglones.filter(r => r.estado === 'completa' && !r.tiene_foto).length;

    return (
        <div className="space-y-4">
            {/* ── La barra del libro ────────────────────────────────────────
                Antes eran DOS renglones diciendo cosas que se pisaban: una
                línea con el conteo y, debajo, un aviso amarillo con los
                pendientes. Y ese aviso salía SIEMPRE —lo normal es que el libro
                tenga pendientes—, o sea una alarma que se dispara por lo
                normal, que es como se aprende a ignorarlas.

                Ahora es una sola fila: de qué libro es, cuánto lleva, y cuánto
                falta dicho en el tono que le toca. `exportCsv` con su módulo:
                sin él la descarga queda anotada como «sin-declarar» en la
                bitácora de egresos, y las columnas son las del ítem 3.5, en su
                orden, para poder cotejar sin traducir. */}
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                    <h3 className="text-body font-black text-content leading-tight">
                        Libro de {rotularLibro(clase).toLowerCase()}
                    </h3>
                    <p className="text-caption text-content-3 mt-0.5">
                        {periodo ? `${periodo} · ` : ''}
                        {renglones.length} {renglones.length === 1 ? 'renglón' : 'renglones'}
                        {completos > 0 && ` · ${completos} con receta`}
                        {pendientes > 0 && (
                            <span className="text-warning-text font-bold"> · {pendientes} sin completar</span>
                        )}
                        {sinCopia > 0 && (
                            <span className="text-danger-text font-bold"> · {sinCopia} sin la copia</span>
                        )}
                    </p>
                </div>
                {renglones.length > 0 && (
                    <Button variant="secondary" size="sm" icon={Download} onClick={descargar}>
                        Descargar
                    </Button>
                )}
            </div>

            <DataTable
                columns={COLUMNAS}
                loading={cargando}
                onSort={ordenar}
                sortKey={sortKey}
                sortDir={sortDir}
                minWidth="820px"
                movil={MOVIL}
                empty={{
                    icon: BookOpen,
                    message: clase === CLASE_ANTIBIOTICO
                        ? 'Sin renglones en este período — el libro de antibióticos se llena solo con cada venta'
                        : 'Sin renglones en este período — aquí entran los productos bajo receta que no son antibióticos',
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

                    const pendiente = r.estado === 'pendiente';

                    return (
                        <DataRow key={r.id} index={i} onClick={() => setAbiertoId(r.id)}
                            className={r.estado === 'anulada' ? 'opacity-60' : ''}>
                            <DataCell>
                                <span className="text-label font-black tabular-nums text-content-2 whitespace-nowrap">
                                    {r.folio_txt}
                                </span>
                            </DataCell>
                            <DataCell>
                                <p className="text-body-sm text-content-2 tabular-nums whitespace-nowrap">{fmtFecha(r.fecha)}</p>
                                <p className="text-caption text-content-3 truncate">
                                    {r.hora ? String(r.hora).slice(0, 5) : ''}
                                    {r.vendedor ? ` · ${r.vendedor}` : ''}
                                </p>
                            </DataCell>
                            <DataCell>
                                <p className="text-body-sm font-bold text-content-2 leading-snug">{r.producto_nombre}</p>
                                <p className="text-caption text-content-3">
                                    {r.laboratorio || ''}
                                    {r.vence ? (
                                        <span className={vencidoAlVender ? 'text-danger-text font-bold' : ''}>
                                            {r.laboratorio ? ' · ' : ''}vence {fmtFecha(r.vence)}
                                        </span>
                                    ) : ''}
                                </p>
                            </DataCell>
                            <DataCell align="right">
                                <span className="text-body-sm font-bold tabular-nums text-content-2">{num(r.cantidad)}</span>
                            </DataCell>
                            <DataCell hideBelow="lg">
                                {r.lote
                                    ? <Badge variant="chart-3" size="sm" uppercase={false}>{r.lote}</Badge>
                                    : <span className="text-content-3">—</span>}
                            </DataCell>
                            {/* Paciente y médico en una sola columna: son las dos
                                caras del mismo dato —quién se lo llevó y quién lo
                                recetó— y separadas obligaban a esconder el médico
                                bajo `lg`, que es donde más falta hace. */}
                            <DataCell>
                                {r.paciente ? (
                                    <>
                                        <p className="text-body-sm text-content-2 leading-snug truncate">{r.paciente}</p>
                                        {r.medico && (
                                            <p className="text-caption text-content-3 truncate">
                                                {r.medico}{r.numero_junta ? ` · ${r.numero_junta}` : ''}
                                            </p>
                                        )}
                                    </>
                                ) : (
                                    <span className="text-body-sm text-content-3">Sin completar</span>
                                )}
                            </DataCell>
                            {/* La última columna es la ACCIÓN, no un rótulo: en un
                                libro con 26 pendientes, leer «Falta completar» 26
                                veces no dice nada que la fila vacía no diga ya. El
                                estado sólo se pinta cuando NO es lo normal. */}
                            <DataCell align="right">
                                <div className="flex items-center justify-end gap-1.5">
                                    {vencidoAlVender && (
                                        <Badge variant="danger" size="sm" uppercase={false}>Lote vencido</Badge>
                                    )}
                                    {r.estado === 'anulada' && (
                                        <Badge variant="neutral" size="sm" uppercase={false}>{est.label}</Badge>
                                    )}
                                    {/* «Completa» sin la copia de la receta NO es
                                        completa para el ítem 3.12, y pintarla verde
                                        la esconde: desde afuera se ve igual que una
                                        que sí la tiene. */}
                                    {r.estado === 'completa' && (
                                        r.tiene_foto
                                            ? <Badge variant="success" size="sm" uppercase={false} icon={Check}>Completa</Badge>
                                            : <Badge variant="danger" size="sm" uppercase={false} icon={ImageOff}>Sin la copia</Badge>
                                    )}
                                    {pendiente && puedeCompletar && (
                                        <Button variant="primary" size="xs" icon={PenLine}
                                            onClick={(e) => { e.stopPropagation(); setCompletando(r); }}>
                                            Completar
                                        </Button>
                                    )}
                                    {pendiente && !puedeCompletar && (
                                        <Badge variant="warning" size="sm" uppercase={false}>
                                            faltan {faltan.length}
                                        </Badge>
                                    )}
                                </div>
                            </DataCell>
                        </DataRow>
                    );
                })}
            </DataTable>

            {/* `LiquidModal` y NO `ExpedienteMovil`: el segundo es el canónico
                del TELÉFONO —su mitad de escritorio es la fila expandida dentro
                de la tabla, que acá no existe—, así que montarlo siempre abría
                el panel a pantalla completa también en la computadora. Se vio
                mirando la pantalla, no midiéndola: reportado como «¿por qué en
                escritorio me abre el modal como en móvil?».

                `LiquidModal` ya resuelve los dos: modal centrado con mouse, y
                hoja con asa que arrastra en táctil. Es el mismo envase que usa
                el detalle de un corte de caja, que es un detalle igual de rico. */}
            {completando && (
                <Suspense fallback={null}>
                    <CompletarRenglon
                        renglon={completando}
                        branchId={branchId}
                        onCerrar={(hubo) => { setCompletando(null); if (hubo) onRecargar?.(); }}
                    />
                </Suspense>
            )}

            {abierto && (
                <LiquidModal open onClose={() => setAbiertoId(null)}
                    maxWidth="max-w-3xl" ariaLabel={`Folio ${abierto.folio_txt}`}>
                    <LiquidModal.Header>
                        <div className="min-w-0">
                            <h3 className="text-body font-bold text-content">Folio {abierto.folio_txt}</h3>
                            <p className="text-caption text-content-3 truncate">
                                {sucursalNombre} · {fmtFecha(abierto.fecha)}
                            </p>
                        </div>
                    </LiquidModal.Header>
                    <LiquidModal.Body>
                        <DetalleDeFolio renglon={abierto} branchId={branchId} onCambio={onRecargar} />
                    </LiquidModal.Body>
                </LiquidModal>
            )}
        </div>
    );
}
