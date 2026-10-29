/**
 * Las personas cuyos datos se anonimizaron a su pedido, y cómo vuelven
 * (2026-10-26).
 *
 * Si alguien que pidió cancelar sus datos regresa, se reactiva SU MISMA ficha:
 * no se le abre una nueva. El documento que presenta se compara contra la
 * huella que quedó al anonimizar (la ficha ya no tiene el documento: la huella
 * es lo único que permite reconocerla), y sus datos vuelven desde el resguardo
 * al portal y a la caja. Los puntos NO vuelven: se perdieron al anonimizar y la
 * persona lo supo antes.
 */
import React, { useEffect, useState } from 'react';
import { UserCheck, UserX, Eye } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { fechaTexto } from '@nucleo/utils/fecha';
import { fetchAnonimizaciones, reactivarCliente, documentoAnonimizado } from '@nucleo/data/solicitudesDatos';
import ConsultaResguardo from './ConsultaResguardo';

const COLUMNAS = [
    { key: 'cuando', label: 'Anonimizada' },
    { key: 'ficha', label: 'Ficha' },
    { key: 'solicitud', label: 'Solicitud' },
    { key: 'puntos', label: 'Puntos perdidos', hideBelow: 'md' },
    { key: 'estado', label: 'Estado' },
];

const dia = (iso) => (iso ? fechaTexto(iso, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

export default function AnonimizadosDatos() {
    const showToast = useToastStore((s) => s.showToast);
    const [filas, setFilas] = useState(null);
    const [resguardo, setResguardo] = useState(null);
    const [reactivar, setReactivar] = useState(false);
    const [vuelta, setVuelta] = useState(0);

    useEffect(() => {
        let vivo = true;
        fetchAnonimizaciones()
            .then((d) => { if (vivo) setFilas(d); })
            .catch((e) => { if (vivo) { setFilas([]); showToast('No se pudo cargar', mensajeAmigable(e), 'error'); } });
        return () => { vivo = false; };
    }, [showToast, vuelta]);

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="text-body-sm text-content-3 max-w-2xl">
                    Clientes que pidieron cancelar sus datos. Si una persona vuelve, se reactiva su misma ficha
                    presentando el documento con que se identificó; los puntos no vuelven.
                </p>
                <Button icon={UserCheck} onClick={() => setReactivar(true)}>Reactivar datos</Button>
            </div>

            <DataTable columns={COLUMNAS} loading={filas === null} minWidth="640px"
                movil={{ usarAccionDeFila: true }}
                empty={{ icon: UserX, message: 'Nadie ha pedido anonimizar sus datos' }}>
                {(filas ?? []).map((a, k) => (
                    <DataRow key={a.id} index={k} onClick={() => setResguardo(a)}>
                        <DataCell>{dia(a.anonimizada_at)}</DataCell>
                        <DataCell>#{a.customer_id}</DataCell>
                        <DataCell>{a.solicitud?.folio_txt ?? '—'}</DataCell>
                        <DataCell>{Number(a.puntos_perdidos ?? 0).toLocaleString('es-SV')}</DataCell>
                        <DataCell>
                            {a.reactivada_at
                                ? <Badge variant="info" uppercase={false}>Reactivada el {dia(a.reactivada_at)}</Badge>
                                : (a.archivos_pendientes ?? []).length
                                    ? <Badge variant="warning" uppercase={false}>Archivos por borrar</Badge>
                                    : <Badge variant="neutral" uppercase={false}>Anonimizada</Badge>}
                        </DataCell>
                    </DataRow>
                ))}
            </DataTable>

            {resguardo && (
                <LiquidModal open onClose={() => setResguardo(null)} maxWidth="max-w-2xl" ariaLabel="Resguardo de datos anonimizados">
                    <LiquidModal.Header titulo={`Resguardo · ficha #${resguardo.customer_id}`} onClose={() => setResguardo(null)} />
                    <LiquidModal.Body>
                        <ConsultaResguardo anonimizacionId={resguardo.id} />
                    </LiquidModal.Body>
                    <LiquidModal.Footer>
                        <Button variant="ghost" onClick={() => setResguardo(null)}>Cerrar</Button>
                    </LiquidModal.Footer>
                </LiquidModal>
            )}

            {reactivar && (
                <Reactivar onClose={() => setReactivar(false)}
                    onHecho={() => { setReactivar(false); setVuelta((v) => v + 1); }} />
            )}
        </div>
    );
}

function Reactivar({ onClose, onHecho }) {
    const showToast = useToastStore((s) => s.showToast);
    const [documento, setDocumento] = useState('');
    const [motivo, setMotivo] = useState('');
    const [hallado, setHallado] = useState(null);
    const [ocupado, setOcupado] = useState(false);

    const buscar = async () => {
        setOcupado(true);
        try { setHallado(await documentoAnonimizado(documento)); }
        catch (e) { showToast('No se pudo buscar', mensajeAmigable(e), 'error'); }
        finally { setOcupado(false); }
    };

    const confirmar = async () => {
        setOcupado(true);
        try {
            const r = await reactivarCliente({ documento, motivo: motivo.trim() });
            showToast('Datos reactivados', `Ficha #${r.customer_id}${Number(r.puntos_perdidos) > 0 ? ` · los ${r.puntos_perdidos} puntos no vuelven` : ''}`, 'success');
            onHecho?.();
        } catch (e) {
            showToast('No se pudo reactivar', mensajeAmigable(e, 'Intenta de nuevo.'), 'error');
        } finally { setOcupado(false); }
    };

    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-lg" ariaLabel="Reactivar datos de un cliente">
            <LiquidModal.Header titulo="Reactivar datos" onClose={onClose} />
            <LiquidModal.Body>
                <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-end gap-2">
                        <div className="min-w-0 flex-1">
                            <PortalInput label="Documento que presenta (DUI, NIT o pasaporte)" value={documento}
                                autoComplete="off" onChange={(e) => { setDocumento(e.target.value); setHallado(null); }} />
                        </div>
                        <Button variant="secondary" icon={Eye} loading={ocupado && !hallado}
                            disabled={documento.replace(/[^0-9a-z]/gi, '').length < 7} onClick={buscar}>Buscar</Button>
                    </div>
                    {hallado && !hallado.anonimizado && (
                        <Notice variant="info" compact>Con ese documento no hay datos anonimizados.</Notice>
                    )}
                    {hallado?.anonimizado && (
                        <>
                            <Notice variant="warning" bloque>
                                Esta persona pidió anonimizar sus datos el {dia(hallado.anonimizada_at)} (ficha
                                #{hallado.customer_id}). Al reactivar vuelven su nombre, documentos y contacto, en el
                                portal y en la caja. Los puntos que tenía no vuelven.
                            </Notice>
                            <PortalTextarea label="Cómo se comprobó que es la persona" rows={2} maxLength={500}
                                value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                        </>
                    )}
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <Button variant="ghost" onClick={onClose}>Cancelar</Button>
                <Button icon={UserCheck} loading={ocupado && !!hallado?.anonimizado}
                    disabled={!hallado?.anonimizado || motivo.trim().length < 10} onClick={confirmar}>Reactivar</Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
