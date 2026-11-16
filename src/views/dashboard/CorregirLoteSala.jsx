import React, { useState, useEffect, useMemo } from 'react';
import { CalendarCog, CheckCircle2, ChevronRight, Minus, Plus } from 'lucide-react';
import ListRow from '../../components/common/ListRow';
import Button from '../../components/common/Button';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import SearchInput from '../../components/common/SearchInput';
import Notice from '../../components/common/Notice';
import CampoMesAnio from '../../components/common/CampoMesAnio';
import { EmptyState, SkeletonText } from '../../components/common/StateViews';
import { PieModal, EncabezadoModal } from './LanzadorSolicitud';
import { buscarConExistencia, fetchLotesEnUnidades, corregirLoteEnSala } from '@nucleo/data/inventoryMovements';
import { fetchExigenciasDe } from '@nucleo/data/traslados';
import { esLoteGenerico } from '@nucleo/utils/unidadesInventario';
import { fechaNumerica, hoySV } from '@nucleo/utils/fecha';

// La sala corrige el lote o el vencimiento de lo que ya tiene, sin sumar ni
// restar unidades (usuario, 2026-11-16: «sin necesidad de hacer descartes,
// envío o cosas raras. Solo se ajustaría lote / vence»). Nació de una
// solicitud de descarte de 20 ZALDIAR que Salud 2 recibió con el vencimiento
// equivocado y pensaba volver a pedir como carga.
//
// Directo, sin aprobación (decisión del usuario). Lo que queda es el rastro:
// quién y por qué, en la bitácora y en el kardex. Vive dentro del Ajuste de
// inventario, como «Enviar a bodega de vencidos», porque es donde la sala ya
// busca qué hacer con un lote que no cuadra.
//
// Pasos: buscar el producto → elegir el lote que está mal → escribir el lote y
// el vencimiento correctos. Las reglas finas (si sólo cambia la fecha, va el
// lote completo; el número no puede existir con otra fecha) las decide la
// función del servidor, y acá sólo se adelanta la primera para no hacer
// esperar a nadie por un «no».

// El vencimiento se guarda como día 1 del mes (`loteVencimiento.ts`): «01/10/26»
// se leía como un día. Se muestra como en el empaque, mes y año.
const fmtVence = (d) => {
    const m = /^(\d{4})-(\d{2})/.exec(String(d ?? ''));
    return m ? `${m[2]}/${m[1]}` : fechaNumerica(d, { vacio: null });
};
const yaVencio = (d) => !!d && String(d).slice(0, 10) <= hoySV();
const rotulo = (l) => esLoteGenerico(l.lote) ? 'Sin lote asignado' : `Lote ${l.lote}`;
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toUpperCase();

// `enConteo`: los productos que un conteo abierto está contando (Set de ids).
// No se ofrecen: el número no se mueve mientras alguien cuenta.
export default function CorregirLoteSala({ erpSucursalId, branchName, enConteo = null, onVolver, onHecho }) {
    const [busqueda, setBusqueda] = useState('');
    const [candidatos, setCandidatos] = useState([]);
    const [cargando, setCargando] = useState(false);
    const [producto, setProducto] = useState(null);   // { erp_product_id, descripcion }
    const [lotes, setLotes] = useState(null);         // null = cargando
    const [regulado, setRegulado] = useState(null);
    const [origen, setOrigen] = useState(null);       // el lote que está mal
    const [unidades, setUnidades] = useState(0);
    const [loteNuevo, setLoteNuevo] = useState('');
    const [venceNuevo, setVenceNuevo] = useState(''); // 'AAAA-MM' o lo que se esté escribiendo
    const [motivo, setMotivo] = useState('');
    const [enviando, setEnviando] = useState(false);
    const [error, setError] = useState('');
    const [hecho, setHecho] = useState(null);
    const [vuelta, setVuelta] = useState(0);         // recargar los lotes tras corregir uno

    // ── Paso 1 · el producto, entre lo que la sala tiene ──────────────────
    useEffect(() => {
        const q = busqueda.trim();
        if (q.length < 2) { setCandidatos([]); return undefined; }
        let vivo = true;
        setCargando(true);
        const t = setTimeout(async () => {
            const { filas, error: e } = await buscarConExistencia({ erpSucursalId, texto: q });
            if (!vivo) return;
            setCargando(false);
            if (e) { setError(e.message ?? String(e)); return; }
            const vistos = new Set();
            setCandidatos((filas ?? []).filter(f => !vistos.has(f.erp_product_id) && vistos.add(f.erp_product_id)));
        }, 300);
        return () => { vivo = false; clearTimeout(t); };
    }, [busqueda, erpSucursalId]);

    // ── Paso 2 · sus lotes, en unidades ───────────────────────────────────
    useEffect(() => {
        if (!producto) return undefined;
        let vivo = true;
        setLotes(null); setRegulado(null);
        Promise.all([
            fetchLotesEnUnidades({ erpProductId: producto.erp_product_id, erpSucursalId }),
            fetchExigenciasDe([producto.erp_product_id]),
        ]).then(([r, ex]) => {
            if (!vivo) return;
            if (r.error) setError(r.error.message ?? String(r.error));
            setLotes(r.lotes);
            setRegulado(ex.get(Number(producto.erp_product_id))?.regulado ?? false);
        });
        return () => { vivo = false; };
    }, [producto, erpSucursalId, vuelta]);

    // Lo sin lote asignado sólo se puede «corregir» en un producto con control
    // de lote: en los demás no hay lote que ponerle.
    const ofrecidos = useMemo(() => (lotes ?? []).filter(l => !esLoteGenerico(l.lote) || regulado), [lotes, regulado]);

    const elegirLote = (l) => {
        setOrigen(l);
        setUnidades(l.unidades);
        setLoteNuevo(esLoteGenerico(l.lote) ? '' : l.lote);
        // El vencimiento va VACÍO: casi siempre es lo que está mal, y
        // precargarlo encendía de entrada «no hay nada que corregir» y «ya
        // pasó» antes de que la persona escribiera nada (visto en la pantalla).
        setVenceNuevo('');
        setError('');
    };

    const venceListo = /^\d{4}-\d{2}$/.test(venceNuevo) ? `${venceNuevo}-01` : null;
    const mismoNumero = origen && !esLoteGenerico(origen.lote) && norm(origen.lote) === norm(loteNuevo);
    const sinCambio = mismoNumero && venceListo && String(origen.vence ?? '').slice(0, 10) === venceListo;
    // Si el número se queda, el lote va completo: un lote físico tiene una fecha.
    const loteCompleto = mismoNumero && origen && unidades !== origen.unidades;
    const vencido = venceListo && venceListo <= hoySV();
    const faltan = !origen ? 'el lote'
        : !(unidades > 0) ? 'cuántas unidades'
        : !loteNuevo.trim() ? 'el lote correcto'
        : !venceListo ? 'el vencimiento correcto'
        : motivo.trim().length < 4 ? 'por qué' : null;
    const puedeEnviar = !faltan && !sinCambio && !loteCompleto && !vencido && !enviando;

    const enviar = async () => {
        if (!puedeEnviar) return;
        setError(''); setEnviando(true);
        try {
            const { resultado, error: e } = await corregirLoteEnSala({
                erpSucursalId, erpProductId: producto.erp_product_id, descripcion: producto.descripcion,
                lote: origen.lote, vence: origen.vence, unidades,
                loteNuevo: loteNuevo.trim(), venceNuevo: venceListo, motivo: motivo.trim(),
            });
            if (e) { setError(e); return; }
            setHecho(resultado);
        } catch (err) {
            setError(err?.message ?? String(err));
        } finally {
            setEnviando(false);
        }
    };

    const atras = () => {
        setError('');
        if (origen) { setOrigen(null); return; }
        if (producto) { setProducto(null); return; }
        onVolver();
    };

    if (hecho) return (
        <div className="flex flex-col items-center justify-center gap-3 flex-1 py-8 text-center">
            <CheckCircle2 size={40} className="text-success-text" />
            <div>
                <p className="text-body-lg font-black text-content">Lote corregido</p>
                <p className="text-body-sm text-content-3 mt-1">
                    {hecho.unidades} {hecho.unidades === 1 ? 'unidad' : 'unidades'} de {producto.descripcion} ahora
                    {' '}son del lote {hecho.lote}, vence {fmtVence(hecho.vence)}.
                </p>
                <p className="text-caption text-content-3 mt-1">En unos minutos se ve así en el inventario.</p>
            </div>
            {(hecho.avisos ?? []).map(a => <Notice key={a} variant="warning">{a}</Notice>)}
            <div className="flex gap-2">
                {/* Otro lote del MISMO producto: con tres fechas para un número se
                    corrige un renglón por vez, y volver a buscar el producto
                    cada vez es lo que hacía pesado el arreglo. */}
                <Button variant="secondary" onClick={() => { setHecho(null); setOrigen(null); setVuelta(v => v + 1); }}>
                    Corregir otro lote
                </Button>
                <Button onClick={onHecho}>Listo</Button>
            </div>
        </div>
    );

    return (
        <div className="flex flex-col gap-3 flex-1 min-h-0 animate-in slide-in-from-right-3 duration-[var(--dur-base)]">
            <EncabezadoModal
                titulo="Corregir lote o vencimiento" subtitulo={branchName}
                icono={CalendarCog} tono="brand" onVolver={atras}
            />

            <div className="flex flex-col gap-2 flex-1 min-h-0 overflow-y-auto overscroll-contain -mx-1 px-1">
                {!producto ? (
                    <>
                        <SearchInput autoFocus value={busqueda} onChange={setBusqueda}
                            placeholder="Buscar el producto…" ariaLabel="Buscar el producto" />
                        {busqueda.trim().length >= 2 ? (
                            cargando ? <SkeletonText lines={3} /> :
                            candidatos.length === 0 ? (
                                <EmptyState compact title="Sin existencia" subtitle="Ese producto no está en la sala." />
                            ) : candidatos.map(f => {
                                const contando = enConteo?.has(Number(f.erp_product_id));
                                return (
                                    <ListRow key={f.erp_product_id}
                                        onClick={contando ? undefined : () => { setProducto({ erp_product_id: f.erp_product_id, descripcion: f.descripcion }); setBusqueda(''); }}
                                        className={`border-divider bg-surface-card ${contando ? 'opacity-60' : 'hover:border-brand/40'}`}
                                        title={f.descripcion}
                                        trailing={contando
                                            ? <span className="text-micro font-bold text-warning-text">Se está contando</span>
                                            : <ChevronRight size={14} className="text-content-3" />}
                                    />
                                );
                            })
                        ) : (
                            <EmptyState compact icon={CalendarCog}
                                title="Busca el producto con el lote mal puesto"
                                subtitle="Se cambia el lote o el vencimiento de lo que ya está en la sala, sin quitar ni agregar unidades. No pide aprobación: queda anotado quién lo hizo y por qué." />
                        )}
                    </>
                ) : !origen ? (
                    <>
                        <p className="text-body-sm font-bold text-content px-1">{producto.descripcion}</p>
                        <p className="text-caption font-black text-content-2 uppercase tracking-widest px-1">¿Qué lote está mal?</p>
                        {lotes === null ? <SkeletonText lines={3} /> :
                         ofrecidos.length === 0 ? (
                            <EmptyState compact title="Sin lotes"
                                subtitle="Este producto no lleva control de lote en la sala: no hay lote que corregir." />
                         ) : ofrecidos.map(l => (
                            <ListRow key={l.clave} onClick={() => elegirLote(l)}
                                className="border-divider bg-surface-card hover:border-brand/40"
                                title={rotulo(l)}
                                trailing={<span className="text-caption font-black text-content-3 tabular-nums">{l.unidades} u.</span>}
                            >
                                <span className={`block text-micro ${yaVencio(l.vence) ? 'text-danger-text font-bold' : 'text-content-3'}`}>
                                    {l.vence ? `${yaVencio(l.vence) ? 'Venció' : 'Vence'} ${fmtVence(l.vence)}` : 'Sin vencimiento'}
                                </span>
                            </ListRow>
                         ))}
                    </>
                ) : (
                    <>
                        <div data-surface="card" className="p-3">
                            <p className="text-body-sm font-bold text-content truncate">{producto.descripcion}</p>
                            <p className="text-micro text-content-3">
                                Ahora: {rotulo(origen)}{origen.vence ? ` · vence ${fmtVence(origen.vence)}` : ''} · {origen.unidades} u.
                            </p>
                        </div>

                        <div className="flex items-center gap-2 px-1">
                            <span className="text-body-sm text-content-2 flex-1">Unidades que se corrigen</span>
                            <button type="button" aria-label="Una menos" onClick={() => setUnidades(u => Math.max(1, u - 1))}
                                className="min-h-[var(--tap-min)] min-w-[var(--tap-min)] flex items-center justify-center rounded-xl text-content-2 active:scale-[0.97]">
                                <Minus size={14} strokeWidth={2.5} />
                            </button>
                            <span className="text-body-sm font-black tabular-nums w-10 text-center">{unidades}</span>
                            <button type="button" aria-label="Una más" onClick={() => setUnidades(u => Math.min(origen.unidades, u + 1))}
                                className="min-h-[var(--tap-min)] min-w-[var(--tap-min)] flex items-center justify-center rounded-xl text-content-2 active:scale-[0.97]">
                                <Plus size={14} strokeWidth={2.5} />
                            </button>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <PortalInput compact label="Lote correcto" value={loteNuevo}
                                onChange={e => setLoteNuevo(e.target.value.toUpperCase())} placeholder="Como viene en la caja" />
                            <CampoMesAnio compact label="Vence" placeholder="MM/AAAA" value={venceNuevo}
                                desde={hoySV().slice(0, 7)} onChange={v => setVenceNuevo(String(v ?? ''))} />
                        </div>

                        <PortalTextarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={2}
                            placeholder="¿Por qué se corrige? (obligatorio)" />

                        {sinCambio && <Notice variant="warning">Es el mismo lote con el mismo vencimiento: no hay nada que corregir.</Notice>}
                        {loteCompleto && (
                            <Notice variant="warning">
                                Si sólo cambia el vencimiento, se corrige el lote completo ({origen.unidades} u.): un mismo lote no puede quedar con dos fechas.
                            </Notice>
                        )}
                        {vencido && <Notice variant="warning">Ese vencimiento ya pasó. Si el producto está vencido, va como descarte.</Notice>}
                    </>
                )}
                {error && <Notice variant="danger">{error}</Notice>}
            </div>

            <PieModal>
                <Button variant="secondary" onClick={atras}>Volver</Button>
                {origen && (
                    <Button disabled={!puedeEnviar} loading={enviando} onClick={enviar}>
                        {enviando ? 'Corrigiendo...' : faltan ? `Falta ${faltan}` : 'Corregir'}
                    </Button>
                )}
            </PieModal>
        </div>
    );
}
