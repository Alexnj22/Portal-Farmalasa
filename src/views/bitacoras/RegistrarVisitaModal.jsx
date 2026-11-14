import React, { useState } from 'react';
import LiquidModal from '../../components/common/LiquidModal';
import PieDeModal from '../../components/common/PieDeModal';
import Button from '../../components/common/Button';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import TimePicker12 from '../../components/common/TimePicker12';
import PortalTextarea from '../../components/common/PortalTextarea';
import Notice from '../../components/common/Notice';
import { useToastStore } from '@nucleo/store/toastStore';
import { ACTIVIDADES_DE_REGENCIA, mensajeDeRegencia, registrarVisitaDeRegencia } from '@nucleo/data/regencia';
import { hoySV } from '@nucleo/utils/fecha';
import AvisoDeFalta from '../../components/common/AvisoDeFalta';
import { irAlCampo } from '../../plataforma/irAlCampo';

/*
 * Anotar una visita del regente (2026-11-10). Lo que pide la norma: fecha,
 * horario de permanencia y actividades realizadas; la firma y el sello van en
 * la hoja impresa del mes. La base valida todo (quién anota, que la salida sea
 * después de la entrada y que no choque con otra visita del mismo regente en
 * otra sala) y su mensaje se muestra tal cual.
 */

export default function RegistrarVisitaModal({ branchId, sala, regente, enSuNombre, onClose, onHecho }) {
    const showToast = useToastStore((s) => s.showToast);
    const [fecha, setFecha] = useState(hoySV());
    const [entrada, setEntrada] = useState('');
    const [salida, setSalida] = useState('');
    const [actividades, setActividades] = useState([]);
    const [notas, setNotas] = useState('');
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState(null);

    const alternar = (v) => setActividades((a) => (a.includes(v) ? a.filter((x) => x !== v) : [...a, v]));
    // Lo que falta, en orden, y el campo donde se arregla (2026-11-14). Las
    // mismas condiciones que apagaban el botón.
    const queFalta = !fecha ? { texto: 'Elige la fecha.', campo: 'fecha-visita' }
        : !entrada ? { texto: 'Elige la hora de entrada.', campo: 'entrada-visita' }
        : !salida ? { texto: 'Elige la hora de salida.', campo: 'salida-visita' }
        : !(salida > entrada) ? { texto: 'La salida tiene que ser después de la entrada.', campo: 'salida-visita' }
        : actividades.length === 0 ? { texto: 'Marca al menos una actividad realizada.', campo: 'actividades-visita' }
        : null;
    const listo = !queFalta;

    const guardar = async () => {
        setGuardando(true);
        setError(null);
        const { error: e } = await registrarVisitaDeRegencia({ branchId, fecha, entrada, salida, actividades, notas });
        setGuardando(false);
        if (e) { setError(mensajeDeRegencia(e)); return; }
        showToast('Visita anotada', sala, 'success');
        onHecho?.();
    };

    return (
        <LiquidModal open onClose={guardando ? undefined : onClose} maxWidth="max-w-lg" ariaLabel="Anotar visita del regente">
            <LiquidModal.Header titulo="Anotar visita"
                subtitulo={`${sala}${regente ? ` · ${regente}` : ''}${enSuNombre ? ' (en su nombre)' : ''}`}
                onClose={guardando ? undefined : onClose} />
            <LiquidModal.Body className="space-y-4">
                <div data-campo="fecha-visita">
                    <p className="text-caption font-bold text-content-3 mb-1">Fecha</p>
                    <LiquidDatePicker value={fecha} onChange={setFecha} max={hoySV()} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div data-campo="entrada-visita">
                        <p className="text-caption font-bold text-content-3 mb-1">Entrada</p>
                        <TimePicker12 value={entrada} onChange={setEntrada} />
                    </div>
                    <div data-campo="salida-visita">
                        <p className="text-caption font-bold text-content-3 mb-1">Salida</p>
                        <TimePicker12 value={salida} onChange={setSalida} defaultMeridiem="PM" />
                    </div>
                </div>
                {entrada && salida && salida <= entrada && (
                    <Notice variant="warning">La salida tiene que ser después de la entrada.</Notice>
                )}
                <div data-campo="actividades-visita">
                    <p className="text-caption font-bold text-content-3 mb-2">Actividades realizadas</p>
                    <div className="flex flex-wrap gap-2">
                        {ACTIVIDADES_DE_REGENCIA.map((a) => {
                            const activa = actividades.includes(a.value);
                            return (
                                <button key={a.value} type="button" aria-pressed={activa} onClick={() => alternar(a.value)}
                                    className={`px-3 min-h-[var(--tap-min)] rounded-full border text-body-sm font-bold active:scale-[0.97] transition-colors ${activa
                                        ? 'bg-brand text-white border-brand'
                                        : 'bg-surface-card text-content-2 border-border-card hover:bg-surface-card-hover'}`}>
                                    {a.label}
                                </button>
                            );
                        })}
                    </div>
                </div>
                <PortalTextarea label="Notas (opcional)" value={notas} maxLength={500} rows={3}
                    onChange={(e) => setNotas(e.target.value)} />
                {error && <Notice variant="danger">{error}</Notice>}
            </LiquidModal.Body>
            <PieDeModal izquierda={queFalta && !guardando ? <AvisoDeFalta motivo={queFalta.texto} onIr={() => irAlCampo(queFalta.campo)} /> : null}>
                <Button variant="ghost" onClick={onClose} disabled={guardando}>Cancelar</Button>
                <Button variant="primary" loading={guardando} disabled={!listo} onClick={guardar}>Anotar visita</Button>
            </PieDeModal>
        </LiquidModal>
    );
}
