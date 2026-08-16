import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    ReceiptText, Download, Check, Undo2, PackageCheck,
} from 'lucide-react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import SearchInput from '../../components/common/SearchInput';
import { EmptyState, SkeletonText } from '../../components/common/StateViews';
import LanzadorSolicitud, { HerramientasModal } from './LanzadorSolicitud';
import { BarraTramos, FranjaVacia } from './InstrumentoBaldosa';
import {
    fetchFacturasSala, reclamarFactura, soltarFactura, resumenRenglones,
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

// La misma trampa que esquiva `fmtFecha`, y la franja de antigüedad caía en
// ella: `new Date('2026-08-10').getTime()` es medianoche UTC —las 18:00 del día
// ANTERIOR en El Salvador— y se restaba contra un reloj local, así que toda
// factura contaba 6 horas de más y cruzaba los cortes de 2 y 7 días esa
// cantidad antes de tiempo. Se arma la fecha como medianoche LOCAL.
const diasDesde = (iso, ahora) => {
    if (!iso) return 0;
    const [a, m, d] = iso.split('-').map(Number);
    return (ahora - new Date(a, m - 1, d).getTime()) / 86400000;
};

/* ─── Una factura ─────────────────────────────────────────────────────────── */
function FilaFactura({ fila, branchId, onCambio, onAviso }) {
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
        // El aviso NO puede vivir en esta fila. El caso que importa es el que
        // el diseño promete resolver —«Otra sala tomó esta factura primero»— y
        // ahí la recarga hace desaparecer la fila: el mensaje se iría montado
        // en ella y la sala vería su factura esfumarse sin explicación. Sube al
        // panel, que sigue en pantalla.
        onAviso(e ?? '');
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
                        nada: "GARRAFA DE AGUA", "RECARGA TIGO $ 25.00 × 16".
                        Por eso va completo y no recortado a una palabra.
                        El número que el proveedor pone ADELANTE de la
                        descripción es su código de producto y no se muestra:
                        "4 GARRAFA DE AGUA" es el producto n.º 4, no cuatro
                        garrafas — el detalle, en `resumenRenglones`. */}
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
//
// Ya no pide nada: recibe la lista que la baldosa trajo al montarse. Cuando se
// abre el modal, los datos están — se ve la lista, no un esqueleto.
function PanelFacturas({ filas, error, cargando, branchId, selectorSucursal, onCambio }) {
    const [busca, setBusca] = useState('');
    const [aviso, setAviso] = useState('');

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

    // Tres grupos y no dos. «De tu línea» estaba cayendo bajo el rótulo «Sin
    // asignar», que dice exactamente lo contrario: esa factura SÍ está asignada
    // —por el número de teléfono— y lo único que falta es confirmarla.
    //
    // Y los grupos filtran por el estado que les toca en vez de por «todo lo que
    // no es mío»: si algún día vuelve a pedirse `incluirTomadas`, las de otras
    // salas no se colarán en «Sin asignar» con un botón que la base va a
    // rechazar.
    const mias     = (visibles ?? []).filter(f => f.estado === 'mia');
    const deLinea  = (visibles ?? []).filter(f => f.estado === 'mia_linea');
    const abiertas = (visibles ?? []).filter(f => f.estado === 'disponible');

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

            {/* El aviso de la carrera: la fila que lo produjo ya no está. */}
            {aviso && <p className="text-label text-danger-text font-medium px-1">{aviso}</p>}

            {cargando && <SkeletonText lines={4} />}

            {!cargando && visibles.length === 0 && (
                <EmptyState linea icon={PackageCheck}
                    title={busca ? `Nada coincide con «${busca}»` : 'No hay facturas esperando en este período'} />
            )}

            {!cargando && mias.length > 0 && (
                <div className="flex flex-col gap-2">
                    <p className="text-caption font-black text-content-2 uppercase tracking-widest px-1">
                        Tuyas · descargalas para cargar la compra
                    </p>
                    {mias.map(f => (
                        <FilaFactura key={f.document_id} fila={f} branchId={branchId}
                            onCambio={onCambio} onAviso={setAviso} />
                    ))}
                </div>
            )}

            {!cargando && deLinea.length > 0 && (
                <div className="flex flex-col gap-2">
                    <p className="text-caption font-black text-content-2 uppercase tracking-widest px-1">
                        De tu línea · confirmá que son tuyas
                    </p>
                    {deLinea.map(f => (
                        <FilaFactura key={f.document_id} fila={f} branchId={branchId}
                            onCambio={onCambio} onAviso={setAviso} />
                    ))}
                </div>
            )}

            {!cargando && abiertas.length > 0 && (
                <div className="flex flex-col gap-2">
                    <p className="text-caption font-black text-content-2 uppercase tracking-widest px-1">
                        Sin asignar
                    </p>
                    {abiertas.map(f => (
                        <FilaFactura key={f.document_id} fila={f} branchId={branchId}
                            onCambio={onCambio} onAviso={setAviso} />
                    ))}
                </div>
            )}

        </div>
    );
}

/* ─── La baldosa del tablero ──────────────────────────────────────────────── */
//
// ── Una sola consulta para el número Y la lista (2026-08-07) ───────────────
// Reportado: «el widget es lento». No era la base —la consulta tarda 10 ms y
// devuelve 22 filas— sino cuántas veces se pedía lo mismo:
//
//   1. al montar el tablero      → `contar_facturas_sala`
//   2. al abrir el modal         → `get_facturas_sala`
//   3. al terminar de cargar     → `contar_facturas_sala` OTRA VEZ (el panel
//                                   llamaba `onCambio` al final de su carga)
//
// Y las tres corrían **la misma consulta pesada**: `contar_facturas_sala` es
// literalmente `SELECT count(*) FROM get_facturas_sala(...)`, así que materializa
// las 17 columnas —`items_text` incluido— para devolver un entero. El costo no
// estaba en el SQL sino en los viajes: tres round-trips a Supabase, y el tercero
// no aportaba un dato que no estuviera ya en la respuesta del segundo.
//
// Ahora la baldosa trae la lista al montarse y el número sale de contarla acá.
// El servidor hace exactamente el mismo trabajo que antes hacía para el conteo
// —la misma consulta— y a cambio **abrir el modal no pide nada**: los datos ya
// están. El costo es el payload, medido: 14 kB para 22 filas.
//
// De paso se cierra un defecto que nadie había mirado: el conteo usaba el
// DEFAULT de 45 días del RPC y la lista pedía 30, así que la baldosa prometía
// 32 facturas y el panel mostraba 22. Ahora hay una sola ventana porque hay una
// sola consulta.
export default function WidgetFacturasSala({ branchId, selectorSucursal }) {
    const [filas, setFilas] = useState(null);
    const [ahora, setAhora] = useState(null);
    const [error, setError] = useState('');

    // Sin `setFilas(null)` al recargar: era una escritura sincrónica dentro del
    // efecto (render en cascada, lo marca `react-hooks/set-state-in-effect`) y
    // encima parpadeaba. El esqueleto sale del estado inicial `null`, así que se
    // ve en la PRIMERA carga; en las siguientes la lista anterior se queda hasta
    // que llega la nueva, que es lo que conviene.
    const cargar = useCallback(async () => {
        const { filas: f, error: e } = await fetchFacturasSala(branchId, { dias: DIAS_VISIBLES });
        setError(e?.message ?? '');
        setFilas(f);
        setAhora(Date.now());
    }, [branchId]);

    // El `setState` ocurre DESPUÉS del `await`, no en el cuerpo del efecto, así
    // que no encadena renders — la regla no puede distinguirlo. Misma anotación
    // y mismo motivo que en `TrasladosView`.
    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial de datos

    // Mismo criterio que tenía `contar_facturas_sala` en la base: lo que espera
    // que alguien la tome. Lo que ya es mío no está esperando nada.
    const pendientes = useMemo(
        () => (filas === null ? null : filas.filter(f => f.estado === 'disponible' || f.estado === 'mia_linea').length),
        [filas],
    );

    // ── La franja: cuánto hay esperando y desde cuándo ───────────────────────
    // «19 facturas esperando» no distingue entre 19 que llegaron hoy y 19 que
    // llevan dos semanas durmiendo, y son dos situaciones distintas. El monto y
    // los tres tramos de antigüedad salen de `monto_total` y `fecha_emision`,
    // que `get_facturas_sala` ya devuelve en cada fila — no hay consulta nueva.
    // `ahora` se congela cuando LLEGAN los datos y no en cada render: la
    // antigüedad de una factura se mide contra el momento en que se leyó la
    // lista, no contra el reloj de un re-render cualquiera. Además `Date.now()`
    // dentro de un `useMemo` es una llamada impura durante el render y el
    // compilador de React la rechaza — con razón: el mismo estado daría
    // resultados distintos según cuándo se vuelva a dibujar.
    const franja = useMemo(() => {
        if (filas === null || ahora === null) return null;
        const esperando = filas.filter(f => f.estado === 'disponible' || f.estado === 'mia_linea');
        if (!esperando.length) return { tramos: [], monto: 0, viejas: 0 };

        const dias = (f) => diasDesde(f.fecha_emision, ahora);
        const recientes = esperando.filter(f => dias(f) < 2).length;
        const medias    = esperando.filter(f => dias(f) >= 2 && dias(f) <= 7).length;
        const viejas    = esperando.filter(f => dias(f) > 7).length;
        const total     = esperando.length;

        return {
            // El orden de los tramos es el mismo en que los nombra el renglón:
            // de lo más nuevo a lo más viejo, izquierda a derecha.
            tramos: [
                { frac: recientes / total, tinta: 'suave'  },
                { frac: medias    / total, tinta: 'medio'  },
                { frac: viejas    / total, tinta: 'fuerte' },
            ],
            monto: esperando.reduce((a, f) => a + Number(f.monto_total ?? 0), 0),
            viejas,
        };
    }, [filas, ahora]);

    return (
        <LanzadorSolicitud
            icon={ReceiptText}
            label="Facturas de mi sala"
            pendientes={pendientes}
            etiquetaPendientes="factura esperando"
            etiquetaPendientesPlural="facturas esperando"
            vacio="Sin facturas"
            tono="brand"
            maxWidth="max-w-2xl"
            descripcion="Toma la factura de tu sala para cargar la compra"
            instrumento={franja === null
                ? <FranjaVacia />
                : <BarraTramos tramos={franja.tramos} />}
            detalle={franja?.monto
                ? `${formatMoney(franja.monto)}${franja.viejas ? ` · ${franja.viejas} de +7 d` : ''}`
                : null}
        >
            {() => (
                <PanelFacturas
                    filas={filas}
                    error={error}
                    cargando={filas === null}
                    branchId={branchId}
                    selectorSucursal={selectorSucursal}
                    onCambio={cargar}
                />
            )}
        </LanzadorSolicitud>
    );
}
