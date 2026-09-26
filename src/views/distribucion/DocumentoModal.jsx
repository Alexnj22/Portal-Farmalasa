import React, { useState, useEffect, useCallback } from 'react';
import { FileCheck2, RefreshCw, Loader2, Download, ExternalLink } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import { useToastStore } from '../../store/toastStore';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { formatMoney } from '../../utils/formatNumber';
import { fechaTexto } from '../../utils/fecha';
import { hora12 } from '../../utils/hora';
import { fetchDocumento, reintentarDocumento, mensajeDeDistribucion } from '../../data/distribucion';
import { registrarEgreso } from '../../data/egreso';
import { descargarArchivo, abrirEnPestanaNueva } from '../../plataforma/descargas';
import { ESTADO_DOCUMENTO, TIPO_DOCUMENTO } from './comun';

// El documento tal como quedó: sus números de identidad (control, generación,
// sello), la respuesta de Hacienda y el archivo. El JSON firmado es el
// documento tributario; cualquier PDF o tiquete es sólo su representación.

/** La consulta pública de Hacienda: lo que el cliente usa para verificar el documento. */
const consultaPublica = (d) =>
    `https://admin.factura.gob.sv/consultaPublica?ambiente=${d.ambiente}&codGen=${d.codigo_generacion.toUpperCase()}&fechaEmi=${d.fec_emi}`;

export default function DocumentoModal({ id, puedeVender, onClose, onCambio }) {
    const showToast = useToastStore(s => s.showToast);
    const [d, setD] = useState(null);
    const [error, setError] = useState('');
    const [ocupado, setOcupado] = useState(false);

    const cargar = useCallback(() => {
        fetchDocumento(id).then(setD).catch(e => setError(mensajeDeDistribucion(e)));
    }, [id]);
    useEffect(() => { cargar(); }, [cargar]);

    const reintentar = async () => {
        setOcupado(true);
        setError('');
        try {
            const r = await reintentarDocumento(id);
            useStaff.getState().appendAuditLog('DISTRIBUCION_DTE_REINTENTO', String(id), { estado: r.estado });
            showToast(ESTADO_DOCUMENTO[r.estado]?.label ?? 'Listo', r.aviso ?? r.mensaje ?? '', r.estado === 'sellado' ? 'success' : 'warning');
            cargar();
            onCambio?.();
        } catch (e) {
            setError(mensajeDeDistribucion(e));
        } finally {
            setOcupado(false);
        }
    };

    const descargar = () => {
        const blob = new Blob([JSON.stringify(d.json, null, 2)], { type: 'application/json' });
        descargarArchivo(blob, `${d.codigo_generacion.toUpperCase()}.json`);
        registrarEgreso('distribucion', { formato: 'json', filas: 1, detalle: { dte_id: d.id, numero_control: d.numero_control } });
    };

    const est = d ? ESTADO_DOCUMENTO[d.estado] : null;
    const puedeReintentar = puedeVender && d && ['sin_firmar', 'firmado'].includes(d.estado);
    const obs = d?.observaciones_mh ?? [];

    return (
        <LiquidModal open onClose={ocupado ? undefined : onClose} maxWidth="max-w-2xl" ariaLabel="Documento">
            <LiquidModal.Header>
                <div className="flex items-start justify-between gap-4 w-full">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2.5">
                            <FileCheck2 size={18} className="text-brand-text shrink-0" />
                            <h2 className="text-title font-black text-content truncate">
                                {d ? TIPO_DOCUMENTO[d.tipo]?.largo : 'Documento'}
                            </h2>
                        </div>
                        {d && <p className="text-caption text-content-3 mt-1 truncate">{d.dist_clientes?.nombre}</p>}
                    </div>
                    {est && <Badge variant={est.variant}>{est.label}</Badge>}
                </div>
            </LiquidModal.Header>

            <LiquidModal.Body>
                <div className="flex flex-col gap-4">
                    {error && <Notice variant="danger" bloque>{error}</Notice>}
                    {!d && !error && <p className="text-caption text-content-3">Cargando…</p>}
                    {d && (<>
                        {d.ambiente === '00' && (
                            <Notice variant="info" compact>Documento de PRUEBA: no tiene validez fiscal.</Notice>
                        )}
                        <Notice variant={est.variant === 'success' ? 'success' : est.variant === 'danger' ? 'danger' : 'warning'} compact>
                            {est.ayuda}{d.descripcion_msg ? ` Hacienda: «${d.descripcion_msg}».` : ''}
                        </Notice>
                        {obs.length > 0 && (
                            <div className="rounded-xl border border-divider px-4 py-3">
                                <p className="text-caption font-bold text-content-2 mb-1">Observaciones de Hacienda</p>
                                <ul className="list-disc pl-4 text-caption text-content-2 space-y-0.5">
                                    {obs.map((o, i) => <li key={i}>{o}</li>)}
                                </ul>
                            </div>
                        )}
                        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-body-sm">
                            <dt className="text-content-3">Número de control</dt>
                            <dd className="font-mono text-caption text-content-2 break-all">{d.numero_control}</dd>
                            <dt className="text-content-3">Código de generación</dt>
                            <dd className="font-mono text-caption text-content-2 break-all">{d.codigo_generacion.toUpperCase()}</dd>
                            <dt className="text-content-3">Sello de recepción</dt>
                            <dd className="font-mono text-caption text-content-2 break-all">{d.sello_recibido ?? '—'}</dd>
                            <dt className="text-content-3">Emitido</dt>
                            <dd className="text-content-2">{fechaTexto(d.fec_emi, { day: 'numeric', month: 'long', year: 'numeric' })}, {hora12(d.hor_emi)}</dd>
                            <dt className="text-content-3">Total</dt>
                            <dd className="font-black text-content tabular-nums">{formatMoney(d.total_pagar)}</dd>
                            {d.intentos > 0 && (<>
                                <dt className="text-content-3">Envíos</dt>
                                <dd className="text-content-2">{d.intentos}</dd>
                            </>)}
                        </dl>
                    </>)}
                </div>
            </LiquidModal.Body>

            <LiquidModal.Footer>
                <div className="flex flex-wrap items-center justify-end gap-2 w-full">
                    <Button variant="ghost" onClick={onClose} disabled={ocupado}>Cerrar</Button>
                    {d && (
                        <Button variant="secondary" icon={Download} onClick={descargar}>Archivo JSON</Button>
                    )}
                    {d?.estado === 'sellado' && (
                        <Button variant="secondary" icon={ExternalLink}
                            onClick={() => abrirEnPestanaNueva(consultaPublica(d))}>Ver en Hacienda</Button>
                    )}
                    {puedeReintentar && (
                        <Button variant="primary" icon={ocupado ? Loader2 : RefreshCw} disabled={ocupado} onClick={reintentar}>
                            Enviar a Hacienda
                        </Button>
                    )}
                </div>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
