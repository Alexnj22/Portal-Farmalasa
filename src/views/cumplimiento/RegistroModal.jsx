import React, { useEffect, useMemo, useState } from 'react';
import LiquidModal from '../../components/common/LiquidModal';
import PieDeModal from '../../components/common/PieDeModal';
import AvisoDeFalta from '../../components/common/AvisoDeFalta';
import { irAlCampo } from '../../plataforma/irAlCampo';
import Button from '../../components/common/Button';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import LiquidSelect from '../../components/common/LiquidSelect';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import Notice from '../../components/common/Notice';
import Badge from '../../components/common/Badge';
import { useToastStore } from '@nucleo/store/toastStore';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import {
    avisarRetiroATodas, cerrarRegistroDeCumplimiento, guardarRegistroDeCumplimiento, mensajeDeCumplimiento,
} from '@nucleo/data/cumplimiento';
import {
    TIPOS, camposAlCerrar, camposAlCrear, datosIniciales, datosParaGuardar, faltantes, listaDe, nombreDelSemestre, puntuarLista, semestresRecientes,
} from '@nucleo/utils/cumplimiento';
import { hoySV } from '@nucleo/utils/fecha';
import { loadDraft, saveDraft, clearDraft } from '@nucleo/utils/draftUtils';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { salasDeBitacora } from '@nucleo/utils/rondaDeBitacora';

/*
 * Un formulario para todos los registros de cumplimiento (2026-11-11). Los
 * campos salen de `TIPOS` (src/utils/cumplimiento.js), que es la gemela de lo
 * que la base exige: la pantalla marca lo que falta antes de mandar, y si la
 * base igual rechaza, su mensaje se muestra tal cual.
 *
 * Dos modos: crear (los campos de alta) y cerrar (sólo los de cierre, que se
 * agregan a lo que ya tenía). Un retiro de lote puede anotarse una vez para
 * todas las salas (`aTodas`). Lo escrito se guarda como borrador: la sesión se
 * cierra sola por inactividad.
 *
 * Sin sala (quien ve toda la red y no filtró una), la sala se elige acá
 * mismo (2026-11-14): antes el botón quedaba apagado con «elige una sala en
 * el filtro», un paso de más que nadie adivinaba.
 */

const VACIO = [];
const RESPUESTAS = [
    { value: 'si', label: 'Cumple' },
    { value: 'no', label: 'No cumple' },
    { value: 'na', label: 'No aplica' },
];

export default function RegistroModal({ tipo, modo = 'crear', registro = null, branchId, sala, aTodas = false, inicial = null, onClose, onHecho }) {
    const showToast = useToastStore((s) => s.showToast);
    const employees = useStaff((s) => s.employees) || VACIO;
    const branches = useStaff((s) => s.branches) || VACIO;
    const def = TIPOS[tipo];
    const cerrando = modo === 'cerrar';
    const campos = cerrando ? camposAlCerrar(tipo) : camposAlCrear(tipo);
    const claveBorrador = `cumplimiento:${tipo}:${modo}:${registro?.id ?? branchId ?? 'todas'}`;

    const [fecha, setFecha] = useState(() => loadDraft(claveBorrador)?.fecha || registro?.fecha || hoySV());
    const [datos, setDatos] = useState(() => loadDraft(claveBorrador)?.datos || (cerrando ? {} : { ...datosIniciales(tipo, registro), ...(registro ? {} : inicial || {}) }));
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => { saveDraft(claveBorrador, { fecha, datos }); }, [claveBorrador, fecha, datos]);

    const opcionesSala = useMemo(() => salasDeBitacora(branches), [branches]);
    const eligeSala = !branchId && !aTodas && !cerrando && !registro;
    const [salaId, setSalaId] = useState(branchId ? String(branchId) : '');
    const nombreSala = sala || opcionesSala.find((o) => o.value === salaId)?.label || '';

    const poner = (k, v) => setDatos((d) => ({ ...d, [k]: v }));
    const falta = [...(eligeSala && !salaId ? ['Sala'] : []), ...faltantes(tipo, datos, campos)];

    // Para la capacitación: el personal activo de la sala (o de toda la red si
    // se anota para administración).
    const personal = useMemo(() => employees
        .filter((e) => e.status !== 'INACTIVO' && e.status !== 'LIQUIDADO')
        .filter((e) => !salaId || String(e.branchId ?? e.branch_id ?? '') === salaId)
        .map((e) => ({ value: e.id, label: shortEmployeeName(e) }))
        .sort((a, b) => a.label.localeCompare(b.label)), [employees, salaId]);

    const lista = listaDe(tipo);
    const puntaje = lista.length ? puntuarLista(lista, datos.respuestas) : null;

    // Lo que falta, al lado del botón, y el campo al que lleva (2026-11-14):
    // el primero de la lista; en una lista de verificación, la primera
    // pregunta sin responder. Mismo orden y mismas condiciones que el botón.
    const primeraSinResponder = (respuestas) => lista.flatMap((s) => s.items).find((it) => !respuestas?.[it.id]);
    const campoDe = (c) => {
        if (c.tipo !== 'checklist') return c.key;
        const it = primeraSinResponder(datos[c.key]);
        return it ? `resp-${it.id}` : c.key;
    };
    const queFalta = (() => {
        if (falta.length > 0) {
            const primero = eligeSala && !salaId ? 'sala'
                : campoDe(campos.find((c) => faltantes(tipo, datos, [c]).length > 0));
            return { texto: `Falta: ${falta.join(', ')}.`, campo: primero };
        }
        if (puntaje && puntaje.sinResponder > 0) {
            const it = primeraSinResponder(datos.respuestas);
            return {
                texto: `Faltan ${puntaje.sinResponder} por responder.`,
                campo: it ? `resp-${it.id}` : null,
            };
        }
        return null;
    })();

    const guardar = async () => {
        setGuardando(true);
        setError(null);
        const limpio = datosParaGuardar(tipo, datos);
        let r;
        if (cerrando) r = await cerrarRegistroDeCumplimiento(registro.id, limpio);
        else if (aTodas) r = await avisarRetiroATodas(fecha, limpio);
        else r = await guardarRegistroDeCumplimiento({ id: registro?.id, branchId: salaId, tipo, fecha, datos: limpio });
        setGuardando(false);
        if (r.error) { setError(mensajeDeCumplimiento(r.error)); return; }
        clearDraft(claveBorrador);
        showToast(cerrando ? 'Registro cerrado' : 'Registro guardado',
            aTodas ? `Llegó a ${r.salas} salas` : nombreSala, 'success');
        onHecho?.();
    };

    const campo = (c) => {
        const v = datos[c.key];
        const etiqueta = `${c.label}${c.requerido ? '' : ' (opcional)'}`;
        switch (c.tipo) {
            case 'fijo':
                return null;
            case 'area':
                return <PortalTextarea key={c.key} name={c.key} label={etiqueta} value={v || ''} rows={3} maxLength={1500}
                    helperText={c.ayuda} onChange={(e) => poner(c.key, e.target.value)} />;
            case 'lista':
                return <PortalTextarea key={c.key} name={c.key} label={etiqueta} rows={5} maxLength={4000} helperText={c.ayuda}
                    value={(v || []).join('\n')}
                    onChange={(e) => poner(c.key, e.target.value.split('\n').map((x) => x.trimStart()).filter((x, i, a) => x || i < a.length - 1))} />;
            case 'fecha':
                return (
                    <div key={c.key} data-campo={c.key}>
                        <p className="text-caption font-bold text-content-3 mb-1">{etiqueta}</p>
                        <LiquidDatePicker value={v || ''} onChange={(x) => poner(c.key, x)} max={hoySV()} />
                        {c.ayuda && <p className="text-caption text-content-3 mt-1">{c.ayuda}</p>}
                    </div>
                );
            case 'opciones':
                return (
                    <div key={c.key} data-campo={c.key}>
                        <p className="text-caption font-bold text-content-3 mb-1">{etiqueta}</p>
                        <LiquidSelect value={v || ''} onChange={(x) => poner(c.key, x || '')} options={c.opciones}
                            placeholder={c.label} clearable={false} />
                    </div>
                );
            case 'semestre':
                return (
                    <div key={c.key} data-campo={c.key}>
                        <p className="text-caption font-bold text-content-3 mb-1">{etiqueta}</p>
                        <LiquidSelect value={v || ''} onChange={(x) => poner(c.key, x || '')} clearable={false}
                            placeholder="¿Qué semestre?"
                            options={semestresRecientes(hoySV()).map((s) => ({ value: s, label: nombreDelSemestre(s) }))} />
                    </div>
                );
            case 'personas':
                return (
                    <div key={c.key} data-campo={c.key}>
                        <p className="text-caption font-bold text-content-3 mb-2">{etiqueta} · {(v || []).length}</p>
                        <div className="flex flex-wrap gap-2 max-h-56 overflow-y-auto">
                            {personal.map((p) => {
                                const activo = (v || []).some((x) => x.id === p.value);
                                return (
                                    <button key={p.value} type="button" aria-pressed={activo}
                                        onClick={() => poner(c.key, activo
                                            ? (v || []).filter((x) => x.id !== p.value)
                                            : [...(v || []), { id: p.value, nombre: p.label }])}
                                        className={`px-3 min-h-[var(--tap-min)] rounded-full border text-body-sm font-bold active:scale-[0.97] transition-colors ${activo
                                            ? 'bg-brand text-white border-brand'
                                            : 'bg-surface-card text-content-2 border-border-card hover:bg-surface-card-hover'}`}>
                                        {p.label}
                                    </button>
                                );
                            })}
                            {personal.length === 0 && <p className="text-caption text-content-3">No hay personal activo en esta sala.</p>}
                        </div>
                    </div>
                );
            case 'checklist':
                return (
                    <div key={c.key} data-campo={c.key} className="space-y-4">
                        {lista.map((s) => (
                            <div key={s.seccion}>
                                <p className="text-body-sm font-bold text-content mb-2">{s.seccion}</p>
                                <ul className="space-y-2">
                                    {s.items.map((it) => (
                                        <li key={it.id} data-campo={`resp-${it.id}`} className="flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
                                            <span className="text-body-sm text-content-2 flex-1">
                                                {it.texto}
                                                {it.peso === 'C' && <Badge variant="danger" uppercase={false} className="ml-2">Crítico</Badge>}
                                            </span>
                                            <div className="flex gap-1 shrink-0" role="radiogroup" aria-label={it.texto}>
                                                {RESPUESTAS.map((r) => {
                                                    const activo = v?.[it.id] === r.value;
                                                    return (
                                                        <button key={r.value} type="button" role="radio" aria-checked={activo}
                                                            onClick={() => poner(c.key, { ...(v || {}), [it.id]: r.value })}
                                                            className={`px-3 min-h-[var(--tap-min)] rounded-full border text-caption font-bold active:scale-[0.97] transition-colors ${activo
                                                                ? (r.value === 'no' ? 'bg-danger-solid text-white border-danger-solid' : r.value === 'si' ? 'bg-success-solid text-white border-success-solid' : 'bg-surface-tab-track text-content border-border-input')
                                                                : 'bg-surface-card text-content-2 border-border-card hover:bg-surface-card-hover'}`}>
                                                            {r.label}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                );
            case 'numero':
                return <PortalInput key={c.key} name={c.key} label={c.label} type="number" required={c.requerido} helperText={c.ayuda}
                    value={v ?? ''} onChange={(e) => poner(c.key, e.target.value === '' ? '' : Number(e.target.value))} />;
            default:
                return <PortalInput key={c.key} name={c.key} label={c.label} required={c.requerido} helperText={c.ayuda}
                    value={v || ''} onChange={(e) => poner(c.key, e.target.value)} />;
        }
    };

    const titulo = cerrando
        ? (tipo === 'farmacovigilancia' ? 'Anotar la notificación' : `Cerrar ${def.corto.toLowerCase()}`)
        : registro ? `Corregir ${def.corto.toLowerCase()}` : def.titulo;

    return (
        <LiquidModal open onClose={guardando ? undefined : onClose} maxWidth={lista.length ? 'max-w-2xl' : 'max-w-lg'} ariaLabel={titulo}>
            <LiquidModal.Header titulo={titulo} subtitulo={aTodas ? 'Para todas las salas y la bodega' : nombreSala || undefined}
                onClose={guardando ? undefined : onClose} />
            <LiquidModal.Body className="space-y-4">
                {eligeSala && (
                    <div data-campo="sala">
                        <p className="text-caption font-bold text-content-3 mb-1">Sala</p>
                        <LiquidSelect value={salaId} onChange={(x) => setSalaId(x ? String(x) : '')} options={opcionesSala}
                            placeholder="¿De qué sala?" clearable={false} />
                    </div>
                )}
                {/* La fecha nace con hoy: no es el campo por donde se empieza. Sin
                    `data-sin-foco-inicial`, el foco al abrir caía en ella y el
                    calendario se desplegaba encima del formulario. */}
                {!cerrando && (
                    <div data-sin-foco-inicial>
                        <p className="text-caption font-bold text-content-3 mb-1">{tipo === 'destruccion' ? 'Fecha prevista de la destrucción' : 'Fecha'}</p>
                        <LiquidDatePicker value={fecha} onChange={setFecha} max={tipo === 'destruccion' ? undefined : hoySV()} />
                    </div>
                )}
                {campos.map(campo)}
                {puntaje && (
                    <Notice variant={puntaje.aprueba ? 'success' : 'warning'}>
                        {puntaje.si} de {puntaje.total - puntaje.na} cumplen ({puntaje.porcentaje} %).
                        {puntaje.fallas.C > 0 && ` ${puntaje.fallas.C} crítico${puntaje.fallas.C === 1 ? '' : 's'} sin cumplir: no aprueba.`}
                        {puntaje.sinResponder > 0 && ` Faltan ${puntaje.sinResponder} por responder.`}
                    </Notice>
                )}
                {error && <Notice variant="danger">{error}</Notice>}
            </LiquidModal.Body>
            <PieDeModal izquierda={queFalta && !guardando
                ? <AvisoDeFalta motivo={queFalta.texto} onIr={queFalta.campo ? () => irAlCampo(queFalta.campo) : null} />
                : null}>
                <Button variant="ghost" onClick={onClose} disabled={guardando}>Cancelar</Button>
                <Button variant="primary" loading={guardando}
                    disabled={Boolean(queFalta)} onClick={guardar}>
                    {cerrando ? 'Guardar y cerrar' : 'Guardar'}
                </Button>
            </PieDeModal>
        </LiquidModal>
    );
}
