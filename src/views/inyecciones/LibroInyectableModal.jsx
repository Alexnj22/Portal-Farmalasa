import React, { useEffect, useState } from 'react';
import LiquidModal from '../../components/common/LiquidModal';
import PieDeModal from '../../components/common/PieDeModal';
import Button from '../../components/common/Button';
import LiquidSelect from '../../components/common/LiquidSelect';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import Notice from '../../components/common/Notice';
import Badge from '../../components/common/Badge';
import FirmaEnPantalla from '../../components/common/FirmaEnPantalla';
import { useToastStore } from '@nucleo/store/toastStore';
import { guardarLibroDeInyectable } from '@nucleo/data/inyecciones';
import { VIAS_DE_APLICACION, REACCIONES_DEL_LIBRO, faltaDelLibro, venceDeAmpolla } from '@nucleo/utils/inyeccionesPendientes';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { loadDraft, saveDraft, clearDraft } from '@nucleo/utils/draftUtils';

/*
 * Los datos del libro de inyectables de una aplicación. Lo pide el CSSP por
 * tener inyectorio (2026-11-13): documento y edad del paciente, médico que la
 * recetó, vía, sitio, reacción observada y la firma del paciente. Lote,
 * vencimiento y dosis son de la ampolla: si la aplicación ya los tiene se
 * muestran; si no, se piden acá. Lo escrito se guarda como borrador (la firma
 * no: es del paciente que está enfrente).
 */

const VACIO = { documento: '', edad: '', medico: '', junta_medico: '', via: '', sitio: '', reaccion: '', observaciones: '',
    lote: '', vence: '', dosis_ml: '' };

export default function LibroInyectableModal({ fila, libro, onClose, onHecho }) {
    const showToast = useToastStore((s) => s.showToast);
    const clave = `inyeccion-libro:${fila.id}`;
    const [datos, setDatos] = useState(() => loadDraft(clave) || {
        ...VACIO, ...(libro || {}), edad: libro?.edad != null ? String(libro.edad) : '',
    });
    const [firma, setFirma] = useState(null);
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState(null);
    useEffect(() => { saveDraft(clave, datos); }, [clave, datos]);
    const poner = (k) => (e) => setDatos((d) => ({ ...d, [k]: e?.target ? e.target.value : e }));

    const faltan = faltaDelLibro(datos, fila);
    const conReaccion = datos.reaccion && datos.reaccion !== 'Sin reacción';
    const guardar = async () => {
        setGuardando(true);
        setError(null);
        try {
            await guardarLibroDeInyectable(fila.id, { ...datos, firma_png: firma });
            clearDraft(clave);
            showToast('Libro completado', fila.producto, 'success');
            onHecho?.();
        } catch (e) {
            setError(e?.hint || mensajeAmigable(e, 'No se pudo guardar'));
        } finally { setGuardando(false); }
    };

    const dato = (rotulo, valor) => (
        <div>
            <p className="text-caption font-bold text-content-3 mb-1">{rotulo}</p>
            <Badge variant="neutral">{valor}</Badge>
        </div>
    );

    return (
        <LiquidModal open onClose={guardando ? undefined : onClose} maxWidth="max-w-lg" ariaLabel="Datos del libro de inyectables">
            <LiquidModal.Header titulo="Datos del libro"
                subtitulo={`${fila.producto} · ${fila.cliente || 'sin cliente'} · ${fila.origen === 'TRAIDA' ? 'lo trajo el paciente' : 'comprado aquí'}`}
                onClose={guardando ? undefined : onClose} />
            <LiquidModal.Body className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                        <PortalInput label="DUI u otro documento del paciente" required value={datos.documento} onChange={poner('documento')} />
                    </div>
                    <PortalInput label="Edad" type="number" required value={datos.edad} onChange={poner('edad')} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <PortalInput label="Médico que la recetó" value={datos.medico} onChange={poner('medico')} />
                    <PortalInput label="Número JVPM" value={datos.junta_medico} onChange={poner('junta_medico')} />
                </div>

                {/* La ampolla: lo que la aplicación ya tiene no se vuelve a pedir. */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {fila.lote ? dato('Lote', fila.lote)
                        : <PortalInput label="Lote" required value={datos.lote} onChange={poner('lote')} />}
                    {fila.vence ? dato('Vence', venceDeAmpolla(fila.vence))
                        : <PortalInput label="Vence" type="date" required value={datos.vence} onChange={poner('vence')} />}
                    {fila.dosis_ml != null ? dato('Dosis', `${fila.dosis_ml} ml`)
                        : <PortalInput label="Dosis (ml)" type="number" required value={datos.dosis_ml} onChange={poner('dosis_ml')} />}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                        <p className="text-caption font-bold text-content-3 mb-1">Vía</p>
                        <LiquidSelect value={datos.via} onChange={(v) => setDatos((d) => ({ ...d, via: v || '' }))}
                            options={VIAS_DE_APLICACION} placeholder="¿Por qué vía?" clearable={false} />
                    </div>
                    <PortalInput label="Sitio de aplicación" required placeholder="Glúteo, deltoides…" value={datos.sitio} onChange={poner('sitio')} />
                </div>
                <div>
                    <p className="text-caption font-bold text-content-3 mb-1">Reacción observada</p>
                    <LiquidSelect value={datos.reaccion} onChange={(v) => setDatos((d) => ({ ...d, reaccion: v || '' }))}
                        options={REACCIONES_DEL_LIBRO} placeholder="¿Hubo alguna reacción?" clearable={false} />
                </div>
                <PortalTextarea label={conReaccion ? 'Qué pasó y qué se hizo' : 'Observaciones (opcional)'}
                    rows={3} maxLength={500}
                    helperText={conReaccion ? 'Anótalo también en Cumplimiento → Farmacovigilancia.' : undefined}
                    value={datos.observaciones} onChange={poner('observaciones')} />

                {libro?.firmado && !firma && <Notice variant="success">El paciente ya firmó. Si firma de nuevo, se reemplaza.</Notice>}
                <FirmaEnPantalla onChange={setFirma} disabled={guardando}
                    ayuda={libro?.firmado ? 'Opcional: ya hay una firma guardada.' : 'Opcional. Si el paciente no quiere firmar, se guarda igual.'} />

                {faltan.length > 0 && <Notice variant="warning">{`Falta: ${faltan.join(', ')}.`}</Notice>}
                {error && <Notice variant="danger">{error}</Notice>}
            </LiquidModal.Body>
            <PieDeModal>
                <Button variant="ghost" onClick={onClose} disabled={guardando}>Cancelar</Button>
                <Button variant="primary" loading={guardando} disabled={faltan.length > 0} onClick={guardar}>Guardar</Button>
            </PieDeModal>
        </LiquidModal>
    );
}
