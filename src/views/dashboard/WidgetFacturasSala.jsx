import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    ReceiptText, Download, Check, Undo2, PackageCheck,
} from 'lucide-react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import SearchInput from '../../components/common/SearchInput';
import { SkeletonText } from '../../components/common/StateViews';
import LanzadorSolicitud, { HerramientasModal } from './LanzadorSolicitud';
import {
    fetchFacturasSala, contarFacturasSala, reclamarFactura, soltarFactura,
    resumenRenglones,
} from '../../data/facturasSala';
import { downloadPurchaseDtePackage } from '../../data/facturasCompra';
import { formatMoney } from '../../utils/formatNumber';

// Widget «Facturas de mi Sala».
//
// El problema, medido el 2026-08-07: las salas necesitan la factura del
// proveedor para cargar la compra —agua, recargas de Tigo, Claro y Movistar— y
// hoy no hay forma de saber cuál le toca a cada una ni si otra ya la cargó.
//
// ── Por qué es una LISTA y no un buscador ─────────────────────────────────
// La idea original era buscar por fecha ±3 días, proveedor y monto ±$X. Tiene
// dos agujeros que se ven en los datos reales:
//
//   1. Cero resultados no distingue «no llegó» de «el monto que recordás está
//      mal». Con la lista delante, vacío significa vacío.
//   2. El filtro no prueba de quién es la factura. $184.68 aparece en 9 de los
//      21 documentos de recargas del bimestre —siempre "200 × RECARGA CLARO
//      $1.00"— así que dos salas que compraron lo mismo el mismo día producen
//      dos filas idénticas. Ningún filtro las separa.
//
// El volumen lo permite: ~3 documentos por sala al mes. El buscador de arriba
// acota la lista, nunca es la única forma de llegar a una fila.
//
// ── Lo que de verdad resuelve el problema ─────────────────────────────────
// El candado está en la base (índice único parcial), no acá: dos salas que
// aprietan Tomar en el mismo segundo, una entra y la otra recibe el aviso.
// Y tomar la factura ESCRIBE la llave documento↔compra que hoy no existe —
// `documento_numero` viene cortado a 20 caracteres y cada sala lo teclea
// distinto ('DTE-11662', '13130', 'C09DCEC3-2D29-479B-A'…).

// ── Un mes, y no se pregunta (2026-08-07) ──────────────────────────────────
// Pedido del usuario: «último mes (30 días) nada más, así que no debe haber un
// selector». Y es lo correcto: una factura de agua de la semana pasada se toma
// esta semana. Un desplegable de período convertía en pregunta algo que tiene
// una sola respuesta buena, y encima ocupaba el lugar del buscador.
//
// Lo que caiga fuera del mes ya no es trabajo de sala: eso se resuelve desde
// «Facturas de Sala» en Compras, que sí tiene su propio período.
const DIAS_VISIBLES = 30;

const fmtFecha = (iso) => {
    if (!iso) return '';
    // `iso` es un `date` de Postgres (YYYY-MM-DD). Partirlo a mano y no con
    // `new Date(iso)`: eso lo lee como UTC medianoche y en El Salvador (-6)
    // retrocede un día — la factura del 1 se muestra como del 31.
    const [a, m, d] = iso.split('-');
    return `${d}/${m}/${a.slice(2)}`;
};

/* ─── Una factura ─────────────────────────────────────────────────────────── */
function FilaFactura({ fila, branchId, onCambio }) {
    const [ocupado, setOcupado] = useState(false);
    const [error,   setError]   = useState('');

    // Sin `estado === 'tomada'`: quitada la casilla de «ver las de otras salas»
    // (2026-08-07), el RPC ya no las devuelve y esa rama no podía pintarse.
    // Quién tomó qué se ve completo en Compras → «Facturas de Sala».
    const mia     = fila.estado === 'mia';
    const deLinea = fila.estado === 'mia_linea';

    const tomar = async () => {
        setError(''); setOcupado(true);
        const { error: e } = await reclamarFactura(fila.document_id, branchId);
        setOcupado(false);
        if (e) { setError(e); onCambio(); return; }   // recargar: quizá otra la tomó
        onCambio();
    };

    const soltar = async () => {
        setError(''); setOcupado(true);
        const { error: e } = await soltarFactura(fila.claim_id, 'La sala la soltó');
        setOcupado(false);
        if (e) { setError(e); return; }
        onCambio();
    };

    const descargar = async () => {
        setError(''); setOcupado(true);
        try {
            await downloadPurchaseDtePackage(fila);
        } catch (e) {
            setError(e?.message ?? 'No se pudo descargar el archivo.');
        }
        setOcupado(false);
    };

    return (
        <div data-surface="card" className="px-3 py-2.5 flex flex-col gap-2">
            <div className="flex items-start gap-2">
                <ReceiptText size={13} className="text-content-2 shrink-0 mt-0.5" strokeWidth={2.5} />
                <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                        <p className="text-label font-black text-content leading-tight flex-1 min-w-0 truncate">
                            {fila.etiqueta}
                        </p>
                        <p className="text-label font-black text-content shrink-0 tabular-nums">
                            {formatMoney(fila.monto_total)}
                        </p>
                    </div>
                    <p className="text-micro text-content-3 mt-0.5 truncate">
                        {fmtFecha(fila.fecha_emision)} · {fila.emisor_nombre}
                        {fila.linea && ` · línea ${fila.linea}`}
                    </p>
                    {/* El renglón es lo que deja reconocer la factura sin abrir
                        nada: "4 GARRAFA DE AGUA", "RECARGA TIGO $ 25.00 · Cant.: 16".
                        Por eso va completo y no recortado a una palabra. */}
                    <p className="text-micro text-content-2 mt-1 leading-snug">
                        {resumenRenglones(fila.items_text)}
                    </p>
                </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
                {mia && (
                    <Badge variant={fila.registrada ? 'success' : 'info'} size="sm">
                        {fila.registrada ? 'Tuya · ya cargada' : 'Tuya'}
                    </Badge>
                )}
                {deLinea && <Badge variant="info" size="sm">De tu línea</Badge>}

                <div className="flex-1" />

                {mia ? (
                    <>
                        <Button size="sm" variant="ghost" icon={Download}
                            loading={ocupado} onClick={descargar}>
                            Descargar
                        </Button>
                        {/* Soltar solo mientras nadie la haya registrado como
                            compra. Pasado eso lo decide contabilidad — y el RPC
                            lo impone, esto solo evita ofrecer lo que va a fallar. */}
                        {!fila.registrada && (
                            <Button size="sm" variant="ghost" icon={Undo2}
                                loading={ocupado} onClick={soltar}>
                                Soltar
                            </Button>
                        )}
                    </>
                ) : (
                    <Button size="sm" icon={Check} loading={ocupado} onClick={tomar}>
                        {ocupado ? 'Tomando...' : 'Es de mi sala'}
                    </Button>
                )}
            </div>

            {error && <p className="text-micro text-danger-text font-medium">{error}</p>}
        </div>
    );
}

/* ─── El contenido del modal ──────────────────────────────────────────────── */
function PanelFacturas({ branchId, selectorSucursal, onCambio }) {
    const [filas,    setFilas]    = useState(null);
    const [error,    setError]    = useState('');
    const [busca,    setBusca]    = useState('');

    // Sin `setFilas(null)` al recargar: era una escritura sincrónica dentro del
    // efecto (render en cascada, lo marca `react-hooks/set-state-in-effect`) y
    // encima parpadeaba. El esqueleto sale del estado inicial `null`, así que se
    // ve en la PRIMERA carga; en las siguientes la lista anterior se queda hasta
    // que llega la nueva, que es lo que conviene.
    const cargar = useCallback(async () => {
        const { filas: f, error: e } = await fetchFacturasSala(branchId, {
            dias: DIAS_VISIBLES,
        });
        setError(e?.message ?? '');
        setFilas(f);
        onCambio?.();
    }, [branchId, onCambio]);

    useEffect(() => { cargar(); }, [cargar]);

    // El buscador barre monto, proveedor, etiqueta y el renglón: teclear "184"
    // deja las de $184.68 y teclear "tigo" deja las recargas. Es el filtro por
    // monto que se pedía, sin la tolerancia ±$X — que no hace falta cuando la
    // lista ya está en pantalla y no hay nada que adivinar.
    const visibles = useMemo(() => {
        if (!filas) return null;
        const q = busca.trim().toLowerCase();
        if (!q) return filas;
        return filas.filter(f => [
            f.etiqueta, f.emisor_nombre, f.items_text, f.linea,
            String(f.monto_total), fmtFecha(f.fecha_emision),
        ].some(v => String(v ?? '').toLowerCase().includes(q)));
    }, [filas, busca]);

    const cargando = visibles === null;
    const mias     = (visibles ?? []).filter(f => f.estado === 'mia');
    const abiertas = (visibles ?? []).filter(f => f.estado !== 'mia');

    return (
        <div className="flex flex-col gap-3 flex-1 min-h-0">
            <HerramientasModal>
                <div className="flex items-center gap-2 flex-wrap">
                    {selectorSucursal}
                    <div className="flex-1 min-w-[120px]">
                        <SearchInput
                            value={busca}
                            onChange={setBusca}
                            size="sm"
                            placeholder="Monto, proveedor o producto..."
                            ariaLabel="Buscar entre las facturas de la sala"
                        />
                    </div>
                </div>
            </HerramientasModal>

            {error && <p className="text-label text-danger-text font-medium px-1">{error}</p>}

            {cargando && <SkeletonText lines={4} />}

            {!cargando && visibles.length === 0 && (
                <div className="flex flex-col items-center justify-center flex-1 gap-2 py-8">
                    <PackageCheck size={28} strokeWidth={1.5} className="text-content-3" />
                    <p className="text-label font-semibold text-content-3 text-center leading-snug">
                        {busca
                            ? <>Nada coincide con «{busca}»</>
                            : <>No hay facturas esperando<br />en este período</>}
                    </p>
                </div>
            )}

            {!cargando && mias.length > 0 && (
                <div className="flex flex-col gap-2">
                    <p className="text-caption font-black text-content-2 uppercase tracking-widest px-1">
                        Tuyas · descargalas para cargar la compra
                    </p>
                    {mias.map(f => (
                        <FilaFactura key={f.document_id} fila={f} branchId={branchId} onCambio={cargar} />
                    ))}
                </div>
            )}

            {!cargando && abiertas.length > 0 && (
                <div className="flex flex-col gap-2">
                    <p className="text-caption font-black text-content-2 uppercase tracking-widest px-1">
                        Sin asignar
                    </p>
                    {abiertas.map(f => (
                        <FilaFactura key={f.document_id} fila={f} branchId={branchId} onCambio={cargar} />
                    ))}
                </div>
            )}

        </div>
    );
}

/* ─── La baldosa del tablero ──────────────────────────────────────────────── */
export default function WidgetFacturasSala({ branchId, selectorSucursal }) {
    const [pendientes, setPendientes] = useState(null);

    // Sin la guarda de `!branchId`: `contarFacturasSala` ya devuelve 0 en ese
    // caso, así que acá sólo duplicaba la regla — y de paso escribía estado de
    // forma sincrónica dentro del efecto que la llama.
    const contar = useCallback(() => {
        contarFacturasSala(branchId).then(r => setPendientes(r.total));
    }, [branchId]);

    useEffect(() => { contar(); }, [contar]);

    return (
        <LanzadorSolicitud
            icon={ReceiptText}
            label="Facturas de mi Sala"
            pendientes={pendientes}
            etiquetaPendientes="factura esperando"
            etiquetaPendientesPlural="facturas esperando"
            vacio="Nada esperando"
            tono="brand"
            maxWidth="max-w-2xl"
            descripcion="Tomá la factura de tu sala para cargar la compra"
        >
            {() => (
                <PanelFacturas
                    branchId={branchId}
                    selectorSucursal={selectorSucursal}
                    onCambio={contar}
                />
            )}
        </LanzadorSolicitud>
    );
}
