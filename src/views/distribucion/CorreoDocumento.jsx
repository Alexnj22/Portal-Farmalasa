import React, { useState } from 'react';
import { Mail, Send, Loader2 } from 'lucide-react';
import PortalInput from '../../components/common/PortalInput';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { useToastStore } from '@nucleo/store/toastStore';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { ES_PRUEBAS } from '../../entorno';
import { enviarDocumentoPorCorreo, estadoDelCorreo } from './correo';
import { correoValido, destinoDelCorreo } from '@nucleo/utils/distribucionFacturacion';

// El correo al cliente, dentro del documento (borrador 0019): a quién se le
// mandó, si falló, y el botón. Hacienda exige entregarle el documento SELLADO,
// así que antes del sello no se ofrece enviar (en el entorno de pruebas sí: ahí
// nada se sella y el envío es simulado).

export default function CorreoDocumento({ dte, puedeEnviar, onEnviado }) {
    const showToast = useToastStore(s => s.showToast);
    const vigente = Array.isArray(dte.correo) ? dte.correo[0] : dte.correo;
    const est = estadoDelCorreo(vigente);
    const [destino, setDestino] = useState(() => destinoDelCorreo(dte));
    const [enviando, setEnviando] = useState(false);
    const [error, setError] = useState('');
    const sellado = dte.estado === 'sellado';
    const valido = correoValido(destino);

    const enviar = async () => {
        setEnviando(true);
        setError('');
        try {
            const r = await enviarDocumentoPorCorreo(dte, { destinatario: destino.trim() });
            useStaff.getState().appendAuditLog('DISTRIBUCION_DTE_CORREO', String(dte.id), { destinatario: r?.destinatario, simulado: !!r?.simulado });
            showToast('Documento enviado', `${r?.destinatario}${r?.simulado ? ' (envío simulado del entorno de pruebas)' : ''}`, 'success');
            onEnviado?.();
        } catch (e) {
            setError(mensajeDeDistribucion(e));
        } finally {
            setEnviando(false);
        }
    };

    return (
        <section data-surface="card" className="p-3 flex flex-col gap-2" aria-label="Correo al cliente" data-correo={est.clave}>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-body-sm font-bold text-content-2 flex items-center gap-1.5"><Mail size={15} /> Correo al cliente</span>
                <Badge size="sm" variant={est.variant} uppercase={false}>{est.texto}</Badge>
            </div>
            {vigente?.estado === 'enviado' && vigente.enviado_at && (
                <p className="text-caption text-content-3">El {fechaNumerica(vigente.enviado_at)} a las {hora12(vigente.enviado_at)}, con el archivo JSON y el PDF.</p>
            )}
            {vigente?.estado === 'fallido' && vigente.ultimo_error && <p className="text-caption text-danger-text">{vigente.ultimo_error}</p>}
            {error && <p className="text-caption text-danger-text">{error}</p>}
            {puedeEnviar && (sellado || ES_PRUEBAS) ? (
                <div className="flex flex-wrap items-end gap-2">
                    <PortalInput label="Enviar a" name="correo-destino" type="email" value={destino} onChange={(e) => setDestino(e.target.value)}
                        placeholder="correo@cliente.com" className="flex-1 min-w-[200px]" hasError={destino !== '' && !valido} errorMessage="Revisa el correo" />
                    <Button variant="secondary" icon={enviando ? Loader2 : Send} disabled={!valido || enviando} onClick={enviar}>
                        {vigente?.estado === 'enviado' ? 'Reenviar' : 'Enviar'}
                    </Button>
                </div>
            ) : !sellado && (
                <p className="text-caption text-content-3">Se envía cuando Hacienda lo selle: el cliente tiene que recibir el sello.</p>
            )}
        </section>
    );
}
