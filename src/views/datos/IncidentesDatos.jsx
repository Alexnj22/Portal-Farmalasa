/**
 * Incidentes de seguridad de datos personales (Art. 25, 2026-10-24).
 *
 * La ley da SETENTA Y DOS HORAS desde que se detecta una vulneración para
 * notificar a la Agencia de Ciberseguridad del Estado, a la Fiscalía y a las
 * personas afectadas, y pide documentar la fecha, el motivo, los hechos, sus
 * efectos y las medidas. No había dónde anotarlo: sin registro, el plazo no se
 * puede contar ni probar.
 *
 * Quién lo registró lo pone la base (`registrado_por` = quien inserta). Los
 * avisos de 48 y 72 horas los manda `avisar_incidentes_datos` (cron horario).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ShieldAlert, Plus, Check } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { saveDraft, loadDraft, clearDraft } from '@nucleo/utils/draftUtils';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fechaTexto } from '@nucleo/utils/fecha';
import {
    fetchIncidentes, guardarIncidente, plazoDeIncidente, NOTIFICACIONES_DE_INCIDENTE,
} from '@nucleo/data/solicitudesDatos';

const COLUMNAS = [
    { key: 'detectado', label: 'Detectado' },
    { key: 'que', label: 'Qué pasó' },
    { key: 'datos', label: 'Datos comprometidos', hideBelow: 'md' },
    { key: 'plazo', label: '72 horas' },
    { key: 'quien', label: 'Lo registró', hideBelow: 'md' },
];

const cuando = (iso) => (iso ? fechaTexto(iso, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');

const paraInput = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const deInput = (v) => (v ? new Date(v).toISOString() : null);

const CAMPOS_FECHA = ['detectado_at', 'ocurrido_at', 'notificado_agencia_at', 'notificado_fiscalia_at', 'notificado_titulares_at', 'cerrado_at'];

function EstadoDelPlazo({ inc }) {
    const p = plazoDeIncidente(inc);
    if (!p) return null;
    if (inc.cerrado_at) return <Badge variant="neutral" uppercase={false}>Cerrado</Badge>;
    if (p.completo) return <Badge variant="success" uppercase={false}>Notificado</Badge>;
    return (
        <Badge variant={p.vencido ? 'danger' : p.horas <= 24 ? 'warning' : 'info'} uppercase={false}
            title={`Falta: ${p.faltan.map((f) => f.rotulo).join(', ')}`}>
            {p.vencido ? `Vencido hace ${Math.abs(p.horas)} h` : `Quedan ${p.horas} h`}
        </Badge>
    );
}

export default function IncidentesDatos() {
    const showToast = useToastStore((s) => s.showToast);
    const [filas, setFilas] = useState(null);
    const [abierto, setAbierto] = useState(null); // {} = nuevo; fila = existente

    useEffect(() => {
        let vivo = true;
        fetchIncidentes()
            .then((d) => { if (vivo) setFilas(d); })
            .catch((e) => { if (vivo) { setFilas([]); showToast('No se pudo cargar', mensajeAmigable(e), 'error'); } });
        return () => { vivo = false; };
    }, [showToast]);

    const abiertosSinNotificar = useMemo(() => (filas ?? []).filter((i) => {
        const p = plazoDeIncidente(i);
        return !i.cerrado_at && p && !p.completo;
    }), [filas]);

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="text-body-sm text-content-3 max-w-2xl">
                    Si se pierden, se filtran o alguien accede sin permiso a datos personales, hay setenta y dos horas
                    desde que se detecta para notificar a la Agencia de Ciberseguridad del Estado, a la Fiscalía y a
                    las personas afectadas (Art. 25).
                </p>
                <Button icon={Plus} onClick={() => setAbierto({})}>Registrar incidente</Button>
            </div>

            {abiertosSinNotificar.length > 0 && (
                <Notice variant="danger" icon={ShieldAlert} bloque>
                    {abiertosSinNotificar.length === 1 ? 'Hay un incidente' : `Hay ${abiertosSinNotificar.length} incidentes`} con
                    notificaciones pendientes.
                </Notice>
            )}

            <DataTable columns={COLUMNAS} loading={filas === null} minWidth="760px"
                movil={{ usarAccionDeFila: true }}
                empty={{ icon: ShieldAlert, message: 'Sin incidentes registrados' }}>
                {(filas ?? []).map((i, k) => (
                    <DataRow key={i.id} index={k} onClick={() => setAbierto(i)}>
                        <DataCell>{cuando(i.detectado_at)}</DataCell>
                        <DataCell><span className="text-body-sm text-content line-clamp-2">{i.naturaleza}</span></DataCell>
                        <DataCell><span className="text-caption text-content-2 line-clamp-2">{i.datos_comprometidos}</span></DataCell>
                        <DataCell><EstadoDelPlazo inc={i} /></DataCell>
                        <DataCell>{i.registrado ? shortEmployeeName(i.registrado) : '—'}</DataCell>
                    </DataRow>
                ))}
            </DataTable>

            {abierto && (
                <Ficha key={abierto.id ?? 'nuevo'} inc={abierto} onClose={() => setAbierto(null)}
                    onGuardado={(fila) => {
                        setFilas((p) => [fila, ...(p ?? []).filter((x) => x.id !== fila.id)]
                            .sort((a, b) => String(b.detectado_at).localeCompare(String(a.detectado_at))));
                        setAbierto(null);
                    }} />
            )}
        </div>
    );
}

function Ficha({ inc, onClose, onGuardado }) {
    const showToast = useToastStore((s) => s.showToast);
    const nuevo = !inc.id;
    const claveBorrador = `incidente_datos_${inc.id ?? 'nuevo'}`;
    // La sesión de sala se cierra sola: lo escrito se guarda como borrador.
    const [f, setF] = useState(() => loadDraft(claveBorrador) ?? {
        ...Object.fromEntries(CAMPOS_FECHA.map((k) => [k, paraInput(inc[k])])),
        detectado_at: paraInput(inc.detectado_at ?? new Date().toISOString()),
        naturaleza: inc.naturaleza ?? '', datos_comprometidos: inc.datos_comprometidos ?? '', afectados: inc.afectados ?? '',
        medidas_inmediatas: inc.medidas_inmediatas ?? '', recomendaciones: inc.recomendaciones ?? '',
        medidas_definitivas: inc.medidas_definitivas ?? '', notas: inc.notas ?? '',
    });
    const [guardando, setGuardando] = useState(false);
    useEffect(() => { saveDraft(claveBorrador, f); }, [claveBorrador, f]);
    const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
    const cerrado = !!inc.cerrado_at;

    const guardar = async (cerrar = false) => {
        setGuardando(true);
        try {
            const campos = { ...f, ...Object.fromEntries(CAMPOS_FECHA.map((k) => [k, deInput(f[k])])) };
            if (cerrar) campos.cerrado_at = new Date().toISOString();
            const fila = await guardarIncidente(inc.id ?? null, campos);
            clearDraft(claveBorrador);
            showToast('Guardado', nuevo ? 'Incidente registrado: corre el plazo de 72 horas' : 'Incidente actualizado', 'success');
            onGuardado(fila);
        } catch (e) {
            showToast('No se pudo guardar', mensajeAmigable(e), 'error');
        } finally { setGuardando(false); }
    };

    const listo = !!f.detectado_at && !!f.naturaleza.trim() && !!f.datos_comprometidos.trim();
    const plazo = plazoDeIncidente({ ...inc, ...Object.fromEntries(CAMPOS_FECHA.map((k) => [k, deInput(f[k])])) });

    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-2xl" ariaLabel="Incidente de seguridad de datos">
            <LiquidModal.Header titulo={nuevo ? 'Registrar incidente' : 'Incidente de seguridad'}
                acciones={!nuevo && <EstadoDelPlazo inc={inc} />} onClose={onClose} />
            <LiquidModal.Body>
                <div className="flex flex-col gap-4">
                    {plazo && !plazo.completo && !cerrado && (
                        <Notice variant={plazo.vencido ? 'danger' : 'warning'} compact>
                            {plazo.vencido ? 'Pasaron las 72 horas.' : `Hay que notificar a más tardar el ${cuando(plazo.vence)}.`}
                            {' '}Falta: {plazo.faltan.map((x) => x.rotulo).join(', ')}.
                        </Notice>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <PortalInput label="Cuándo se detectó" type="datetime-local" value={f.detectado_at}
                            onChange={set('detectado_at')} readOnly={cerrado} />
                        <PortalInput label="Cuándo ocurrió (si se sabe)" type="datetime-local" value={f.ocurrido_at}
                            onChange={set('ocurrido_at')} readOnly={cerrado} />
                    </div>
                    <PortalTextarea label="Qué pasó y por qué" rows={3} value={f.naturaleza} onChange={set('naturaleza')} readOnly={cerrado} />
                    <PortalTextarea label="Qué datos se comprometieron" rows={2} value={f.datos_comprometidos} onChange={set('datos_comprometidos')} readOnly={cerrado} />
                    <PortalTextarea label="A quiénes afecta (cuántas personas, quiénes)" rows={2} value={f.afectados} onChange={set('afectados')} readOnly={cerrado} />
                    <PortalTextarea label="Medidas inmediatas" rows={2} value={f.medidas_inmediatas} onChange={set('medidas_inmediatas')} readOnly={cerrado} />
                    <PortalTextarea label="Recomendaciones a las personas afectadas" rows={2} value={f.recomendaciones} onChange={set('recomendaciones')} readOnly={cerrado} />

                    <section className="flex flex-col gap-2">
                        <h3 className="text-body-sm font-black text-content uppercase tracking-wide">Notificaciones</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            {NOTIFICACIONES_DE_INCIDENTE.map((n) => (
                                <PortalInput key={n.campo} label={n.rotulo} type="datetime-local" value={f[n.campo]}
                                    onChange={set(n.campo)} readOnly={cerrado} />
                            ))}
                        </div>
                    </section>

                    <PortalTextarea label="Medidas definitivas" rows={2} value={f.medidas_definitivas} onChange={set('medidas_definitivas')} readOnly={cerrado} />
                    <PortalTextarea label="Notas internas" rows={2} value={f.notas} onChange={set('notas')} readOnly={cerrado} />
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <Button variant="ghost" onClick={onClose}>Cerrar</Button>
                {!cerrado && !nuevo && (
                    <Button variant="secondary" loading={guardando} disabled={!listo || !plazo?.completo}
                        title={plazo?.completo ? undefined : 'Para cerrarlo tienen que estar las tres notificaciones'}
                        onClick={() => guardar(true)}>Cerrar el incidente</Button>
                )}
                {!cerrado && (
                    <Button icon={Check} loading={guardando} disabled={!listo} onClick={() => guardar(false)}>
                        {nuevo ? 'Registrar' : 'Guardar'}
                    </Button>
                )}
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
