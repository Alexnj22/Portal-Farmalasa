import React, { useMemo } from 'react';
import { Plus, Sparkles, Thermometer, Trash2 } from 'lucide-react';
import Button from '../common/Button';
import LiquidSelect from '../common/LiquidSelect';
import PortalInput from '../common/PortalInput';
import { nuevaClave } from '../../data/bitacoras';

// ═══════════════════════════════════════════════════════════════════════════
// Los horarios de un área — las franjas de temperatura y los turnos de limpieza.
//
// ── Por qué los edita el jefe de la sala ───────────────────────────────────
// Pedido del usuario: «permite modificar los horarios por sucursal, para
// limpieza y servicios sanitarios (que lo puedan modificar los jefes)». A qué
// hora se barre no lo dice ninguna norma: lo dice el local. Lo que sí exige el
// RTS (6.2.16) son DOS lecturas de temperatura al día, una a media mañana y
// otra a media tarde — por eso el editor avisa cuando queda menos de dos, en
// vez de impedirlo: quien configura puede tener un motivo, pero no puede no
// enterarse.
//
// ── Una hora es UN control, no tres ────────────────────────────────────────
// La primera versión usaba `TimePicker12` (hora + minutos + AM/PM = tres
// selectores por punta, seis por renglón). Medido en iPhone 13: cinco horarios
// ocupaban más de tres pantallas de alto y había que rodar para ver el botón de
// guardar. Un horario de bitácora cae siempre en una media hora redonda, así
// que la lista de medias horas es UN selector — y el renglón entero pasó de
// seis controles a tres.
//
// ── La CLAVE no se toca, y por eso no está en pantalla ─────────────────────
// `bitacora_lecturas.franja` guarda la clave, no el rótulo. Renombrar «Mañana»
// a «Apertura» tiene que seguir mostrando las lecturas de esa franja, así que
// el rótulo se edita libremente y la clave viaja escondida. Es
// [[feedback_un_rotulo_no_es_una_clave]] aplicado a un horario: acá el rótulo
// NO es el dato.
// ═══════════════════════════════════════════════════════════════════════════

const hhmm = (t) => String(t || '').slice(0, 5);

/** «07:30» → «7:30 AM». La sala lee la hora en 12 horas, como el reloj. */
function rotularHora(hm) {
    const [h, m] = String(hm || '').split(':').map(Number);
    if (Number.isNaN(h)) return '';
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m || 0).padStart(2, '0')} ${ampm}`;
}

// De 05:00 a 22:30, cada media hora: cubre desde antes de que abra la primera
// sala hasta después de que cierre la última, sin ofrecer la madrugada.
const HORAS = [];
for (let h = 5; h <= 22; h += 1) {
    HORAS.push(`${String(h).padStart(2, '0')}:00`);
    HORAS.push(`${String(h).padStart(2, '0')}:30`);
}

function SelectorDeHora({ value, onChange, etiqueta }) {
    // Si el valor guardado no cae en una media hora (por ejemplo 07:15, puesto
    // antes de que existiera este editor), se agrega a la lista: la alternativa
    // es que el selector muestre vacío y el primer guardado le cambie la hora a
    // la sala sin que nadie lo haya pedido.
    const opciones = useMemo(() => {
        const v = hhmm(value);
        const base = HORAS.includes(v) || !v ? HORAS : [...HORAS, v].sort();
        return base.map(h => ({ value: h, label: rotularHora(h) }));
    }, [value]);

    return (
        <label className="flex items-center gap-2 min-w-0">
            <span className="text-label text-content-3 shrink-0 w-10">{etiqueta}</span>
            {/* `clearable={false}`: un horario no puede quedar sin hora, y el
                botón de limpiar aparecía como una × roja al lado de cada uno —
                se lee como «quitar», que es lo que hace el otro botón del
                renglón. `nano` centra el texto y saca el ícono de la izquierda:
                acá la etiqueta ya dice qué es. */}
            <LiquidSelect value={hhmm(value)} onChange={onChange} options={opciones}
                nano clearable={false} ariaLabel={`Hora ${etiqueta}`}
                className="min-w-0 flex-1" />
        </label>
    );
}

function Renglon({ fila, onCambio, onQuitar, sinNombre }) {
    return (
        <div data-surface="card" className="p-2.5 space-y-2">
            <div className="flex items-center gap-2">
                <PortalInput
                    className="flex-1 min-w-0"
                    name={`rotulo-${fila.clave}`} compact
                    aria-label="Cómo se llama este horario"
                    value={fila.label || ''} onChange={(e) => onCambio({ label: e.target.value })}
                    placeholder={sinNombre}
                />
                <Button variant="ghost" size="sm" iconOnly icon={Trash2}
                    title="Quitar este horario" onClick={onQuitar} />
            </div>
            <div className="grid grid-cols-2 gap-2">
                <SelectorDeHora etiqueta="desde" value={fila.desde}
                    onChange={(v) => onCambio({ desde: v })} />
                <SelectorDeHora etiqueta="hasta" value={fila.hasta}
                    onChange={(v) => onCambio({ hasta: v })} />
            </div>
        </div>
    );
}

/**
 * @param {'franjas'|'limpiezas'} tipo  qué lista se edita
 * @param {Array} filas                 la lista actual
 * @param {Function} onCambiar          recibe la lista nueva
 */
export default function EditorDeHorarios({ tipo, filas, onCambiar }) {
    const esLectura = tipo === 'franjas';
    const lista = filas || [];

    const cambiar = (i, parche) =>
        onCambiar(lista.map((f, j) => (j === i ? { ...f, ...parche } : f)));

    const quitar = (i) => onCambiar(lista.filter((_, j) => j !== i));

    const agregar = () => onCambiar([...lista, {
        clave: nuevaClave(lista, esLectura ? 'f' : 't'),
        label: esLectura ? 'Nueva lectura' : 'Nueva limpieza',
        desde: '12:00',
        hasta: esLectura ? '14:00' : '15:00',
    }]);

    return (
        <div className="space-y-2">
            <p className="text-label font-black uppercase tracking-widest text-content-3 flex items-center gap-1.5">
                {esLectura ? <Thermometer size={12} /> : <Sparkles size={12} />}
                {esLectura ? 'Lecturas de temperatura' : 'Limpieza'}
            </p>

            {lista.map((f, i) => (
                <Renglon key={f.clave} fila={f}
                    sinNombre={esLectura ? 'Mañana' : 'Apertura'}
                    onCambio={(p) => cambiar(i, p)}
                    onQuitar={() => quitar(i)} />
            ))}

            {lista.length === 0 && (
                <p className="text-label text-content-3">
                    {esLectura
                        ? 'Sin lecturas: a esta área no se le pide temperatura.'
                        : 'Sin limpieza: a esta área no se le pide registro de limpieza.'}
                </p>
            )}

            {/* El reglamento pide DOS lecturas al día, una a media mañana y otra
                a media tarde (RTS 6.2.16); el refrigerador, también dos (6.2.20).
                Se avisa, no se impide: quien configura puede estar armando el
                área todavía, y un freno acá lo dejaría sin poder guardar. */}
            {esLectura && lista.length > 0 && lista.length < 2 && (
                <p className="text-label text-warning-text font-bold">
                    El reglamento pide al menos dos lecturas al día: una a media mañana y otra a
                    media tarde.
                </p>
            )}

            <Button variant="ghost" size="sm" icon={Plus} onClick={agregar}>
                Agregar horario
            </Button>
        </div>
    );
}
