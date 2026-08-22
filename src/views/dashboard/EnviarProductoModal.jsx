import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Check, Loader2, Pencil, Send, Trash2, X } from 'lucide-react';
import Button from '../../components/common/Button';
import LiquidModal from '../../components/common/LiquidModal';
import LiquidSelect from '../../components/common/LiquidSelect';
import SearchInput from '../../components/common/SearchInput';
import SegmentedControl from '../../components/common/SegmentedControl';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import { EmptyState } from '../../components/common/StateViews';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore } from '../../store/staffStore';
import { buscarInventarioGlobalV2 } from '../../data/inventory';
import { fetchPresentaciones } from '../../data/inventoryMovements';
import { crearEnvio, despacharEnvio, MOTIVOS_ENVIO } from '../../data/envios';
import { lotesEnUnidades, repartirPedido, sumaUnidades } from '../../utils/unidadesInventario';
import { opcionesDePresentacion } from '../../utils/presentacion';
import { saveDraft, loadDraft, clearDraft } from '../../utils/draftUtils';
import { clickable } from '../../utils/clickable';

// Mandarle producto a otra sala sin que te lo pidan.
//
// Es el compositor de `PedirTrasladoModal` mirando al otro lado, y por eso se
// parece tanto: dos pantallas que hacen lo mismo con dos dibujos distintos
// obligan a aprender dos veces. Las mismas dos pestañas —«Agregar» y «En el
// envío · N»—, la misma tarjeta que nace cerrada, el mismo desplegable de
// presentación.
//
// ── Las tres diferencias, y las tres son de fondo ─────────────────────────
// 1. **El buscador busca en MI sala.** Allá se busca dónde HAY para pedirlo;
//    acá se busca lo que TENGO para mandarlo. Por eso sale de la búsqueda de
//    inventario recortada a la sala propia, y no de `fetchDondeHay`.
// 2. **La sala se elige al final y es UNA.** Allá cada renglón lleva su origen
//    —se le pide a tres salas en la misma composición—; acá el envío entero va
//    a una sola sala, porque es UNA caja que sale con el motorista.
// 3. **Al apretar, el producto SALE.** No hay nadie que apruebe antes: la
//    decisión de la otra sala llega después, cuando tiene la caja enfrente. Por
//    eso el botón dice «Transferir» y el pie avisa qué va a pasar.

/** Cuántas letras antes de salir a preguntar (misma regla que la consulta). */
const MIN_LETRAS = 3;

const NOMBRE_SALA = { 1: 'Salud 1', 2: 'Salud 2', 3: 'Salud 3', 4: 'Salud 4', 5: 'La Popular', 6: 'Bodega', 7: 'Salud 5' };
const MI_ERP_POR_BRANCH = { 2: 5, 4: 1, 25: 2, 27: 3, 28: 4, 29: 7, 30: 6 };

const fmtVence = (d) => d
    ? new Date(d + 'T12:00:00').toLocaleDateString('es-SV', { month: 'short', year: '2-digit' })
    : 'sin fecha';

export default function EnviarProductoModal({ onClose, onListo }) {
    const { user } = useAuth();
    const appendAuditLog = useStaffStore(s => s.appendAuditLog);

    const miBranch = user?.branchId ?? user?.branch_id ?? null;
    const miErp    = MI_ERP_POR_BRANCH[miBranch] ?? null;
    const claveBorrador = `envio_${miBranch ?? 'sin_sala'}`;

    const [pestana, setPestana] = useState('agregar');
    const [termino, setTermino] = useState('');
    const [buscando, setBuscando] = useState(false);
    const [resultados, setResultados] = useState(null);
    const [elegido, setElegido] = useState(null);
    const [presentaciones, setPresentaciones] = useState([]);
    const [presIdx, setPresIdx] = useState('0');
    const [cantidad, setCantidad] = useState('1');

    const [renglones, setRenglones] = useState([]);
    const [editando, setEditando] = useState(null);
    const [destino, setDestino] = useState('');
    const [motivo, setMotivo] = useState('');
    const [nota, setNota] = useState('');

    const [enviando, setEnviando] = useState(false);
    const [error, setError] = useState('');
    const [resultado, setResultado] = useState(null);

    /* ── El borrador ──────────────────────────────────────────────────────
     * La sesión de sala se cierra sola a los cinco minutos y esto es un
     * formulario largo: sin borrador, armar un envío de ocho productos y
     * atender a alguien en el medio significa volver a empezar, sin aviso y sin
     * rastro. Se guarda lo que se ESCRIBIÓ —renglones, sala, motivo—, nunca el
     * resultado: un envío que ya salió no se recompone. */
    useEffect(() => {
        const d = loadDraft(claveBorrador);
        if (!d) return;
        if (Array.isArray(d.renglones) && d.renglones.length) {
            setRenglones(d.renglones);
            setPestana('lista');
        }
        if (d.destino) setDestino(String(d.destino));
        if (d.motivo)  setMotivo(String(d.motivo));
        if (d.nota)    setNota(String(d.nota));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo al abrir
    }, []);

    useEffect(() => {
        if (resultado) return;
        if (!renglones.length && !destino && !motivo && !nota) return;
        saveDraft(claveBorrador, { renglones, destino, motivo, nota });
    }, [renglones, destino, motivo, nota, claveBorrador, resultado]);

    /* ── El buscador ──────────────────────────────────────────────────────
     * Sale de la misma búsqueda que la consulta de inventario y se recorta a MI
     * sala: lo que otra sala tenga no se puede mandar desde acá. Y se descarta
     * el área de próximos a vencer de Bodega — de ahí todavía no se envía (el
     * despacho sale del estante de operación), así que ofrecerlo produciría un
     * envío que rebota al apretar. */
    useEffect(() => {
        const q = termino.trim();
        if (q.length < MIN_LETRAS || !miErp) { setResultados(null); return; }
        let cancelado = false;
        setBuscando(true);
        const t = setTimeout(() => {
            buscarInventarioGlobalV2(q).then(({ filas }) => {
                if (cancelado) return;
                const porProducto = new Map();
                for (const f of filas ?? []) {
                    if (Number(f.erp_sucursal_id) !== Number(miErp)) continue;
                    if (f.is_vencidos) continue;
                    if (!porProducto.has(f.erp_product_id)) {
                        porProducto.set(f.erp_product_id, {
                            erp_product_id: f.erp_product_id,
                            descripcion: f.descripcion,
                            filas: [],
                        });
                    }
                    porProducto.get(f.erp_product_id).filas.push(f);
                }
                setResultados([...porProducto.values()].map(p => ({
                    ...p,
                    unidades: sumaUnidades(p.filas),
                    lotes: lotesEnUnidades(p.filas),
                })).filter(p => p.unidades > 0));
                setBuscando(false);
            }).catch(() => { if (!cancelado) { setResultados([]); setBuscando(false); } });
        }, 250);
        return () => { cancelado = true; clearTimeout(t); setBuscando(false); };
    }, [termino, miErp]);

    // Las presentaciones del producto elegido. Viajan por SIGNIFICADO —tipo +
    // factor—, nunca por su id: el portal y el sistema de origen las numeran
    // distinto y sólo la etiqueta es estable entre los dos.
    useEffect(() => {
        if (!elegido?.erp_product_id) { setPresentaciones([]); return; }
        let cancelado = false;
        setPresentaciones([]);
        setPresIdx('0');
        fetchPresentaciones([elegido.erp_product_id]).then(r => {
            if (cancelado) return;
            setPresentaciones(r.porProducto.get(elegido.erp_product_id) ?? []);
        }).catch(() => {});
        return () => { cancelado = true; };
    }, [elegido?.erp_product_id]);

    const pres = presentaciones[Number(presIdx)] ?? null;
    const unidadesPedidas = (Number(cantidad) || 0) * (Number(pres?.factor) || 0);
    const reparto = useMemo(
        () => (elegido && unidadesPedidas > 0
            ? repartirPedido(elegido.lotes ?? [], unidadesPedidas)
            : { reparto: [], faltan: 0 }),
        [elegido, unidadesPedidas],
    );

    const problemaDelPaso = !elegido ? 'Elige un producto.'
        : !pres ? 'Elige la presentación.'
        : unidadesPedidas <= 0 ? 'Pon la cantidad.'
        : unidadesPedidas > (elegido.unidades ?? 0)
            ? `Tu sala tiene ${elegido.unidades} ${elegido.unidades === 1 ? 'unidad' : 'unidades'}.`
        : reparto.faltan > 0 ? `Faltan ${reparto.faltan} en los lotes.`
        : null;

    const agregar = useCallback(() => {
        if (problemaDelPaso || !elegido || !pres) return;
        setRenglones(r => [...r, {
            erp_product_id: elegido.erp_product_id,
            descripcion: elegido.descripcion,
            presentacion_tipo: pres.tipo,
            factor: Number(pres.factor),
            cantidad: Number(cantidad),
            unidades: unidadesPedidas,
            // El reparto por lote viaja con el renglón: es la elección de quien
            // manda, y lo que el despacho usa como reserva. Sin él, quien
            // despacha elegiría el lote por su cuenta — y un envío por «próximo
            // a vencer» sin decir cuál lote es exactamente lo contrario de lo
            // que se quiso hacer.
            lotes: reparto.reparto.map(l => ({ lote: l.lote, vence: l.vence, unidades: l.toma })),
            // Cuántas tiene la sala AHORA. Es lo que deja avisar en la lista si
            // se agregó dos veces el mismo producto y entre los dos se pasan.
            existencia: elegido.unidades,
            presentaciones,
        }]);
        setElegido(null);
        setTermino('');
        setResultados(null);
        setCantidad('1');
        setPestana('lista');
    }, [problemaDelPaso, elegido, pres, cantidad, unidadesPedidas, reparto, presentaciones]);

    const quitar = (i) => {
        setRenglones(r => r.filter((_, k) => k !== i));
        setEditando(null);
    };

    const editarRenglon = (i, cambios) => {
        setRenglones(rs => rs.map((r, k) => {
            if (k !== i) return r;
            const tipo   = cambios.presentacion_tipo ?? r.presentacion_tipo;
            const factor = Number(cambios.factor ?? r.factor) || 1;
            const cant   = cambios.cantidad !== undefined
                ? Math.max(0, Math.floor(Number(cambios.cantidad)) || 0)
                : Number(r.cantidad) || 0;
            // El factor MULTIPLICA: cambiar UNIDAD por CAJA X 10 sin rehacer el
            // reparto convierte 5 en cincuenta veces el producto.
            return { ...r, presentacion_tipo: tipo, factor, cantidad: cant, unidades: cant * factor };
        }));
    };

    /* Lo que suma cada producto entre todos sus renglones, contra lo que la sala
     * tiene. Se mira acá y no renglón por renglón porque el mismo producto
     * puede estar dos veces: dos renglones de 5 sobre una existencia de 8 son
     * dos renglones válidos y un envío imposible, y eso hoy sólo se descubría
     * al apretar. */
    const excesos = useMemo(() => {
        const porProducto = new Map();
        for (const r of renglones) {
            const a = porProducto.get(r.erp_product_id) ?? { unidades: 0, existencia: r.existencia ?? 0, nombre: r.descripcion };
            a.unidades += r.unidades;
            porProducto.set(r.erp_product_id, a);
        }
        return [...porProducto.values()].filter(a => a.unidades > a.existencia);
    }, [renglones]);

    const salasDestino = useMemo(
        () => Object.entries(NOMBRE_SALA)
            .filter(([erp]) => Number(erp) !== Number(miErp))
            .map(([erp, nombre]) => ({ value: erp, label: nombre })),
        [miErp],
    );

    const listoParaMandar = renglones.length > 0 && destino && motivo
        && excesos.length === 0
        && !(motivo === 'Otro' && !nota.trim());

    const transferir = async () => {
        if (!listoParaMandar || enviando) return;
        setEnviando(true);
        setError('');
        try {
            const erpDestino = Number(destino);
            const fila = {
                employee_id: user?.id,
                type: 'INVENTORY_TRANSFER_PUSH',
                status: 'PENDING',
                note: nota.trim() || motivo,
                metadata: {
                    motivo_tipo: motivo,
                    reason: nota.trim() || motivo,
                    // Mi sala: la que ENVÍA.
                    origen_erp_sucursal_id: miErp,
                    origen_branch_name: user?.branchName ?? user?.branch_name ?? NOMBRE_SALA[miErp] ?? '',
                    // La que recibe. El `branch_id` lo resuelve la base desde el
                    // mapa: qué sala del portal es cada sucursal del sistema no
                    // lo decide el navegador.
                    erp_sucursal_id: erpDestino,
                    branch_name: NOMBRE_SALA[erpDestino] ?? '',
                    items: renglones.map(r => ({
                        erp_product_id: r.erp_product_id,
                        descripcion: r.descripcion,
                        presentacion_tipo: r.presentacion_tipo,
                        factor: r.factor,
                        cantidad: r.cantidad,
                        lotes: r.lotes ?? null,
                    })),
                },
            };

            const { data, error: e } = await crearEnvio(fila);
            if (e) throw e;

            /* Y recién ahora sale el producto. Son dos pasos porque el primero
             * deja el rastro —con sus renglones, en la misma transacción— y el
             * segundo mueve inventario: si el segundo no sale, el envío queda
             * con todo por despachar y se retoma desde la tarjeta. Lo que no
             * puede pasar es lo contrario. */
            const r = await despacharEnvio(data.id);

            await appendAuditLog('ENVIO_A_OTRA_SALA', String(miBranch ?? ''), {
                envio: data.id,
                sala: NOMBRE_SALA[erpDestino] ?? erpDestino,
                productos: renglones.length,
                unidades: renglones.reduce((s, x) => s + x.unidades, 0),
                motivo,
                enviadas: r?.enviadas ?? 0,
                fallos: (r?.fallos ?? []).length,
            });

            clearDraft(claveBorrador);
            setResultado({
                sala: NOMBRE_SALA[erpDestino] ?? '',
                total: renglones.length,
                enviadas: r?.enviadas ?? 0,
                fallos: r?.fallos ?? [],
                aviso: r?.error ?? null,
            });
            setRenglones([]);
            onListo?.();
        } catch (e) {
            const msg = String(e?.message ?? '');
            setError(
                msg.includes('row-level security')
                    ? 'No tienes permiso para enviar producto a otra sala.'
                    : (e?.message ?? 'No se pudo enviar.'),
            );
            setEnviando(false);
        }
    };

    /* ── El desenlace ─────────────────────────────────────────────────────
     * Se queda en pantalla hasta que la persona la cierre y NO se autocierra:
     * acá el producto ya salió, y si algún renglón no pudo salir hay que poder
     * leer cuál. */
    if (resultado) {
        return (
            <LiquidModal open onClose={onClose} maxWidth="max-w-lg" ariaLabel="Envío realizado">
                <LiquidModal.Header>
                    <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-xl bg-success/10 flex items-center justify-center shrink-0">
                            <Check size={16} className="text-success-text" strokeWidth={2.5} />
                        </div>
                        <p className="text-body font-black text-content">Producto en camino</p>
                    </div>
                </LiquidModal.Header>
                <LiquidModal.Body className="flex flex-col gap-3">
                    <p className="text-body-sm text-content-2 font-medium leading-snug">
                        Salieron {resultado.enviadas} de {resultado.total}{' '}
                        {resultado.total === 1 ? 'producto' : 'productos'} para {resultado.sala}.
                        {resultado.enviadas > 0 && ' Ya les avisamos: cuando abran la caja deciden qué se quedan.'}
                    </p>
                    {resultado.aviso && (
                        <p className="text-label text-warning-text font-semibold leading-snug">{resultado.aviso}</p>
                    )}
                    {resultado.fallos.length > 0 && (
                        <div className="flex flex-col gap-1">
                            <p className="text-caption font-black text-content-2 uppercase tracking-widest">
                                No salieron
                            </p>
                            {resultado.fallos.map((f, i) => (
                                <p key={i} className="text-micro text-danger-text font-semibold leading-snug">
                                    {f.producto}: {f.error}
                                </p>
                            ))}
                            <p className="text-micro text-content-3 font-medium leading-snug mt-1">
                                Quedan en el envío y puedes volver a intentarlo desde «Traslados entre salas».
                            </p>
                        </div>
                    )}
                </LiquidModal.Body>
                <LiquidModal.Footer>
                    <Button variant="primary" onClick={onClose} className="min-h-[var(--tap-min)]">Listo</Button>
                </LiquidModal.Footer>
            </LiquidModal>
        );
    }

    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-lg" ariaLabel="Enviar a otra sala">
            <LiquidModal.Header>
                <div className="flex items-start gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-brand/10 flex items-center justify-center shrink-0">
                        <Send size={15} className="text-brand-text" strokeWidth={2.5} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-body font-black text-content leading-tight">Enviar a otra sala</p>
                        <p className="text-label text-content-3 mt-0.5">
                            Producto que sale de tu sala hacia otra
                        </p>
                    </div>
                    <Button variant="ghost" size="xs" icon={X} iconOnly onClick={onClose} aria-label="Cerrar" />
                </div>
            </LiquidModal.Header>

            <LiquidModal.Body className="flex flex-col gap-3 min-h-0">
                <div className="shrink-0">
                    <SegmentedControl
                        value={pestana}
                        onChange={setPestana}
                        options={[
                            { value: 'agregar', label: 'Agregar' },
                            { value: 'lista',   label: `En el envío${renglones.length ? ` · ${renglones.length}` : ''}` },
                        ]}
                    />
                </div>

                {pestana === 'agregar' && (
                    <div className="flex flex-col gap-3">
                        <SearchInput
                            value={termino}
                            onChange={setTermino}
                            placeholder="Busca el producto que vas a mandar"
                            ariaLabel="Buscar producto en tu sala"
                        />

                        {!elegido && (
                            <>
                                {termino.trim().length > 0 && termino.trim().length < MIN_LETRAS && (
                                    <p className="text-micro text-content-3 font-medium px-1">
                                        Escribe al menos {MIN_LETRAS} letras.
                                    </p>
                                )}
                                {buscando && (
                                    <p className="text-label text-content-3 font-medium px-1 flex items-center gap-1.5">
                                        <Loader2 size={13} className="animate-spin" /> Buscando…
                                    </p>
                                )}
                                {!buscando && resultados?.length === 0 && (
                                    <EmptyState linea title="Tu sala no tiene ese producto" />
                                )}
                                {!buscando && resultados?.length > 0 && (
                                    <div className="flex flex-col gap-1.5">
                                        {resultados.map(p => (
                                            <button
                                                key={p.erp_product_id}
                                                type="button"
                                                data-surface="card"
                                                data-interactive
                                                className={`${clickable()} text-left px-3 py-2.5 min-h-[var(--tap-min)]`}
                                                onClick={() => setElegido(p)}
                                            >
                                                <p className="text-body-sm font-black text-content leading-tight">
                                                    {p.descripcion}
                                                </p>
                                                <p className="text-micro font-semibold text-content-2 mt-0.5">
                                                    {p.unidades} {p.unidades === 1 ? 'unidad' : 'unidades'}
                                                    {p.lotes[0]?.vence ? ` · vence ${fmtVence(p.lotes[0].vence)}` : ''}
                                                </p>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </>
                        )}

                        {elegido && (
                            <div data-surface="card" className="px-3 py-3 flex flex-col gap-3">
                                <div className="flex items-start gap-2">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-body-sm font-black text-content leading-tight">
                                            {elegido.descripcion}
                                        </p>
                                        <p className="text-micro font-semibold text-content-2 mt-0.5">
                                            Tu sala tiene {elegido.unidades}{' '}
                                            {elegido.unidades === 1 ? 'unidad' : 'unidades'}
                                        </p>
                                    </div>
                                    <Button variant="ghost" size="xs" icon={X} iconOnly
                                        onClick={() => setElegido(null)} aria-label="Elegir otro producto" />
                                </div>

                                <div className="flex flex-wrap items-end gap-2">
                                    <div className="w-24">
                                        <PortalInput
                                            label="Cantidad"
                                            type="number" min="1"
                                            value={cantidad}
                                            onChange={e => setCantidad(e.target.value)}
                                            aria-label="Cantidad a enviar"
                                        />
                                    </div>
                                    <div className="min-w-[10rem] flex-1">
                                        <p className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5">Presentación</p>
                                        <LiquidSelect
                                            clearable={false}
                                            value={presIdx}
                                            onChange={v => setPresIdx(String(v))}
                                            options={opcionesDePresentacion(presentaciones, elegido.unidades)}
                                            ariaLabel="Presentación"
                                        />
                                    </div>
                                </div>

                                {/* De qué lotes va a salir. No es adorno: un envío por
                                    «próximo a vencer» existe justamente para mandar ESE
                                    lote, y verlo antes es la única forma de saber que se
                                    está mandando el que se quería mandar. */}
                                {reparto.reparto.length > 0 && (
                                    <p className="text-micro font-semibold text-content-2 leading-snug">
                                        Sale de: {reparto.reparto.map(l =>
                                            `${l.lote || 'sin lote'} (${l.toma}, vence ${fmtVence(l.vence)})`).join(' · ')}
                                    </p>
                                )}

                                {problemaDelPaso ? (
                                    <p className="text-micro font-semibold text-danger-text leading-snug">
                                        {problemaDelPaso}
                                    </p>
                                ) : (
                                    <p className="text-micro font-semibold text-content-3 leading-snug">
                                        {unidadesPedidas} {unidadesPedidas === 1 ? 'unidad' : 'unidades'} en total
                                    </p>
                                )}

                                <Button variant="secondary" onClick={agregar}
                                    disabled={Boolean(problemaDelPaso)}
                                    className="min-h-[var(--tap-min)]">
                                    Agregar al envío
                                </Button>
                            </div>
                        )}
                    </div>
                )}

                {pestana === 'lista' && (
                    <div className="flex flex-col gap-3">
                        {renglones.length === 0 ? (
                            <p className="text-label text-content-3 font-medium py-8 text-center leading-snug">
                                Todavía no agregaste nada.<br />
                                <span className="text-micro">
                                    Busca el producto en «Agregar», ponle la cantidad y aprieta «Agregar al envío».
                                </span>
                            </p>
                        ) : (
                            <div className="flex flex-col gap-2">
                                {renglones.map((r, i) => {
                                    const abierta = editando === i;
                                    return (
                                        <div key={i} data-surface="card" className="px-3 py-2.5">
                                            <div className="flex items-start gap-2">
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-body-sm font-black text-content truncate">
                                                        {r.descripcion}
                                                    </p>
                                                    {!abierta && (
                                                        <p className="text-micro font-semibold text-content-2 mt-0.5 truncate">
                                                            {r.cantidad} × {r.presentacion_tipo}
                                                            {' · '}{r.unidades} {r.unidades === 1 ? 'unidad' : 'unidades'}
                                                        </p>
                                                    )}
                                                </div>
                                                <Button variant="ghost" size="xs" iconOnly
                                                    icon={abierta ? Check : Pencil}
                                                    aria-label={abierta ? 'Listo' : `Corregir ${r.descripcion}`}
                                                    onClick={() => setEditando(abierta ? null : i)} />
                                                <Button variant="ghost" size="xs" icon={Trash2} iconOnly
                                                    aria-label={`Quitar ${r.descripcion}`}
                                                    onClick={() => quitar(i)} />
                                            </div>

                                            {abierta && (
                                                <div className="flex flex-wrap items-center gap-2 mt-2">
                                                    <div className="w-20">
                                                        <PortalInput
                                                            type="number" min="1"
                                                            value={String(r.cantidad)}
                                                            onChange={e => editarRenglon(i, { cantidad: e.target.value })}
                                                            aria-label={`Cantidad de ${r.descripcion}`}
                                                        />
                                                    </div>
                                                    {(r.presentaciones ?? []).length > 1 ? (
                                                        <div className="min-w-[9rem] flex-1">
                                                            <LiquidSelect
                                                                nano clearable={false}
                                                                value={`${r.presentacion_tipo}|${r.factor}`}
                                                                onChange={v => {
                                                                    const [tipo, factor] = String(v).split('|');
                                                                    editarRenglon(i, { presentacion_tipo: tipo, factor: Number(factor) });
                                                                }}
                                                                options={(r.presentaciones ?? []).map(p => ({
                                                                    value: `${p.tipo}|${p.factor}`,
                                                                    label: p.tipo,
                                                                }))}
                                                                ariaLabel={`Presentación de ${r.descripcion}`}
                                                            />
                                                        </div>
                                                    ) : (
                                                        <span className="text-micro font-semibold text-content-2">
                                                            {r.presentacion_tipo}
                                                        </span>
                                                    )}
                                                    <span className="text-micro font-semibold text-content-2">
                                                        {r.unidades} {r.unidades === 1 ? 'unidad' : 'unidades'}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {excesos.map(x => (
                            <p key={x.nombre} className="text-micro font-semibold text-danger-text leading-snug px-1">
                                Entre todos los renglones estás mandando {x.unidades} de {x.nombre} y tu sala
                                tiene {x.existencia}.
                            </p>
                        ))}

                        {/* ── Y al final, a quién y por qué ─────────────────
                            La sala va acá y no arriba porque es lo último que se
                            decide: primero se arma la caja, después se elige a
                            dónde va. Y el motivo es obligatorio — es lo único
                            que le explica al otro lado por qué le llegó algo que
                            no pidió. */}
                        <div className="flex flex-col gap-2.5 pt-1">
                            <div>
                                <p className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5">Sala de destino</p>
                            <LiquidSelect
                                value={destino}
                                onChange={v => setDestino(String(v ?? ''))}
                                options={salasDestino}
                                placeholder="¿A qué sala va?"
                                ariaLabel="Sala de destino"
                            />
                            </div>
                            <div>
                                <p className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5">Motivo</p>
                            <LiquidSelect
                                value={motivo}
                                onChange={v => setMotivo(String(v ?? ''))}
                                options={MOTIVOS_ENVIO.map(m => ({ value: m, label: m }))}
                                placeholder="¿Por qué se lo mandas?"
                                ariaLabel="Motivo del envío"
                            />
                            </div>
                            <PortalTextarea
                                label={motivo === 'Otro' ? 'Explica el motivo' : 'Detalle (opcional)'}
                                rows={2}
                                value={nota}
                                onChange={e => setNota(e.target.value)}
                                placeholder={motivo === 'Otro'
                                    ? 'Escribe por qué se lo mandas'
                                    : 'Algo más que la otra sala tenga que saber'}
                            />
                        </div>
                    </div>
                )}

                {error && (
                    <p className="text-label text-danger-text font-semibold leading-snug px-1">{error}</p>
                )}
            </LiquidModal.Body>

            <LiquidModal.Footer>
                <div className="flex flex-col gap-2 w-full">
                    {/* Qué va a pasar al apretar, ANTES de apretar: acá no hay
                        nadie que apruebe primero — el producto sale de tu sala en
                        el momento. */}
                    {pestana === 'lista' && renglones.length > 0 && (
                        <p className="text-micro text-content-3 font-medium leading-snug">
                            Al transferir, el producto sale de tu sala y le avisamos a la otra. Ellos deciden
                            qué se quedan cuando abran la caja.
                        </p>
                    )}
                    <div className="flex items-center justify-end gap-2">
                        <Button variant="ghost" onClick={onClose} className="min-h-[var(--tap-min)]">
                            Cancelar
                        </Button>
                        {pestana === 'agregar' ? (
                            <Button variant="secondary" onClick={() => setPestana('lista')}
                                disabled={renglones.length === 0}
                                className="min-h-[var(--tap-min)]">
                                Revisar el envío
                            </Button>
                        ) : (
                            <Button variant="primary" icon={enviando ? Loader2 : Send}
                                onClick={transferir}
                                disabled={!listoParaMandar || enviando}
                                className="min-h-[var(--tap-min)]">
                                {enviando ? 'Transfiriendo…' : 'Transferir'}
                            </Button>
                        )}
                    </div>
                </div>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
