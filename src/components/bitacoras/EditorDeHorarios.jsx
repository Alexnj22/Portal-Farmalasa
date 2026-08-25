import React, { useMemo } from 'react';
import { Sparkles, Thermometer } from 'lucide-react';
import LiquidSelect from '../common/LiquidSelect';

// ═══════════════════════════════════════════════════════════════════════════
// Los horarios de un área — cuándo se toma la temperatura y cuándo se limpia.
//
// ── Lo único que se cambia es la HORA (2026-08-25) ─────────────────────────
// Pedido del usuario: «los nombres son fijos, no se pueden eliminar ni
// agregar». Y es correcto: Mañana, Mediodía y Tarde no son una preferencia de
// cada sala, son los momentos del día que nombra el reglamento (RTS 6.2.16:
// «al menos dos veces al día, una a mediados de la mañana y otra a mediados de
// la tarde»). Apertura y Cierre, lo mismo para la limpieza.
//
// Dejarlos editables invitaba a que cada sucursal los llamara distinto —y el
// mes impreso de siete salas saldría con siete juegos de encabezados— y a que
// alguien borrara una lectura obligatoria sin saber que lo era. Lo que SÍ
// cambia por local es el reloj: a qué hora abre, cuándo se barre.
//
// ── Por qué el rótulo se sigue guardando ───────────────────────────────────
// `bitacora_lecturas.franja` guarda la CLAVE, no el rótulo; el rótulo viaja en
// la configuración para que el mes impreso lo imprima. Que ahora no se edite no
// cambia el modelo: cambia quién lo decide.
//
// ── Una hora es UN control, no tres ────────────────────────────────────────
// La primera versión usaba `TimePicker12` (hora + minutos + AM/PM = seis
// selectores por renglón). Medido en iPhone 13: cinco horarios ocupaban más de
// tres pantallas de alto. Un horario de bitácora cae siempre en una media hora
// redonda, así que la lista de medias horas es un selector solo.
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

function SelectorDeHora({ value, onChange, etiqueta, nombre }) {
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
        <label className="flex items-center gap-1.5 min-w-0">
            <span className="text-label text-content-3 shrink-0">{etiqueta}</span>
            {/* `clearable={false}`: un horario no puede quedar sin hora. `nano`
                centra el texto y saca el ícono: la etiqueta ya dice qué es. */}
            <LiquidSelect value={hhmm(value)} onChange={onChange} options={opciones}
                nano clearable={false} ariaLabel={`${nombre}: hora ${etiqueta}`}
                className="min-w-0 flex-1 sm:w-[118px] sm:flex-none" />
        </label>
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
    if (!lista.length) return null;

    const cambiar = (i, parche) =>
        onCambiar(lista.map((f, j) => (j === i ? { ...f, ...parche } : f)));

    return (
        <div className="space-y-2">
            <p className="text-label font-black uppercase tracking-widest text-content-3 flex items-center gap-1.5">
                {esLectura ? <Thermometer size={12} /> : <Sparkles size={12} />}
                {esLectura ? 'Lecturas de temperatura' : 'Limpieza'}
            </p>

            {/* El rótulo es texto, no un campo: es fijo. Y todo en una fila —
                antes el campo para escribir «Mañana» medía 1.800px. */}
            <div className="space-y-1.5">
                {lista.map((f, i) => (
                    <div key={f.clave} data-surface="card"
                        className="p-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
                        <span className="text-body-sm font-bold text-content-1 w-[84px] shrink-0">
                            {f.label}
                        </span>
                        <SelectorDeHora etiqueta="desde" nombre={f.label} value={f.desde}
                            onChange={(v) => cambiar(i, { desde: v })} />
                        <SelectorDeHora etiqueta="hasta" nombre={f.label} value={f.hasta}
                            onChange={(v) => cambiar(i, { hasta: v })} />
                    </div>
                ))}
            </div>
        </div>
    );
}
