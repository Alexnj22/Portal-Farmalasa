import React, { useState, useMemo } from 'react';
import { Undo2, X, Check, Camera } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import Button from '../../components/common/Button';
import PortalInput from '../../components/common/PortalInput';
import { MOTIVOS, MAX_FOTOS, viajaPorMotivo } from '../../data/devoluciones';

// La sala pide devolver a bodega lo que no cuadró.
//
// La pantalla tiene que dejar clarísima UNA cosa, porque es la que decide qué
// hace bodega del otro lado: si el producto viaja o si es sólo un arreglo de
// papeles. Un faltante nunca salió de bodega —está allá— y se corrige en el
// momento; un dañado o un vencido están acá y vuelven en el próximo viaje. Sin
// eso, bodega espera una caja que no viene, o da por recibida una que todavía
// va en el camión.
//
// Y el daño exige foto: es lo único que bodega puede mirar para decidir si
// amerita la devolución o si el producto todavía se puede vender.

const tope = (item, motivo) => {
    const enviado = item?.cantidad_enviada ?? item?.cantidad_asignada ?? 0;
    return motivo === 'faltante'
        ? Math.max(0, Number(enviado) - Number(item?.cantidad_recibida ?? 0))
        : Number(item?.cantidad_recibida ?? 0);
};

// El motivo llega propuesto por lo que la sala ya anotó al contar la caja:
// volver a preguntarlo desde cero sería pedir dos veces el mismo dato.
const motivoSugerido = (item) =>
    (['faltante', 'danado', 'vencido'].includes(item?.error_tipo) ? item.error_tipo : 'faltante');

// Se monta por renglón (el llamador lo renderiza condicionalmente), así que el
// estado inicial se calcula al montar y no hay efecto que lo sincronice: un
// `setState` dentro de un efecto para copiar props es justo lo que el lint del
// repo prohíbe, y con razón — encadena renders para nada.
// `soloEvidencia`: la decisión de la diferencia ya resolvió QUÉ se hace y por
// CUÁNTO —lo dice la salida acordada y lo calcula la base—, así que preguntarlo
// otra vez sería pedir dos veces el mismo dato, y peor: ofrecer una cantidad que
// después se ignora. En ese modo el modal sirve para lo único que falta y que
// nadie más puede aportar: la foto del daño.
export default function DevolverModal({ open, onClose, item, onConfirm, saving, soloEvidencia = false }) {
    const [motivo,   setMotivo]   = useState(() => motivoSugerido(item));
    const [cantidad, setCantidad] = useState(
        () => String(item?.cantidad_problema ?? tope(item, motivoSugerido(item)) ?? ''));
    const [nota,     setNota]     = useState('');
    const [fotos,    setFotos]    = useState([]);
    const [error,    setError]    = useState('');

    const max   = useMemo(() => tope(item, motivo), [item, motivo]);
    const viaja = viajaPorMotivo(motivo);
    const pideFoto = motivo === 'danado';
    const cant = Number(cantidad);

    const puede = (soloEvidencia || (cant > 0 && cant <= max))
        && (!pideFoto || fotos.length > 0) && !saving;

    const cambiarMotivo = (m) => {
        setMotivo(m);
        setCantidad(String(tope(item, m) || ''));
        setError('');
    };

    return (
        <LiquidModal open={open} onClose={onClose} maxWidth="max-w-sm"
            ariaLabel={`Devolver a bodega — ${item?.products?.nombre ?? ''}`}>
            <LiquidModal.Header>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-xl bg-chart-4/10 flex items-center justify-center shrink-0">
                            <Undo2 size={16} className="text-chart-4-text" />
                        </div>
                        <div className="min-w-0">
                            <p className="text-body font-bold text-content">Devolver a bodega</p>
                            <p className="text-label text-content-3 truncate">{item?.products?.nombre ?? '—'}</p>
                        </div>
                    </div>
                    <Button variant="ghost" size="xs" icon={X} iconOnly onClick={onClose} />
                </div>
            </LiquidModal.Header>

            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-5 py-4 space-y-4">
                {/* ── Motivo ── */}
                {!soloEvidencia && (
                <div className="space-y-1.5">
                    <p className="text-micro font-black text-content-2 uppercase tracking-widest px-1">Qué pasó</p>
                    <div className="grid grid-cols-3 gap-1.5">
                        {MOTIVOS.map(m => (
                            <button key={m.value} type="button" onClick={() => cambiarMotivo(m.value)}
                                aria-pressed={motivo === m.value}
                                className={`rounded-xl border px-2 py-2.5 text-label font-bold transition-colors ${
                                    motivo === m.value
                                        ? 'border-chart-4/50 bg-chart-4/10 text-chart-4-text'
                                        : 'border-divider bg-surface-card-hover text-content-3 hover:border-chart-4/30'
                                }`}>
                                {m.label}
                            </button>
                        ))}
                    </div>
                    <p className="text-caption text-content-3 px-1 leading-snug">
                        {MOTIVOS.find(m => m.value === motivo)?.ayuda}
                    </p>
                </div>
                )}

                {/* ── Lo que va a pasar. Es el dato que usa bodega. ── */}
                {!soloEvidencia && (
                <div className={`rounded-xl border px-3 py-2.5 ${
                    viaja ? 'border-warning/30 bg-warning/[0.07]' : 'border-success/30 bg-success/[0.07]'
                }`}>
                    <p className={`text-label font-bold ${viaja ? 'text-warning-text' : 'text-success-text'}`}>
                        {viaja ? 'El producto vuelve a bodega' : 'No viaja nada'}
                    </p>
                    <p className="text-caption text-content-2 leading-snug mt-0.5">
                        {viaja
                            ? 'Sale de la sala ahora y bodega lo confirma cuando lo tenga en la mano.'
                            : 'Quedó en bodega desde el principio: se corrige y bodega lo confirma en el momento.'}
                    </p>
                </div>
                )}

                {/* ── Cantidad ── */}
                {!soloEvidencia && (
                <div className="space-y-1">
                    <PortalInput
                        label="Cuántas" type="number" alto tono="chart-4"
                        value={cantidad}
                        onChange={e => { setCantidad(e.target.value); setError(''); }}
                        placeholder="0"
                        hasError={cant > max || (cantidad !== '' && cant <= 0)}
                    />
                    <p className="text-caption text-content-3 px-1">
                        {motivo === 'faltante'
                            ? `Faltaron ${max} de las ${item?.cantidad_enviada ?? item?.cantidad_asignada ?? 0} que salieron.`
                            : `Llegaron ${max}; se puede devolver hasta esa cantidad.`}
                    </p>
                </div>
                )}

                {/* ── Foto ── */}
                {(viaja || soloEvidencia) && (
                    <div className="flex flex-col gap-2">
                        <div className="flex items-baseline gap-2 px-1">
                            <p className="text-micro font-black text-content-2 uppercase tracking-widest">
                                {pideFoto ? 'Foto del daño' : 'Foto (opcional)'}
                            </p>
                            <span className="text-micro text-content-3 font-semibold">{fotos.length} de {MAX_FOTOS}</span>
                        </div>

                        <div className="flex items-center gap-2 flex-wrap">
                            {fotos.map((f, i) => (
                                <div key={`${f.name}-${i}`} className="relative w-20 h-20 rounded-xl overflow-hidden border border-border-card bg-surface-card-hover">
                                    <img src={URL.createObjectURL(f)} alt={`Foto ${i + 1}`}
                                        className="w-full h-full object-cover"
                                        onLoad={ev => URL.revokeObjectURL(ev.currentTarget.src)} />
                                    <button type="button" aria-label={`Quitar la foto ${i + 1}`}
                                        onClick={() => setFotos(prev => prev.filter((_, j) => j !== i))}
                                        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-surface-card border border-divider shadow-sm flex items-center justify-center hover:bg-danger/10 transition-colors">
                                        <X size={12} strokeWidth={3} className="text-content-2" />
                                    </button>
                                </div>
                            ))}
                            {fotos.length < MAX_FOTOS && (
                                <label className={`w-20 h-20 rounded-xl border border-dashed flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors ${
                                    pideFoto && fotos.length === 0
                                        ? 'border-warning/50 bg-warning/[0.06] hover:border-warning'
                                        : 'border-border-card bg-surface-card-hover hover:border-brand/40'
                                }`}>
                                    {/* `capture="environment"`: en el teléfono abre la cámara
                                        de atrás directo, que es donde está el producto. En
                                        escritorio el atributo se ignora. */}
                                    <input type="file" accept="image/jpeg,image/png,image/webp"
                                        capture="environment" className="sr-only"
                                        onChange={(ev) => {
                                            const f = ev.target.files?.[0];
                                            ev.target.value = '';   // permite volver a elegir la misma
                                            if (!f) return;
                                            if (f.size > 10 * 1024 * 1024) { setError('La foto no puede pasar de 10 MB'); return; }
                                            setError('');
                                            setFotos(prev => [...prev, f].slice(0, MAX_FOTOS));
                                        }} />
                                    <Camera size={20} strokeWidth={2}
                                        className={pideFoto && fotos.length === 0 ? 'text-warning-text' : 'text-content-3'} />
                                    <span className={`text-micro font-bold ${pideFoto && fotos.length === 0 ? 'text-warning-text' : 'text-content-3'}`}>
                                        {fotos.length === 0 ? 'Agregar' : 'Otra'}
                                    </span>
                                </label>
                            )}
                        </div>

                        {pideFoto && fotos.length === 0 && (
                            <p className="text-micro text-warning-text font-semibold px-1 leading-snug">
                                Falta la foto: es lo que bodega mira para decidir si el daño amerita la
                                devolución o si el producto todavía se puede vender.
                            </p>
                        )}
                    </div>
                )}

                <PortalInput
                    label="Nota" tono="chart-4" value={nota}
                    onChange={e => setNota(e.target.value)}
                    placeholder="Lo que bodega tendría que saber…"
                />

                {error && <p className="text-label text-danger-text font-medium px-1">{error}</p>}
            </div>

            <LiquidModal.Footer>
                <div className="flex gap-2">
                    <Button variant="secondary" onClick={onClose}>Cancelar</Button>
                    <Button tone="chart-4" icon={Check} disabled={!puede}
                        onClick={() => onConfirm({ motivo, cantidad: cant, nota, fotos })}>
                        {saving ? 'Enviando…' : 'Pedir devolución'}
                    </Button>
                </div>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
