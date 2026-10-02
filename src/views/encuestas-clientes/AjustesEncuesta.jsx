import React, { useMemo } from 'react';
import { Store, Target, CalendarRange, Gift, MessageSquare, Lightbulb } from 'lucide-react';
import Checkbox from '../../components/common/Checkbox';
import SegmentedControl from '../../components/common/SegmentedControl';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import Notice from '../../components/common/Notice';
import Button from '../../components/common/Button';
import { formatQty } from '@nucleo/utils/formatNumber';
import { CANALES, INCENTIVOS, muestraSugerida, metaTotal } from '@nucleo/utils/encuestasClientes';

/**
 * Cómo, dónde y hasta cuándo se aplica la encuesta, y qué recibe el cliente.
 *
 * Como el constructor, no guarda: entrega los cambios y la vista los guarda
 * sola. Las sucursales van aparte (`onSucursales`) porque viven en su propia
 * tabla, con el token del QR de cada una.
 */
export default function AjustesEncuesta({ encuesta, sucursales, salas, poblacion, soloLectura, onChange, onSucursales }) {
    const elegidas = useMemo(() => new Map(sucursales.map((s) => [s.branch_id, s])), [sucursales]);
    const porSala = encuesta.alcance === 'sucursales';
    const ticketsElegidas = sucursales.reduce((a, s) => a + (poblacion[s.branch_id] || 0), 0);
    const sugeridaTotal = muestraSugerida(ticketsElegidas);
    const meta = metaTotal(encuesta, sucursales);
    // La muestra la entrega quien entrevista: la tablet corre sin sesión y no hay quién firme la entrega.
    const conEntrevista = encuesta.canales.includes('entrevista');

    const set = (k) => (v) => onChange({ [k]: v });
    const num = (v) => (v === '' || v == null ? null : Math.max(1, parseInt(String(v).replace(/\D/g, ''), 10) || 0) || null);

    const alternarCanal = (c, on) => onChange({
        canales: on ? [...new Set([...encuesta.canales, c])] : encuesta.canales.filter((x) => x !== c),
    });
    const alternarSala = (id, on) => onSucursales(on
        ? [...sucursales, { branch_id: id, meta: null }]
        : sucursales.filter((s) => s.branch_id !== id));
    const metaDeSala = (id, v) => onSucursales(sucursales.map((s) => (s.branch_id === id ? { ...s, meta: num(v) } : s)));
    const usarSugeridas = () => onSucursales(sucursales.map((s) => ({ ...s, meta: muestraSugerida(poblacion[s.branch_id] || 0) })));

    return (
        <div className="space-y-5">
            <Bloque titulo="La encuesta">
                <PortalInput label="Nombre" name="nombre" value={encuesta.nombre} readOnly={soloLectura}
                    onChange={(e) => set('nombre')(e.target.value)} placeholder="Ej. Satisfacción en sala — octubre" />
                <PortalTextarea label="Qué queremos saber" name="objetivo" rows={2} value={encuesta.objetivo || ''}
                    readOnly={soloLectura} onChange={(e) => set('objetivo')(e.target.value)}
                    placeholder="El objetivo, para quien aprueba y para leer los resultados después" />
            </Bloque>

            {!encuesta.es_plantilla && (
                <>
                    <Bloque titulo="Cómo se aplica" icono={MessageSquare}>
                        <div className="grid sm:grid-cols-3 gap-2">
                            {CANALES.map((c) => (
                                <Checkbox key={c.value} name={`canal-${c.value}`} label={c.label} description={c.ayuda}
                                    checked={encuesta.canales.includes(c.value)} disabled={soloLectura}
                                    onChange={soloLectura ? undefined : (on) => alternarCanal(c.value, on)} />
                            ))}
                        </div>
                    </Bloque>

                    <Bloque titulo="Dónde y cuántas respuestas" icono={Store}>
                        <SegmentedControl value={encuesta.alcance} disabled={soloLectura} label="Alcance"
                            options={[{ value: 'general', label: 'Meta general' }, { value: 'sucursales', label: 'Meta por sucursal' }]}
                            onChange={set('alcance')} />
                        <p className="text-micro text-content-3">
                            {porSala
                                ? 'Cada sucursal tiene su cuota: la encuesta termina cuando todas la cumplen.'
                                : 'Se reparte en las sucursales elegidas y cuenta el total.'}
                        </p>
                        <div className="divide-y divide-border-card rounded-xl border border-border-card">
                            {salas.map((s) => {
                                const fila = elegidas.get(s.id);
                                const tickets = poblacion[s.id] || 0;
                                return (
                                    <div key={s.id} className="flex items-center gap-3 px-3 py-2">
                                        <div className="flex-1 min-w-0">
                                            <Checkbox name={`sala-${s.id}`} label={s.name} checked={!!fila} disabled={soloLectura}
                                                description={tickets ? `${formatQty(tickets)} atenciones en 30 días · muestra sugerida ${muestraSugerida(tickets)}` : undefined}
                                                onChange={soloLectura ? undefined : (on) => alternarSala(s.id, on)} />
                                        </div>
                                        {porSala && fila && (
                                            <div className="w-28 shrink-0">
                                                <PortalInput name={`meta-${s.id}`} inputMode="numeric" maskType="INTEGER" placeholder="Meta"
                                                    value={fila.meta ?? ''} readOnly={soloLectura}
                                                    onChange={(e) => metaDeSala(s.id, e.target.value)} />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                        {!soloLectura && sucursales.length > 0 && (
                            <div className="flex flex-wrap items-center gap-2">
                                <Lightbulb size={14} className="text-content-3" />
                                <span className="text-body-sm text-content-2">
                                    Para un margen de ±5% con 95% de confianza:{' '}
                                    <strong>{porSala
                                        ? `${sucursales.reduce((a, s) => a + (muestraSugerida(poblacion[s.branch_id] || 0) || 0), 0)} en total (cada sucursal por separado)`
                                        : `${sugeridaTotal ?? '—'} respuestas`}</strong>
                                </span>
                                {porSala ? (
                                    <Button variant="ghost" size="sm" onClick={usarSugeridas}>Usar las sugeridas</Button>
                                ) : sugeridaTotal ? (
                                    <Button variant="ghost" size="sm" onClick={() => set('meta_total')(sugeridaTotal)}>Usar {sugeridaTotal}</Button>
                                ) : null}
                            </div>
                        )}
                        {!porSala && (
                            <div className="max-w-xs">
                                <PortalInput label="Meta de respuestas" name="meta_total" inputMode="numeric" maskType="INTEGER"
                                    value={encuesta.meta_total ?? ''} readOnly={soloLectura} placeholder="Sin meta"
                                    onChange={(e) => set('meta_total')(num(e.target.value))} />
                            </div>
                        )}
                    </Bloque>

                    <Bloque titulo="Cuándo" icono={CalendarRange}>
                        <div className="grid sm:grid-cols-2 gap-3">
                            <div>
                                <span className="block text-label font-semibold text-content-2 mb-1">Desde</span>
                                {soloLectura ? <p className="text-body-sm text-content">{encuesta.fecha_inicio || 'Al publicarla'}</p>
                                    : <LiquidDatePicker value={encuesta.fecha_inicio || ''} onChange={(v) => set('fecha_inicio')(v || null)} />}
                            </div>
                            <div>
                                <span className="block text-label font-semibold text-content-2 mb-1">Hasta</span>
                                {soloLectura ? <p className="text-body-sm text-content">{encuesta.fecha_fin || 'Sin fecha'}</p>
                                    : <LiquidDatePicker value={encuesta.fecha_fin || ''} onChange={(v) => set('fecha_fin')(v || null)} />}
                            </div>
                        </div>
                        <p className="text-micro text-content-3 flex items-center gap-1">
                            <Target size={12} />
                            Se cierra con lo primero que pase: la fecha{meta ? ` o las ${meta} respuestas` : ''}.
                            Sin fecha de inicio, empieza el día que se publica.
                        </p>
                    </Bloque>

                    <Bloque titulo="Qué recibe el cliente" icono={Gift}>
                        <SegmentedControl value={encuesta.incentivo_tipo} disabled={soloLectura} label="Incentivo"
                            options={INCENTIVOS.map((i) => ({ value: i.value, label: i.label }))}
                            onChange={set('incentivo_tipo')} />
                        {encuesta.incentivo_tipo !== 'ninguno' && (
                            <Notice variant="info" compact>
                                Sólo lo recibe quien deja su teléfono y acepta el consentimiento, y una sola vez por encuesta.
                                {encuesta.incentivo_tipo === 'puntos' && ' Los puntos se acreditan solos en su cuenta.'}
                                {encuesta.incentivo_tipo === 'muestra' && ' La entrega quien entrevista, y la marca como entregada en el portal.'}
                            </Notice>
                        )}
                        {encuesta.incentivo_tipo === 'muestra' && !conEntrevista && (
                            <Notice variant="warning" compact>
                                La muestra médica sólo se entrega en entrevista. Marca ese canal.
                            </Notice>
                        )}
                        {encuesta.incentivo_tipo === 'puntos' && (
                            <div className="max-w-xs">
                                <PortalInput label="Puntos por responder" name="incentivo_puntos" inputMode="numeric" maskType="INTEGER"
                                    value={encuesta.incentivo_puntos ?? ''} readOnly={soloLectura}
                                    onChange={(e) => set('incentivo_puntos')(num(e.target.value))} />
                            </div>
                        )}
                        {encuesta.incentivo_tipo !== 'ninguno' && (
                            <PortalInput label={encuesta.incentivo_tipo === 'muestra' ? 'Qué muestra se entrega' : 'Cómo se le explica (opcional)'}
                                name="incentivo_descripcion" value={encuesta.incentivo_descripcion || ''} readOnly={soloLectura}
                                placeholder={encuesta.incentivo_tipo === 'muestra' ? 'Ej. Sobre de suero oral' : 'Ej. Gana 50 puntos por tu opinión'}
                                onChange={(e) => set('incentivo_descripcion')(e.target.value)} />
                        )}
                    </Bloque>
                </>
            )}

            <Bloque titulo="Lo que ve el cliente" icono={MessageSquare}>
                <PortalTextarea label="Bienvenida (opcional)" name="mensaje_bienvenida" rows={2} value={encuesta.mensaje_bienvenida || ''}
                    readOnly={soloLectura} onChange={(e) => set('mensaje_bienvenida')(e.target.value)}
                    placeholder="Ej. Tu opinión nos ayuda a atenderte mejor. Son 2 minutos." />
                <PortalTextarea label="Al terminar" name="mensaje_cierre" rows={2} value={encuesta.mensaje_cierre || ''}
                    readOnly={soloLectura} onChange={(e) => set('mensaje_cierre')(e.target.value)}
                    placeholder="¡Gracias por tu opinión!" />
                {!encuesta.es_plantilla && (
                    <PortalTextarea label="Consentimiento para guardar sus datos" name="texto_consentimiento" rows={3}
                        value={encuesta.texto_consentimiento || ''} readOnly={soloLectura}
                        onChange={(e) => set('texto_consentimiento')(e.target.value)}
                        helperText="Se muestra sólo si el cliente quiere dejar su ficha o teléfono. Sin aceptarlo, la respuesta queda anónima." />
                )}
            </Bloque>
        </div>
    );
}

function Bloque({ titulo, icono: Icono, children }) {
    return (
        <section data-surface="card" className="p-4 space-y-3">
            <h3 className="text-label uppercase tracking-wide font-semibold text-content-2 flex items-center gap-1.5">
                {Icono && <Icono size={13} />} {titulo}
            </h3>
            {children}
        </section>
    );
}
