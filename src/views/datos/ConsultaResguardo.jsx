/**
 * Consultar lo que se guardó al anonimizar a una persona (2026-10-26).
 *
 * El resguardo existe para responderle a una autoridad o a la propia persona,
 * no para usarlo: por eso exige escribir el motivo, y la base lo anota (quién,
 * cuándo, por qué) ANTES de devolver una sola fila. Lo que se muestra aquí ya
 * quedó registrado; la lista de consultas anteriores va al final para que
 * quien lee sepa que su lectura también queda.
 */
import React, { useState } from 'react';
import { Eye, Lock } from 'lucide-react';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import PortalTextarea from '../../components/common/PortalTextarea';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fechaTexto } from '@nucleo/utils/fecha';
import { leerResguardo } from '@nucleo/data/solicitudesDatos';

const TABLAS = {
    customers: 'Ficha del cliente',
    solicitudes_datos: 'Solicitud de datos',
    consentimientos_cliente: 'Consentimientos',
    app_cliente_aceptaciones: 'Aceptaciones en la app',
    reclamos_clientes: 'Reclamos',
    encuesta_cliente_respuestas: 'Encuestas',
    customers_changelog: 'Historial de cambios de la ficha',
    espejo_conflictos: 'Diferencias de ficha por revisar',
    clientes_por_revisar: 'Fichas por revisar',
    app_chat_conversaciones: 'Conversaciones del chat',
    app_chat_mensajes: 'Mensajes del chat',
    app_cliente_fotos: 'Fotos',
    app_cliente_preregistros: 'Pre-registros',
    app_cliente_avisos: 'Avisos',
    app_cliente_correos: 'Correos',
    app_cliente_correo_envios: 'Envíos de correo',
    app_cliente_muestras: 'Muestras',
    app_tratamientos: 'Tratamientos',
    app_reservas: 'Reservas (dirección de entrega)',
};

// Los campos de la ficha que se le muestran a una persona; el resto (columnas
// internas y derivadas) queda en el detalle.
const CAMPOS_FICHA = [
    ['name', 'Nombre'], ['dui', 'DUI'], ['nit', 'NIT'], ['nrc', 'NRC'], ['pasaporte', 'Pasaporte'],
    ['phone', 'Teléfono'], ['telefono2', 'Teléfono 2'], ['email', 'Correo'], ['direccion', 'Dirección'],
    ['fecha_nacimiento', 'Nacimiento'], ['notes', 'Notas'],
];

const cuando = (iso) => (iso ? fechaTexto(iso, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');

function Fila({ fila }) {
    const [abierta, setAbierta] = useState(false);
    const d = fila.datos ?? {};
    return (
        <div className="rounded-lg border border-border-subtle px-3 py-2">
            {fila.tabla === 'customers' ? (
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                    <div className="sm:col-span-2 text-caption text-content-3">Ficha #{d.id}</div>
                    {CAMPOS_FICHA.filter(([k]) => d[k] != null && d[k] !== '').map(([k, rotulo]) => (
                        <div key={k} className="min-w-0">
                            <dt className="text-caption text-content-3">{rotulo}</dt>
                            <dd className="text-body-sm text-content break-words">{String(d[k])}</dd>
                        </div>
                    ))}
                </dl>
            ) : (
                <p className="text-body-sm text-content">
                    {fila.accion === 'vaciada' ? 'Se vaciaron datos de un registro' : 'Registro borrado'}
                    <span className="text-caption text-content-3"> · {d.created_at ? cuando(d.created_at) : `#${fila.fila_id}`}</span>
                </p>
            )}
            <Button variant="ghost" size="sm" onClick={() => setAbierta((v) => !v)}>
                {abierta ? 'Ocultar el detalle' : 'Ver el detalle completo'}
            </Button>
            {abierta && (
                <div className="mt-1 whitespace-pre-wrap break-words font-mono text-caption text-content-2">
                    {JSON.stringify(d, null, 2)}
                </div>
            )}
        </div>
    );
}

export default function ConsultaResguardo({ anonimizacionId }) {
    const showToast = useToastStore((s) => s.showToast);
    const [motivo, setMotivo] = useState('');
    const [ocupado, setOcupado] = useState(false);
    const [r, setR] = useState(null);

    const consultar = async () => {
        setOcupado(true);
        try {
            setR(await leerResguardo(anonimizacionId, motivo.trim()));
        } catch (e) {
            showToast('No se pudo consultar', mensajeAmigable(e, 'Intenta de nuevo.'), 'error');
        } finally { setOcupado(false); }
    };

    if (!r) {
        return (
            <div className="flex flex-col gap-3">
                <Notice variant="info" icon={Lock} compact>
                    El resguardo sólo se consulta con un motivo (un requerimiento de autoridad, una reclamación, la
                    propia persona). Queda registrado quién lo consultó, cuándo y por qué.
                </Notice>
                <PortalTextarea label="Motivo de la consulta" rows={2} maxLength={500}
                    value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                <div className="flex justify-end">
                    <Button size="sm" icon={Eye} loading={ocupado} disabled={motivo.trim().length < 10}
                        onClick={consultar}>Consultar el resguardo</Button>
                </div>
            </div>
        );
    }

    const grupos = {};
    for (const f of r.filas ?? []) (grupos[f.tabla] ??= []).push(f);

    return (
        <div className="flex flex-col gap-4">
            {Object.entries(grupos).map(([tabla, filas]) => (
                <section key={tabla} className="flex flex-col gap-2">
                    <h4 className="text-caption font-bold text-content-2">
                        {TABLAS[tabla] ?? tabla} <span className="text-content-3">({filas.length})</span>
                    </h4>
                    {filas.map((f, i) => <Fila key={`${f.tabla}-${f.fila_id}-${i}`} fila={f} />)}
                </section>
            ))}
            {!(r.filas ?? []).length && <p className="text-body-sm text-content-3">El resguardo está vacío.</p>}
            <section className="flex flex-col gap-1">
                <h4 className="text-caption font-bold text-content-2">Consultas registradas</h4>
                {(r.lecturas ?? []).map((l, i) => (
                    <p key={i} className="text-caption text-content-3">
                        {cuando(l.cuando)} · {l.quien ? shortEmployeeName(l.quien) : 'Personal'} · «{l.motivo}»
                    </p>
                ))}
            </section>
        </div>
    );
}
