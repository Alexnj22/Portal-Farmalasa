import React, { useState, useEffect, useMemo } from 'react';
import { ArrowLeftRight, Loader2 } from 'lucide-react';
import Button from '../../components/common/Button';
import LiquidModal from '../../components/common/LiquidModal';
import LiquidSelect from '../../components/common/LiquidSelect';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore } from '../../store/staffStore';
import { fetchPresentaciones } from '../../data/inventoryMovements';
import { crearSolicitudTraslado, fetchDondeHay } from '../../data/traslados';

// Pedirle un producto a otra sala, desde la lista de faltantes.
//
// La lista ya sabe todo lo que hace falta —qué producto, qué salas lo tienen y
// cuántas unidades—, así que acá solo quedan tres decisiones: a cuál pedirle,
// cuánto, y para qué. Esa última es obligatoria: es lo único que queda escrito
// en el movimiento de las dos salas.
//
// ── Lo que NO se elige acá ────────────────────────────────────────────────
// Ni el aprobador ni la ubicación de la sala de origen. Los dos los resuelve la
// base: el primero con la cascada turno → jefatura → Supervisión, el segundo
// desde el mapa de salas. Un navegador que eligiera de dónde sale el producto o
// quién lo autoriza no sería una pantalla, sería un permiso.

const MI_ERP_POR_BRANCH = { 2: 5, 4: 1, 25: 2, 27: 3, 28: 4, 29: 7, 30: 6 };

export default function PedirTrasladoModal({ producto, onClose, onListo }) {
    const { user } = useAuth();
    const appendAuditLog = useStaffStore(s => s.appendAuditLog);
    const [salaId,   setSalaId]   = useState(null);
    const [presIdx,  setPresIdx]  = useState('0');
    const [presentaciones, setPresentaciones] = useState([]);
    const [cantidad, setCantidad] = useState('1');
    const [causa,    setCausa]    = useState('');
    const [enviando, setEnviando] = useState(false);
    const [listo,    setListo]    = useState(false);
    const [error,    setError]    = useState('');

    // La lista de faltantes ya trae sus salas; la búsqueda no. En ese caso se
    // preguntan acá, para que el modal sea UNO solo y no dos que se parecen.
    const [dondeTraido, setDondeTraido] = useState(null);
    const donde = useMemo(
        () => ((producto?.donde ?? dondeTraido) ?? []).filter(d => d?.erp_sucursal_id),
        [producto, dondeTraido],
    );

    const miBranch = user?.branchId ?? user?.branch_id ?? null;
    const miErp    = MI_ERP_POR_BRANCH[miBranch] ?? producto?.erp_sucursal_destino ?? null;

    useEffect(() => {
        if (producto?.donde || !producto?.erp_product_id || !miErp) return;
        let cancelado = false;
        fetchDondeHay(producto.erp_product_id, miErp).then(r => {
            if (!cancelado && !r.error) setDondeTraido(r.donde);
        });
        return () => { cancelado = true; };
    }, [producto?.erp_product_id, producto?.donde, miErp]);

    // La sala con más existencia va primera y queda elegida: es la que puede
    // ceder sin quedarse corta, y es el orden en que el listado ya las trae.
    useEffect(() => {
        if (donde.length > 0 && salaId === null) setSalaId(String(donde[0].erp_sucursal_id));
    }, [donde, salaId]);

    // La presentación viaja por SIGNIFICADO —tipo + factor—, nunca por su id:
    // el portal y el sistema de origen las numeran distinto y solo la etiqueta
    // es estable entre los dos.
    useEffect(() => {
        if (!producto?.erp_product_id) return;
        let cancelado = false;
        fetchPresentaciones([producto.erp_product_id]).then(r => {
            if (cancelado) return;
            setPresentaciones(r.porProducto.get(producto.erp_product_id) ?? []);
        });
        return () => { cancelado = true; };
    }, [producto?.erp_product_id]);

    const sala     = donde.find(d => String(d.erp_sucursal_id) === String(salaId));
    const pres     = presentaciones[Number(presIdx)] ?? null;

    const unidades = pres ? Number(cantidad || 0) * Number(pres.factor || 1) : 0;
    const puedeEnviar = Boolean(
        sala && pres && miErp && Number(cantidad) > 0 && causa.trim().length > 0
        && unidades > 0 && unidades <= Number(sala.unidades ?? 0),
    );

    const enviar = async () => {
        if (!puedeEnviar) return;
        setError(''); setEnviando(true);
        try {
            const { error: e } = await crearSolicitudTraslado({
                employee_id: user?.id,
                type: 'INVENTORY_TRANSFER_REQUEST',
                status: 'PENDING',
                note: causa.trim(),
                metadata: {
                    reason: causa.trim(),
                    // Mi sala: la que recibe.
                    branch_id: miBranch,
                    branch_name: user?.branchName ?? user?.branch_name ?? '',
                    erp_sucursal_id: miErp,
                    // La sala de origen: la que tiene el producto.
                    origen_erp_sucursal_id: sala.erp_sucursal_id,
                    origen_branch_name: sala.sala,
                    total_unidades: unidades,
                    items: [{
                        erp_product_id:    producto.erp_product_id,
                        descripcion:       producto.descripcion,
                        presentacion_tipo: pres.tipo,
                        factor:            pres.factor,
                        cantidad:          Number(cantidad),
                    }],
                },
            });
            if (e) throw e;

            await appendAuditLog('TRASLADO_SOLICITADO', String(miBranch ?? ''), {
                producto: producto.erp_product_id,
                origen: sala.sala, cantidad: Number(cantidad), unidades, causa: causa.trim(),
            });

            setListo(true);
            setTimeout(() => { onListo?.(); onClose?.(); }, 2200);
        } catch (e) {
            // El mensaje del trigger es el que explica de verdad qué pasó —que
            // la sala quedaría debajo de su mínimo, por ejemplo—, así que se
            // muestra tal cual en vez de taparlo con uno genérico.
            //
            // La excepción es el índice de duplicados: ahí Postgres contesta
            // «duplicate key value violates unique constraint», que no le dice
            // nada a nadie y encima suena a que el portal se rompió. Lo que hay
            // que decir es qué hacer: la cantidad va en el mismo pedido.
            const msg = String(e?.message ?? '');
            setError(
                msg.includes('approval_requests_un_traslado_pendiente')
                    ? `Ya hay un pedido de este producto a ${sala?.sala ?? 'esa sala'} esperando respuesta. `
                      + 'Si necesitas más, súbele la cantidad a ese pedido o pídeselo a otra sala.'
                : msg.includes('row-level security')
                    ? 'No tienes permiso para pedir traslados.'
                : (e?.message ?? 'No se pudo enviar la solicitud.'),
            );
            setEnviando(false);
        }
    };

    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-md" ariaLabel="Pedir a otra sala">
            <div className="p-5 flex flex-col gap-3">
                <div className="flex items-start gap-2">
                    <ArrowLeftRight size={15} className="text-brand-text shrink-0 mt-0.5" strokeWidth={2.5} />
                    <div className="min-w-0">
                        <p className="text-body-sm font-black text-content leading-tight">
                            {producto?.descripcion}
                        </p>
                        <p className="text-micro text-content-3 mt-0.5">Pedir a otra sala</p>
                    </div>
                </div>

                {listo ? (
                    <p className="text-label font-semibold text-success-text py-6 text-center leading-snug">
                        Solicitud enviada.<br />
                        <span className="text-content-3 font-medium">
                            {sala?.sala} decide y el producto sale de ahí.
                        </span>
                    </p>
                ) : (
                    <>
                        <LiquidSelect
                            value={salaId}
                            onChange={v => setSalaId(v)}
                            options={donde.map(d => ({
                                value: String(d.erp_sucursal_id),
                                label: `${d.sala} — ${d.unidades} unidades`,
                            }))}
                            placeholder="A qué sala..."
                            clearable={false}
                        />

                        <div className="flex gap-2">
                            <div className="flex-1">
                                <LiquidSelect
                                    value={presIdx}
                                    onChange={v => setPresIdx(v ?? '0')}
                                    options={presentaciones.map((p, i) => ({
                                        value: String(i),
                                        label: `${p.tipo} (${p.factor})`,
                                    }))}
                                    placeholder="Presentación..."
                                    clearable={false}
                                />
                            </div>
                            <div className="w-24">
                                <PortalInput
                                    type="number"
                                    min="1"
                                    value={cantidad}
                                    onChange={e => setCantidad(e.target.value)}
                                    placeholder="Cant."
                                />
                            </div>
                        </div>

                        {/* El número que importa es el de UNIDADES: la sala tiene
                            su existencia contada así, y una cantidad en cajas
                            contra una existencia en unidades deja pasar
                            imposibles sin que nada avise.
                            La existencia ya viene con lo que salió y todavía no
                            volvió del conteo descontado. */}
                        {pres && Number(cantidad) > 0 && (
                            <p className={`text-micro font-semibold px-1 ${
                                unidades > Number(sala?.unidades ?? 0) ? 'text-danger-text' : 'text-content-3'
                            }`}>
                                {unidades} {unidades === 1 ? 'unidad' : 'unidades'}
                                {sala && ` · ${sala.sala} tiene ${sala.unidades}`}
                                {/* Que quede en cero no impide nada: se dice para
                                    que quien pide sepa qué está pidiendo. */}
                                {sala && Number(sala.minimo ?? 0) > 0
                                  && (Number(sala.unidades) - unidades) < Number(sala.minimo)
                                  && ` y quedaría en ${Math.max(Number(sala.unidades) - unidades, 0)}, bajo su mínimo de ${sala.minimo}`}
                            </p>
                        )}

                        <PortalTextarea
                            value={causa}
                            onChange={e => setCausa(e.target.value)}
                            rows={2}
                            placeholder="Para qué se pide — queda escrito en el movimiento"
                        />

                        {error && <p className="text-label text-danger-text font-medium px-1">{error}</p>}

                        <Button disabled={!puedeEnviar || enviando} onClick={enviar}>
                            {enviando && <Loader2 size={14} className="animate-spin" />}
                            {enviando ? 'Enviando...' : 'Pedir'}
                        </Button>
                    </>
                )}
            </div>
        </LiquidModal>
    );
}
