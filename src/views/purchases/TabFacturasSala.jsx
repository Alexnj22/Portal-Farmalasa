import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ReceiptText, Loader2, Undo2, AlertTriangle } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import LiquidSelect from '../../components/common/LiquidSelect';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { fetchFacturasSalaPanel, soltarFactura, resumenRenglones } from '../../data/facturasSala';
import { formatMoney } from '../../utils/formatNumber';
import { useAuth } from '../../context/AuthContext';

// Pestaña «Facturas de Sala» de Compras.
//
// La otra mitad del widget del tablero: allá cada sala toma la factura que le
// toca, acá se ve quién tomó qué y —lo que de verdad importa— **si esa compra
// terminó cargada**. Tomar la factura no era el objetivo; cargarla sí.
//
// ── Por qué vive en Compras y no en Facturas de Compra ────────────────────
// Decisión del usuario 2026-08-07: «agregalo en compras, no en contabilidad».
// Quien revisa que una compra haya quedado cargada trabaja acá, no en el módulo
// de los documentos que llegan por correo.
//
// ── La columna que justifica la pantalla ──────────────────────────────────
// «Sin cargar» con los días encima. Una factura tomada hace una semana y nunca
// registrada es plata que no entró a los libros y crédito fiscal que se pierde,
// y es la única señal que nadie más da: el documento existe, la sala dijo que
// era suya, y ahí se detuvo.
//
// Y cuando dice «Cargada» es porque `verificar_facturas_reclamadas` encontró
// UNA compra candidata, no varias. Con montos que se repiten —$184.68 aparece
// en 9 de 21 documentos de recargas— una coincidencia ambigua se queda en «sin
// confirmar», que es la verdad, en vez de inventar el vínculo.

const COLS = [
    { key: 'fecha',     label: 'Fecha',      align: 'left'   },
    { key: 'que',       label: 'Qué',        align: 'left'   },
    { key: 'detalle',   label: 'Detalle',    align: 'left',   hideBelow: 'lg' },
    { key: 'monto',     label: 'Monto',      align: 'right'  },
    { key: 'sala',      label: 'Sala',       align: 'left'   },
    { key: 'tomada',    label: 'La tomó',    align: 'left',   hideBelow: 'md' },
    { key: 'estado',    label: 'Estado',     align: 'center' },
    { key: 'accion',    label: '',           align: 'right'  },
];

const PERIODOS = [
    { value: '30',  label: 'Últimos 30 días'  },
    { value: '90',  label: 'Últimos 90 días'  },
    { value: '365', label: 'Último año'       },
];

const ESTADOS = [
    { value: 'abiertas',  label: 'Tomadas, sin cargar' },
    { value: 'todas',     label: 'Todas'               },
    { value: 'cargadas',  label: 'Ya cargadas'         },
    { value: 'liberadas', label: 'Liberadas'           },
];

// Días tomada y sin cargar a partir de los cuales deja de ser normal. El sync de
// compras corre cada 10 minutos y la verificación cada 2 horas, así que un día
// entero sin aparecer ya no es demora del portal.
const DIAS_ALERTA = 3;

const fmtFecha = (iso) => {
    if (!iso) return '—';
    // Partir la cadena a mano: `new Date('2026-08-01')` la lee como UTC
    // medianoche y en El Salvador (-6) retrocede un día.
    const [a, m, d] = iso.split('-');
    return `${d}/${m}/${a.slice(2)}`;
};

const fmtCuando = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('es-SV', { day: '2-digit', month: 'short' });
};

/* ─── Liberar, en dos pasos ───────────────────────────────────────────────── */
// Dos pasos y no un diálogo del navegador: un `confirm()` bloquea todo y, en el
// entorno de pruebas, cuelga la sesión entera. Y liberar no es reversible desde
// la pantalla — la sala tiene que volver a tomarla.
function BotonLiberar({ claimId, onHecho }) {
    const [paso,    setPaso]    = useState(0);
    const [ocupado, setOcupado] = useState(false);

    const liberar = async () => {
        setOcupado(true);
        const { error } = await soltarFactura(claimId, 'Liberada desde Compras');
        setOcupado(false);
        setPaso(0);
        onHecho(error ?? null);
    };

    if (paso === 0) {
        return (
            <Button size="xs" variant="ghost" onClick={() => setPaso(1)}>
                <Undo2 size={12} />
                Liberar
            </Button>
        );
    }

    return (
        <div className="inline-flex items-center gap-1">
            <Button size="xs" variant="destructive" disabled={ocupado} onClick={liberar}>
                {ocupado && <Loader2 size={12} className="animate-spin" />}
                Confirmar
            </Button>
            <Button size="xs" variant="ghost" disabled={ocupado} onClick={() => setPaso(0)}>
                No
            </Button>
        </div>
    );
}

/* ─── La pestaña ──────────────────────────────────────────────────────────── */
export default function TabFacturasSala({ searchTerm = '' }) {
    const { hasPermission } = useAuth();
    const canVerMontos = hasPermission('compras_ver_montos');
    const puedeLiberar = hasPermission('compras', 'can_edit');

    const [filas,   setFilas]   = useState(null);
    const [error,   setError]   = useState('');
    const [dias,    setDias]    = useState('90');
    const [estado,  setEstado]  = useState('abiertas');

    const cargar = useCallback(async () => {
        const { filas: f, error: e } = await fetchFacturasSalaPanel(Number(dias));
        setError(e?.message ?? '');
        setFilas(f);
    }, [dias]);

    useEffect(() => { setFilas(null); cargar(); }, [cargar]);

    const cols = useMemo(
        () => (canVerMontos ? COLS : COLS.filter(c => c.key !== 'monto')),
        [canVerMontos]);

    const visibles = useMemo(() => {
        if (!filas) return null;
        const q = searchTerm.trim().toLowerCase();
        return filas.filter(f => {
            const viva = !f.liberada_at;
            if (estado === 'abiertas'  && !(viva && !f.registrada)) return false;
            if (estado === 'cargadas'  && !(viva && f.registrada))  return false;
            if (estado === 'liberadas' && viva)                     return false;
            if (!q) return true;
            return [f.etiqueta, f.emisor_nombre, f.sala, f.tomada_por, f.items_text,
                    String(f.monto_total)]
                .some(v => String(v ?? '').toLowerCase().includes(q));
        });
    }, [filas, estado, searchTerm]);

    const cargando = visibles === null;
    // El aviso mira TODAS las filas del período, no las filtradas: si alguien
    // está viendo «Ya cargadas» el problema no deja de existir.
    const atrasadas = (filas ?? []).filter(
        f => !f.liberada_at && !f.registrada && (f.dias_sin_cargar ?? 0) >= DIAS_ALERTA);

    const alSoltar = (e) => { if (e) setError(e); else cargar(); };

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 flex-wrap">
                <LiquidSelect value={dias} onChange={v => setDias(v ?? '90')}
                    options={PERIODOS} clearable={false} />
                <LiquidSelect value={estado} onChange={v => setEstado(v ?? 'abiertas')}
                    options={ESTADOS} clearable={false} />
                <div className="flex-1" />
                <span className="text-label text-content-3 font-medium">
                    {cargando ? 'Cargando…'
                        : `${visibles.length} factura${visibles.length !== 1 ? 's' : ''}`}
                </span>
            </div>

            {error && <p className="text-label text-danger-text font-medium px-1">{error}</p>}

            {/* Lo que hay que mirar al entrar. No es el conteo de la tabla: es
                lo que se tomó y nunca llegó a cargarse. */}
            {!cargando && atrasadas.length > 0 && (
                <div data-surface="card" className="px-3 py-2.5 flex items-start gap-2">
                    <AlertTriangle size={14} className="text-warning-text shrink-0 mt-0.5" strokeWidth={2.5} />
                    <p className="text-label text-content-2 leading-snug">
                        <span className="font-black text-content">
                            {atrasadas.length} factura{atrasadas.length !== 1 ? 's' : ''}
                        </span>
                        {' '}tomada{atrasadas.length !== 1 ? 's' : ''} hace {DIAS_ALERTA} días o más
                        y todavía sin cargar como compra
                        {canVerMontos && (
                            <> · {formatMoney(atrasadas.reduce((s, f) => s + Number(f.monto_total || 0), 0))}</>
                        )}.
                    </p>
                </div>
            )}

            <DataTable columns={cols} loading={cargando}
                empty={{ icon: ReceiptText, message: 'Sin facturas tomadas en este período' }}>
                {(visibles ?? []).map((f, i) => (
                    <DataRow key={f.claim_id} index={i}>
                        <DataCell align="left">
                            <span className="tabular-nums text-content-2 text-label">{fmtFecha(f.fecha_emision)}</span>
                        </DataCell>
                        <DataCell align="left">
                            <span className="font-bold text-content text-label">{f.etiqueta ?? '—'}</span>
                            <span className="block text-micro text-content-3 truncate max-w-[16rem]">
                                {f.emisor_nombre}
                            </span>
                        </DataCell>
                        <DataCell align="left" hideBelow="lg">
                            <span className="text-micro text-content-3 line-clamp-2 max-w-[20rem]">
                                {resumenRenglones(f.items_text)}
                            </span>
                        </DataCell>
                        {canVerMontos && (
                            <DataCell align="right">
                                <span className="tabular-nums font-bold text-content text-label">
                                    {formatMoney(f.monto_total)}
                                </span>
                            </DataCell>
                        )}
                        <DataCell align="left">
                            <span className="text-content-2 text-label">{f.sala ?? '—'}</span>
                        </DataCell>
                        <DataCell align="left" hideBelow="md">
                            <span className="text-content-2 text-label">{f.tomada_por ?? '—'}</span>
                            <span className="block text-micro text-content-3">
                                {fmtCuando(f.tomada_at)}
                                {f.origen === 'linea' && ' · por su línea'}
                            </span>
                        </DataCell>
                        <DataCell align="center">
                            {f.liberada_at ? (
                                <Badge variant="neutral" size="sm">Liberada</Badge>
                            ) : f.registrada ? (
                                <Badge variant="success" size="sm">Cargada</Badge>
                            ) : (f.dias_sin_cargar ?? 0) >= DIAS_ALERTA ? (
                                <Badge variant="warning" size="sm">
                                    Sin cargar · {f.dias_sin_cargar}d
                                </Badge>
                            ) : (
                                <Badge variant="info" size="sm">Sin cargar</Badge>
                            )}
                        </DataCell>
                        <DataCell align="right">
                            {/* Liberar una ya cargada también se ofrece: si la
                                sala la cargó por error, devolverla al montón es
                                justamente lo que hay que poder hacer. Lo que la
                                sala NO puede hacer sola es esto. */}
                            {puedeLiberar && !f.liberada_at && (
                                <BotonLiberar claimId={f.claim_id} onHecho={alSoltar} />
                            )}
                        </DataCell>
                    </DataRow>
                ))}
            </DataTable>
        </div>
    );
}
