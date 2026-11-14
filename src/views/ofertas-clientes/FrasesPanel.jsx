import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Quote, Plus, Pause, Play, Trash2, Pencil, CalendarDays } from 'lucide-react';
import FilterBar from '../../components/common/FilterBar';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import Button from '../../components/common/Button';
import LiquidModal from '../../components/common/LiquidModal';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import PortalTextarea from '../../components/common/PortalTextarea';
import SegmentedControl from '../../components/common/SegmentedControl';
import ConfirmModal from '../../components/common/ConfirmModal';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { LoadingState } from '../../components/common/StateViews';
import { CATEGORIAS_DE_FRASE, FRASE_MAX, diaDeFrase, estadosDeFrases, filaDeFrase, fraseDeUnDia, faltaEnFrase } from '@nucleo/utils/ofertasClientes';
import PieDeModal from '../../components/common/PieDeModal';
import AvisoDeFalta from '../../components/common/AvisoDeFalta';
import { irAlCampo } from '../../plataforma/irAlCampo';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { fechaTexto, sumarDias } from '@nucleo/utils/fecha';
import { borrarFrase, fetchFrases, guardarFrase, pausarFrase } from '@nucleo/data/ofertasClientes';

/**
 * Frases del día de la app de clientes (2026-11-03). La app trae ~300 frases
 * propias y cambia a las 8:00; las de acá le GANAN el día que hay una:
 *
 *   · programada: sale ESE día (una por día);
 *   · en la cola: cada día sin programada toma la siguiente, una vez.
 *
 * Cuando la cola se acaba, la app vuelve a las suyas: nunca falta frase.
 * Tabla `app_frases`; mismo permiso que las ofertas.
 */
const CATEGORIA = Object.fromEntries(CATEGORIAS_DE_FRASE.map((c) => [c.value, c.label]));
const CUANDO = [{ value: 'cola', label: 'En la cola' }, { value: 'dia', label: 'Un día específico' }];

export default function FrasesPanel({ busqueda, puedeEditar, showToast }) {
    const [frases, setFrases] = useState(null);
    const [error, setError] = useState(null);
    const [fEstado, setFEstado] = useState('');
    const [editando, setEditando] = useState(null);
    const [borrando, setBorrando] = useState(null);

    const cargar = useCallback(async () => {
        try {
            setFrases(await fetchFrases());
            setError(null);
        } catch (err) {
            setError(mensajeAmigable(err, 'No se pudieron cargar las frases.'));
        }
    }, []);
    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- la carga inicial

    const hoy = diaDeFrase();
    const estados = useMemo(() => estadosDeFrases(frases ?? [], hoy), [frases, hoy]);
    const filas = useMemo(() => (frases ?? [])
        .filter((f) => !fEstado || estados.get(f.id)?.key === fEstado)
        .filter((f) => !busqueda || tokenMatch(f.texto, busqueda)), [frases, estados, fEstado, busqueda]);
    const deHoy = useMemo(() => fraseDeUnDia(frases ?? [], hoy, hoy), [frases, hoy]);
    const deManana = useMemo(() => fraseDeUnDia(frases ?? [], sumarDias(hoy, 1), hoy), [frases, hoy]);
    const enCola = useMemo(() => [...estados.values()].filter((e) => e.key === 'cola').length, [estados]);

    const pausar = async (f) => {
        try {
            await pausarFrase(f.id, !f.activa);
            showToast(f.activa ? 'Frase pausada' : 'Frase activa', f.activa ? 'No va a salir en la app.' : 'Vuelve a su lugar.', 'success');
            cargar();
        } catch (err) {
            showToast('No se pudo cambiar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        }
    };

    const acciones = puedeEditar ? [{
        key: 'nueva', icon: Plus, label: 'Nueva frase', title: 'Agregar una frase del día', rotulo: 'Nueva',
        variant: 'primary', onClick: () => setEditando({}),
    }] : [];

    if (error) return <Notice variant="danger">{error}</Notice>;
    if (!frases) return <LoadingState label="Cargando frases" />;

    return (
        <>
            <Notice variant="info" title={deHoy ? `Hoy en la app: «${deHoy.texto}»` : 'Hoy sale una frase de las que trae la app'}>
                {deManana ? `Mañana a las 8:00: «${deManana.texto}».` : 'Mañana sale una de las que trae la app.'}
                {' '}{enCola ? `La cola alcanza para ${enCola} día${enCola === 1 ? '' : 's'} más.` : 'La cola está vacía: cuando no hay frases aquí, la app usa las suyas (cerca de 300).'}
            </Notice>
            <div className="flex justify-end">
                <FilterBar acciones={acciones} activeCount={fEstado ? 1 : 0} onClear={fEstado ? () => setFEstado('') : undefined}>
                    <FilterBar.Section label="estado" active={!!fEstado} onClear={() => setFEstado('')}>
                        <FilterBar.Opciones value={fEstado} onChange={(v) => setFEstado(v || '')} label="Estado" placeholder="Estado" umbral={0}
                            options={[{ value: '', label: 'Estado' }, { value: 'hoy', label: 'En la app hoy' },
                                { value: 'cola', label: 'En la cola' }, { value: 'programada', label: 'Programada' },
                                { value: 'salio', label: 'Ya salió' }, { value: 'pausada', label: 'Pausada' }]} />
                    </FilterBar.Section>
                </FilterBar>
            </div>
            <DataTable
                columns={[
                    { key: 'frase', label: 'Frase' },
                    { key: 'estado', label: 'Estado' },
                    { key: 'dia', label: 'Día', hideBelow: 'sm' },
                    ...(puedeEditar ? [{ key: 'acciones', label: '', align: 'right' }] : []),
                ]}
                movil={{ usarAccionDeFila: true, acciones: 'mantener' }}
                empty={{ icon: Quote, message: 'Sin frases cargadas. La app usa las suyas; agrega una para que salga primero.' }}
                minWidth="560px">
                {filas.map((f, i) => {
                    const est = estados.get(f.id);
                    const dia = f.fecha ?? f.mostrada_el;
                    // La de hoy no se borra: borrarla haría salir otra de la cola el mismo día.
                    const borrable = est?.key !== 'hoy';
                    return (
                        <DataRow key={f.id} index={i} onClick={puedeEditar ? () => setEditando(f) : undefined}>
                            <DataCell>
                                <div className="min-w-0">
                                    <p className="text-body-sm font-semibold text-content">«{f.texto}»</p>
                                    <p className="text-micro text-content-3">{CATEGORIA[f.categoria] ?? f.categoria}</p>
                                </div>
                            </DataCell>
                            <DataCell><Badge variant={est?.variant}>{est?.label}</Badge></DataCell>
                            <DataCell>
                                <span className="text-body-sm text-content-2">
                                    {dia ? fechaTexto(dia, { weekday: 'short', day: 'numeric', month: 'short' }) : '—'}
                                </span>
                            </DataCell>
                            {puedeEditar && (
                                <DataCell align="right">
                                    <div className="flex justify-end gap-1">
                                        <Button variant="ghost" iconOnly icon={f.activa ? Pause : Play}
                                            title={f.activa ? 'Pausar: que no salga' : 'Volver a activar'}
                                            onClick={(e) => { e.stopPropagation(); pausar(f); }} />
                                        <Button variant="ghost" iconOnly icon={Pencil} title="Editar"
                                            onClick={(e) => { e.stopPropagation(); setEditando(f); }} />
                                        {borrable && (
                                            <Button variant="ghost" iconOnly icon={Trash2} title="Borrar"
                                                onClick={(e) => { e.stopPropagation(); setBorrando(f); }} />
                                        )}
                                    </div>
                                </DataCell>
                            )}
                        </DataRow>
                    );
                })}
            </DataTable>
            {editando && (
                <FraseModal frase={editando} frases={frases} hoy={hoy} onClose={() => setEditando(null)}
                    onGuardada={() => { setEditando(null); cargar(); showToast('Frase guardada', '', 'success'); }}
                    onError={(err) => showToast('No se pudo guardar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error')} />
            )}
            {borrando && (
                <ConfirmModal isOpen title="Borrar frase" message={`«${borrando.texto}» se borra y no va a salir en la app.`}
                    confirmText="Borrar" onClose={() => setBorrando(null)}
                    onConfirm={async () => {
                        try {
                            await borrarFrase(borrando);
                            setBorrando(null);
                            cargar();
                            showToast('Frase borrada', '', 'success');
                        } catch (err) {
                            showToast('No se pudo borrar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
                        }
                    }} />
            )}
        </>
    );
}

function FraseModal({ frase, frases, hoy, onClose, onGuardada, onError }) {
    const nueva = !frase.id;
    // Una frase de la cola que ya salió no se puede pasar a un día (la base lo rechaza).
    const yaSalio = !!frase.mostrada_el;
    const [f, setF] = useState({
        texto: frase.texto ?? '', categoria: frase.categoria ?? 'animo',
        programada: !!frase.fecha, fecha: frase.fecha ?? sumarDias(hoy, 1), activa: frase.activa ?? true,
    });
    const [guardando, setGuardando] = useState(false);
    const cambiar = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
    // Una sola por día: se avisa antes de que la base la rechace.
    const choca = f.programada && (frases ?? []).find((x) => x.id !== frase.id && x.activa && x.fecha === f.fecha);
    // Lo que falta y su campo (2026-11-14); el botón se apaga con lo mismo.
    const queFalta = faltaEnFrase(f) ?? (choca ? { texto: 'Ese día ya tiene frase: elige otro día.', campo: 'fecha' } : null);
    const valido = !queFalta;
    const largo = f.texto.trim().length;

    const guardar = async () => {
        setGuardando(true);
        try {
            await guardarFrase(frase.id, filaDeFrase(f));
            onGuardada();
        } catch (err) {
            onError(err);
        } finally {
            setGuardando(false);
        }
    };

    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-lg" ariaLabel={nueva ? 'Nueva frase' : 'Editar frase'}>
            <LiquidModal.Header titulo={nueva ? 'Nueva frase del día' : 'Editar frase'} onClose={onClose} />
            <LiquidModal.Body>
                <div className="space-y-4">
                    <PortalTextarea label="Frase" name="texto" rows={3} value={f.texto} maxLength={FRASE_MAX}
                        onChange={(e) => cambiar('texto')(e.target.value)} placeholder="Ej. Un paso pequeño también es avanzar."
                        helperText={`${largo} de ${FRASE_MAX} letras. Corta se lee mejor: lo ideal es menos de 90. Sin autor, y los consejos de salud, generales (nada de dosis).`} />
                    <div data-campo="categoria">
                        <span className="block text-label font-semibold text-content-2 mb-1">Tipo</span>
                        <p className="text-micro text-content-3 mb-2">Cambia el color de la tarjeta en la app.</p>
                        <SegmentedControl label="Tipo" value={f.categoria} onChange={cambiar('categoria')} options={CATEGORIAS_DE_FRASE} />
                    </div>
                    {!yaSalio && (
                        <div>
                            <span className="block text-label font-semibold text-content-2 mb-1">Cuándo sale</span>
                            <p className="text-micro text-content-3 mb-2">
                                En la cola sale el próximo día libre, en el orden en que se cargaron. Un día específico le gana a la cola.
                            </p>
                            <SegmentedControl label="Cuándo sale" value={f.programada ? 'dia' : 'cola'}
                                onChange={(v) => cambiar('programada')(v === 'dia')} options={CUANDO} />
                            {f.programada && (
                                <div className="mt-3 space-y-2" data-campo="fecha">
                                    <span className="flex items-center gap-1.5 text-label font-semibold text-content-2"><CalendarDays size={14} /> Día</span>
                                    <LiquidDatePicker value={f.fecha} onChange={cambiar('fecha')} />
                                    {choca && <Notice variant="warning">Ese día ya tiene frase: «{choca.texto}». Elige otro día o pausa aquélla.</Notice>}
                                    {f.fecha < hoy && !choca && <Notice variant="warning">Ese día ya pasó: la frase no va a salir.</Notice>}
                                </div>
                            )}
                        </div>
                    )}
                    {/* Vista previa con los colores de la app. */}
                    {largo > 0 && (
                        <div className={`rounded-card p-4 text-white ${f.categoria === 'salud' ? 'bg-gradient-to-br from-brand to-logo-green-solid' : f.categoria === 'calma' ? 'bg-gradient-to-br from-brand to-brand-purple' : 'bg-gradient-to-br from-brand-purple to-logo-magenta'}`}>
                            <p className="text-micro font-bold tracking-wide opacity-90">FRASE DEL DÍA · {(CATEGORIA[f.categoria] ?? '').toUpperCase()}</p>
                            <p className="text-title font-extrabold mt-1">{f.texto.trim()}</p>
                        </div>
                    )}
                </div>
            </LiquidModal.Body>
            <PieDeModal izquierda={queFalta && !guardando ? <AvisoDeFalta motivo={queFalta.texto} onIr={() => irAlCampo(queFalta.campo)} /> : null}>
                <Button variant="secondary" onClick={onClose}>Cancelar</Button>
                <Button icon={Quote} loading={guardando} disabled={!valido} onClick={guardar}>Guardar</Button>
            </PieDeModal>
        </LiquidModal>
    );
}
