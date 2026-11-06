import React, { useState, useEffect } from 'react';
import { Archive, ArchiveRestore, CheckCircle2, Minus, Plus, Undo2, X } from 'lucide-react';
import ListRow from '../../components/common/ListRow';
import FotosDeEvidencia from '../../components/common/FotosDeEvidencia';
import Button from '../../components/common/Button';
import LiquidSelect from '../../components/common/LiquidSelect';
import PortalTextarea from '../../components/common/PortalTextarea';
import SearchInput from '../../components/common/SearchInput';
import Notice from '../../components/common/Notice';
import { EmptyState, SkeletonText } from '../../components/common/StateViews';
import { PieModal, EncabezadoModal } from './LanzadorSolicitud';
import { useAuth } from '@nucleo/context/AuthContext';
import { buscarConExistencia } from '@nucleo/data/inventoryMovements';
import { subirEvidencia, MAX_FOTOS } from '@nucleo/data/evidencia';
import {
    MOTIVOS_A_VENCIDOS, MOTIVOS_AL_ESTANTE, pasarAVencidosEnBodega, fetchPasadosAVencidos, devolverDeVencidosAlEstante,
} from '@nucleo/data/cargarCompra';
import { fechaNumerica } from '@nucleo/utils/fecha';

// Bodega pasa producto de su estante a su área de vencidos (usuario,
// 2026-11-06: «creemos algo para bodega que lo pueda hacer, con motivo, foto»).
//
// A diferencia del resto del Ajuste de inventario, NO es una solicitud: Bodega
// lo hace directo (decisión del usuario). El producto no sale de la empresa —
// cambia de estante—, así que no hay nada que aprobar; lo que sí queda es el
// rastro: quién, cuándo, por qué y, si es por daño, la foto (obligatoria).
//
// Vive dentro del widget de Ajuste porque es donde Bodega ya busca qué hacer
// con lo vencido. La opción sólo aparece en Bodega y para quien carga compras:
// la función que mueve el producto exige ese mismo permiso.
//
// Con `sentido="al_estante"` es el camino inverso (2026-11-06, usuario: «si hay
// algún producto enviado por error, y debe volver para venderla»): se busca en
// el ÁREA DE VENCIDOS y vuelve al estante. Y en la ida, lo que se pasó desde el
// portal en los últimos 30 días se puede «Devolver» con un toque.

const fmtVence = (d) => fechaNumerica(d, { anio: 'corto', vacio: null });
const clave = (f) => `${f.erp_product_id}|${f.presentacion}|${f.lote ?? ''}|${f.fecha_vencimiento ?? ''}`;

export default function PasarAVencidosBodega({ branchName, onVolver, onHecho, sentido = 'a_vencidos' }) {
    const { user } = useAuth();
    const alEstante = sentido === 'al_estante';
    const MOTIVOS = alEstante ? MOTIVOS_AL_ESTANTE : MOTIVOS_A_VENCIDOS;
    const [recientes, setRecientes] = useState(null);
    const [devolviendo, setDevolviendo] = useState(null);
    const [busqueda, setBusqueda] = useState('');
    const [candidatos, setCandidatos] = useState([]);
    const [cargando, setCargando] = useState(false);
    const [lineas, setLineas] = useState([]);
    const [motivo, setMotivo] = useState('');
    const [detalle, setDetalle] = useState('');
    const [fotos, setFotos] = useState([]);
    const [enviando, setEnviando] = useState(false);
    const [subiendo, setSubiendo] = useState(false);
    const [error, setError] = useState('');
    const [hecho, setHecho] = useState(null);

    // Busca en el estante (ida) o en el área de vencidos (vuelta).
    useEffect(() => {
        const q = busqueda.trim();
        if (q.length < 2) { setCandidatos([]); return undefined; }
        let vivo = true;
        setCargando(true);
        const t = setTimeout(async () => {
            const { filas, error: e } = await buscarConExistencia({ erpSucursalId: 6, texto: q, vencidos: alEstante });
            if (!vivo) return;
            setCargando(false);
            if (e) { setError(e.message ?? String(e)); return; }
            setCandidatos(filas);
        }, 300);
        return () => { vivo = false; clearTimeout(t); };
    }, [busqueda, alEstante]);

    // Lo que se pasó desde el portal y sigue en vencidos: se puede devolver.
    const cargarRecientes = async () => {
        const { filas } = await fetchPasadosAVencidos();
        setRecientes(filas.filter(f => (f.sentido ?? 'a_vencidos') === 'a_vencidos' && f.estado === 'en_vencidos' && f.erp_traslado_id));
    };
    useEffect(() => { if (!alEstante) cargarRecientes(); }, [alEstante]);

    const devolver = async (traslado) => {
        setError(''); setDevolviendo(traslado);
        const { error: e } = await devolverDeVencidosAlEstante(traslado);
        setDevolviendo(null);
        if (e) { setError(e); return; }
        await cargarRecientes();
    };

    const m = MOTIVOS.find(x => x.value === motivo) ?? null;
    const faltaFoto = !!m?.foto && fotos.length === 0;
    const faltaDetalle = !!m?.detalle && detalle.trim().length < 4;
    const puedeEnviar = lineas.length > 0 && !!m && !faltaFoto && !faltaDetalle && !enviando;

    const agregar = (f) => {
        const k = clave(f);
        setLineas(ls => ls.some(l => l.k === k) ? ls : [...ls, { k, fila: f, cantidad: 1 }]);
        setBusqueda('');
    };
    const cambiar = (k, delta) => setLineas(ls => ls.map(l => l.k !== k ? l
        : { ...l, cantidad: Math.min(Number(l.fila.cantidad), Math.max(1, l.cantidad + delta)) }));
    const quitar = (k) => setLineas(ls => ls.filter(l => l.k !== k));

    const enviar = async () => {
        if (!puedeEnviar) return;
        setError(''); setEnviando(true);
        try {
            let urls = [];
            if (fotos.length) {
                setSubiendo(true);
                urls = await subirEvidencia(fotos, { carpeta: 'bodega-vencidos', salaId: 30, userId: user?.id });
                setSubiendo(false);
            }
            const { resultado, error: e } = await pasarAVencidosEnBodega({
                motivo, detalle: detalle.trim() || null, fotos: urls, sentido,
                renglones: lineas.map(({ fila, cantidad }) => ({
                    erp_product_id: fila.erp_product_id, descripcion: fila.descripcion,
                    presentacion: fila.presentacion, factor: Number(fila.factor) || 1, cantidad,
                    lote: fila.lote ?? null, vence: fila.fecha_vencimiento ?? null,
                })),
            });
            if (e) { setError(e); return; }
            setHecho(resultado);
        } catch (err) {
            setError(err?.message ?? String(err));
        } finally {
            setSubiendo(false); setEnviando(false);
        }
    };

    if (hecho) return (
        <div className="flex flex-col items-center justify-center gap-3 flex-1 py-8 text-center">
            <CheckCircle2 size={40} className="text-success-text" />
            <div>
                <p className="text-body-lg font-black text-content">{alEstante ? 'Ya está en el estante' : 'Ya está en vencidos'}</p>
                <p className="text-body-sm text-content-3 mt-1">
                    {hecho.renglones === 1 ? 'El producto se movió' : `Se movieron ${hecho.renglones} productos`}
                    {alEstante ? ' al estante de Bodega: ya se puede vender.' : ' al área de vencidos de Bodega.'}
                </p>
            </div>
            <Button variant="secondary" onClick={onHecho}>Cerrar</Button>
        </div>
    );

    return (
        <div className="flex flex-col gap-3 flex-1 min-h-0 animate-in slide-in-from-right-3 duration-[var(--dur-base)]">
            <EncabezadoModal
                titulo={alEstante ? 'Volver al estante' : 'Pasar a vencidos'} subtitulo={branchName}
                icono={alEstante ? ArchiveRestore : Archive} tono={alEstante ? 'success' : 'danger'} onVolver={onVolver}
            />

            <SearchInput
                accentColor={alEstante ? 'var(--success)' : 'var(--danger)'}
                value={busqueda} onChange={setBusqueda}
                placeholder={alEstante ? 'Buscar producto en vencidos…' : 'Buscar producto del estante…'}
                ariaLabel={alEstante ? 'Buscar producto en vencidos' : 'Buscar producto del estante'}
            />

            <div className="flex flex-col gap-2 flex-1 min-h-0 overflow-y-auto overscroll-contain -mx-1 px-1">
                {busqueda.trim().length >= 2 ? (
                    cargando ? <SkeletonText lines={3} /> :
                    candidatos.length === 0 ? (
                        <EmptyState compact title={alEstante ? 'No está en vencidos' : 'Sin existencia en el estante'}
                            subtitle={alEstante ? 'No hay ese producto en el área de vencidos de Bodega.' : 'No hay ese producto en el estante de Bodega.'} />
                    ) : candidatos.map(f => (
                        <ListRow
                            key={clave(f)}
                            onClick={() => agregar(f)}
                            leading={<Plus size={14} className="text-brand-text" strokeWidth={2.5} />}
                            className="border-divider bg-surface-card hover:border-brand/40"
                            title={f.descripcion}
                            trailing={<span className="text-caption font-black text-content-3 tabular-nums">{f.cantidad}</span>}
                        >
                            <span className="block text-micro text-content-3 truncate">
                                {[f.presentacion, f.lote && f.lote !== 'GENERICO' ? `Lote ${f.lote}` : null,
                                  f.fecha_vencimiento ? `Vence ${fmtVence(f.fecha_vencimiento)}` : null].filter(Boolean).join(' · ')}
                            </span>
                        </ListRow>
                    ))
                ) : lineas.length === 0 ? (
                    <>
                        <EmptyState compact icon={alEstante ? ArchiveRestore : Archive}
                            title={alEstante ? 'Busca lo que vuelve a la venta' : 'Busca lo que va a vencidos'}
                            subtitle={alEstante
                                ? 'Se mueve del área de vencidos al estante de Bodega, sin aprobación. Queda anotado quién lo hizo y por qué.'
                                : 'Se mueve del estante al área de vencidos de Bodega, sin aprobación. Queda anotado quién lo hizo y por qué.'} />
                        {!alEstante && recientes?.length > 0 && (
                            <>
                                <p className="text-caption font-black text-content-2 uppercase tracking-widest px-1 mt-1">
                                    Pasados desde el portal
                                </p>
                                {recientes.map(r => (
                                    <ListRow
                                        key={r.id}
                                        className="border-divider bg-surface-card"
                                        title={r.descripcion}
                                        trailing={
                                            <Button size="sm" variant="secondary" icon={Undo2}
                                                loading={devolviendo === r.erp_traslado_id}
                                                disabled={!!devolviendo}
                                                onClick={() => devolver(r.erp_traslado_id)}>
                                                Devolver
                                            </Button>
                                        }
                                    >
                                        <span className="block text-micro text-content-3 truncate">
                                            {[`${r.cantidad} ${r.presentacion}`, r.lote ? `Lote ${r.lote}` : null,
                                              fechaNumerica(r.created_at, { anio: 'corto' })].filter(Boolean).join(' · ')}
                                        </span>
                                    </ListRow>
                                ))}
                            </>
                        )}
                    </>
                ) : (
                    <>
                        {lineas.map(({ k, fila, cantidad }) => (
                            <div key={k} data-surface="card" className="flex items-center gap-2 p-2.5">
                                <div className="flex-1 min-w-0">
                                    <p className="text-body-sm font-bold text-content truncate">{fila.descripcion}</p>
                                    <p className="text-micro text-content-3 truncate">
                                        {[fila.presentacion, fila.lote && fila.lote !== 'GENERICO' ? `Lote ${fila.lote}` : null,
                                          fila.fecha_vencimiento ? `Vence ${fmtVence(fila.fecha_vencimiento)}` : null,
                                          `hay ${fila.cantidad}`].filter(Boolean).join(' · ')}
                                    </p>
                                </div>
                                <button type="button" aria-label="Uno menos" onClick={() => cambiar(k, -1)}
                                    className="min-h-[var(--tap-min)] min-w-[var(--tap-min)] flex items-center justify-center rounded-xl text-content-2 active:scale-[0.97]">
                                    <Minus size={14} strokeWidth={2.5} />
                                </button>
                                <span className="text-body-sm font-black tabular-nums w-6 text-center">{cantidad}</span>
                                <button type="button" aria-label="Uno más" onClick={() => cambiar(k, 1)}
                                    className="min-h-[var(--tap-min)] min-w-[var(--tap-min)] flex items-center justify-center rounded-xl text-content-2 active:scale-[0.97]">
                                    <Plus size={14} strokeWidth={2.5} />
                                </button>
                                <button type="button" aria-label="Quitar" onClick={() => quitar(k)}
                                    className="min-h-[var(--tap-min)] min-w-[var(--tap-min)] flex items-center justify-center rounded-xl text-danger-text active:scale-[0.97]">
                                    <X size={14} strokeWidth={2.5} />
                                </button>
                            </div>
                        ))}

                        <LiquidSelect
                            value={motivo || null}
                            onChange={v => setMotivo(v ?? '')}
                            options={MOTIVOS.map(({ value, label }) => ({ value, label }))}
                            placeholder={alEstante ? '¿Por qué vuelve al estante?' : '¿Por qué va a vencidos?'}
                            clearable={false}
                        />
                        <PortalTextarea
                            value={detalle}
                            onChange={e => setDetalle(e.target.value)}
                            rows={2}
                            placeholder={m?.detalle ? 'Explica por qué (obligatorio)' : 'Detalle (opcional)'}
                        />
                        {m?.foto && (
                            <>
                                <FotosDeEvidencia fotos={fotos} onCambio={setFotos} max={MAX_FOTOS} maxMB={10}
                                    resaltar onError={setError} alt="Foto del producto dañado" />
                                {faltaFoto && (
                                    <p className="text-micro text-warning-text font-semibold px-1">
                                        Por daño hace falta al menos una foto.
                                    </p>
                                )}
                            </>
                        )}
                    </>
                )}
                {error && <Notice variant="danger">{error}</Notice>}
            </div>

            <PieModal>
                <Button variant="secondary" onClick={onVolver}>Volver</Button>
                <Button disabled={!puedeEnviar} loading={enviando} onClick={enviar}>
                    {subiendo ? 'Subiendo la foto...' : enviando ? 'Moviendo...' : (alEstante ? 'Volver al estante' : 'Pasar a vencidos')}
                </Button>
            </PieModal>
        </div>
    );
}
