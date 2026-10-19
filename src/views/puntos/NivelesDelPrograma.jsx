/**
 * Puntos → Niveles (2026-10-19, decisión del dueño en la auditoría de niveles).
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 * Todo lo que el programa promete por nivel vivía escrito en tres lugares que
 * no se hablaban: la tabla `puntos_niveles` (cambiable sólo con SQL), el código
 * de las funciones de Supabase (Platino = 2 días de anticipo) y la app (la
 * tabla de premios del raspable de prueba, que ya no coincidía con la base).
 * Esta pestaña es el único lugar donde se cambia, sin migración, y cada cambio
 * queda con quién, cuándo, antes y después (`puntos_config_historial`).
 *
 *   · Estado        — los dos interruptores (niveles, beneficios del mayorista)
 *                      con confirmación, y el tope del raspable del mes.
 *   · Cada nivel    — umbral, puntos por dólar, cumpleaños, horas para retirar
 *                      una reserva, días de anticipo de ofertas; y en los dos
 *                      niveles más altos, los premios del raspable.
 *   · Mayoreo       — cumpleaños por rango y el raspable de los dos rangos más
 *                      altos (Condiciones del Cliente Mayorista §5).
 *   · Historial     — los últimos 100 cambios.
 *
 * ── Lo que NO hace ──────────────────────────────────────────────────────────
 * No ofrece premios en DESCUENTO: el motor sólo sabe dar puntos (el raspable es
 * un lote de puntos que vence a fin de mes) y la caja no cobraría un
 * porcentaje. Ofrecerlo sería prometer algo que nadie da.
 *
 * La base valida todo de nuevo (la escalera, los rangos de cada número, que los
 * premios sean sólo puntos y probabilidad) y exige `puntos_tab_niveles` para
 * escribir: lo de acá sólo evita viajes que van a volver con error.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Crown, Gem, History, Plus, Save, Trash2, Ticket, Power } from 'lucide-react';
import Button from '../../components/common/Button';
import PortalInput from '../../components/common/PortalInput';
import Switch from '../../components/common/Switch';
import ConfirmModal from '../../components/common/ConfirmModal';
import Notice from '../../components/common/Notice';
import Badge from '../../components/common/Badge';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { formatMoney, formatQty } from '@nucleo/utils/formatNumber';
import { fechaHora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { saveDraft, loadDraft, clearDraft } from '@nucleo/utils/draftUtils';
import {
    fetchPanelDeNiveles, guardarNivelDePuntos, guardarRangoMayoreoDePuntos, guardarConfigDePuntos,
} from '@nucleo/data/puntos';

// 100 puntos = US$1.00 (cláusula 4 del reglamento).
const dolares = (puntos) => formatMoney((Number(puntos) || 0) / 100);
const pts = (n) => formatQty(Number(n) || 0);
const num = (v) => (v === '' || v == null ? null : Number(v));

// Los campos que se editan de un nivel, con su rótulo. El orden es el de la tarjeta.
const CAMPOS_NIVEL = [
    { key: 'nombre', label: 'Nombre', tipo: 'text' },
    { key: 'desde', label: 'Compra en 12 meses desde', prefix: '$', tipo: 'number', ayuda: 'Todas las facturas válidas, no sólo las que dieron puntos.' },
    { key: 'factor', label: 'Puntos por cada $1', tipo: 'number', ayuda: 'De 1 a 5.' },
    { key: 'puntos_cumpleanos', label: 'Puntos de cumpleaños', tipo: 'number' },
    { key: 'horas_reserva', label: 'Horas para retirar una reserva', tipo: 'number', ayuda: 'De 1 a 168. La pagada espera 7 días siempre.' },
    { key: 'dias_anticipo_ofertas', label: 'Días antes para ver las ofertas', tipo: 'number', ayuda: '0 = el mismo día que todos. Máximo 14.' },
];

const ROTULO_CAMPO = {
    ...Object.fromEntries(CAMPOS_NIVEL.map((c) => [c.key, c.label])),
    cupon_mensual: 'Raspable sin tabla (puntos)',
    cupon_premios: 'Premios del raspable',
    cupon_presupuesto_mensual: 'Tope del raspable al mes',
    niveles_activos: 'Niveles encendidos',
    mayoreo_beneficios_activos: 'Beneficios del Cliente Mayorista',
};

/** La tabla de premios en palabras, para el historial. */
const premiosTexto = (lista) => (Array.isArray(lista) && lista.length
    ? lista.map((p) => `${pts(p.puntos)} pts (${p.peso})`).join(' · ') : 'ninguno');

const valorTexto = (key, v) => {
    if (key === 'cupon_premios') return premiosTexto(v);
    if (typeof v === 'boolean') return v ? 'Sí' : 'No';
    if (key === 'cupon_presupuesto_mensual' && v == null) return 'sin tope';
    if (v == null || v === '') return '—';
    if (key === 'desde') return formatMoney(Number(v));
    return String(v);
};

/** Qué cambió entre dos fotos de una fila del historial. */
function diferencias(antes, despues) {
    const claves = new Set([...Object.keys(antes || {}), ...Object.keys(despues || {})]);
    const out = [];
    for (const k of claves) {
        if (['clave', 'orden'].includes(k)) continue;
        const a = antes?.[k]; const d = despues?.[k];
        if (JSON.stringify(a ?? null) === JSON.stringify(d ?? null)) continue;
        out.push(`${ROTULO_CAMPO[k] ?? k}: ${valorTexto(k, a)} → ${valorTexto(k, d)}`);
    }
    return out;
}

/** Valor esperado de un raspable: lo que cuesta en promedio cada uno que se da. */
function esperado(premios, defecto) {
    const lista = (premios || []).filter((p) => Number(p.peso) > 0 && Number(p.puntos) > 0);
    if (!lista.length) return Number(defecto) || 0;
    const total = lista.reduce((a, p) => a + Number(p.peso), 0);
    return lista.reduce((a, p) => a + Number(p.puntos) * Number(p.peso), 0) / total;
}

export default function NivelesDelPrograma({ puedeEditar }) {
    const showToast = useToastStore((s) => s.showToast);
    const [panel, setPanel] = useState(null);
    const [cargando, setCargando] = useState(true);
    const [version, setVersion] = useState(0);
    const recargar = useCallback(() => setVersion((v) => v + 1), []);

    useEffect(() => {
        let vivo = true;
        fetchPanelDeNiveles()
            .then((p) => { if (vivo) setPanel(p); })
            .catch((e) => { if (vivo) showToast('No se pudo cargar', mensajeAmigable(e), 'error'); })
            .finally(() => { if (vivo) setCargando(false); });
        return () => { vivo = false; };
    }, [showToast, version]);

    const niveles = panel?.niveles ?? [];
    const mayoreo = panel?.mayoreo ?? [];
    const ordenMax = Math.max(0, ...niveles.map((n) => n.orden));
    const ordenMaxMay = Math.max(0, ...mayoreo.map((n) => n.orden));

    if (cargando && !panel) return <p className="text-body-sm text-content-3 py-6 text-center">Cargando…</p>;
    if (!panel) return null;

    return (
        <div className="flex flex-col gap-6">
            {!puedeEditar && (
                <Notice variant="info">Puedes ver la configuración, pero no cambiarla.</Notice>
            )}
            <EstadoDelPrograma config={panel.config} dadoMes={panel.cupon_dado_mes}
                puedeEditar={puedeEditar} alGuardar={recargar} />

            <section className="flex flex-col gap-3">
                <h3 className="text-caption font-black text-content-2 uppercase tracking-wide flex items-center gap-2">
                    <Crown size={14} /> Niveles de Puntos Salud
                </h3>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    {niveles.map((n) => (
                        <TarjetaDeNivel key={n.clave} nivel={n} conRaspable={n.orden >= ordenMax - 1}
                            esEntrada={n.orden === Math.min(...niveles.map((x) => x.orden))}
                            puedeEditar={puedeEditar} alGuardar={recargar} />
                    ))}
                </div>
            </section>

            <section className="flex flex-col gap-3">
                <h3 className="text-caption font-black text-content-2 uppercase tracking-wide flex items-center gap-2">
                    <Gem size={14} /> Cliente Mayorista, por rango
                </h3>
                <p className="text-caption text-content-3 -mt-1">
                    Cumpleaños y raspable del Cliente Mayorista aprobado (Condiciones §5). Sólo se dan con
                    «Beneficios del Cliente Mayorista» encendido; mientras tanto recibe lo de cualquier cliente.
                    El rango y los puntos por dólar de cada rango no se cambian aquí.
                </p>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    {mayoreo.map((r) => (
                        <TarjetaDeRango key={r.clave} rango={r} conRaspable={r.orden >= ordenMaxMay - 1}
                            puedeEditar={puedeEditar} alGuardar={recargar} />
                    ))}
                </div>
            </section>

            <Historial filas={panel.historial ?? []} niveles={niveles} mayoreo={mayoreo} />
        </div>
    );
}

// ── Estado: los interruptores y el tope ─────────────────────────────────────
function EstadoDelPrograma({ config, dadoMes, puedeEditar, alGuardar }) {
    const showToast = useToastStore((s) => s.showToast);
    const [pidiendo, setPidiendo] = useState(null); // { campo, valor }
    const [guardando, setGuardando] = useState(false);
    const topeActual = config?.cupon_presupuesto_mensual;
    const [tope, setTope] = useState(topeActual == null ? '' : String(topeActual));
    useEffect(() => { setTope(topeActual == null ? '' : String(topeActual)); }, [topeActual]);
    const topeCambio = (tope === '' ? null : Number(tope)) !== (topeActual ?? null);

    const guardar = async (cambios, que) => {
        setGuardando(true);
        try {
            await guardarConfigDePuntos(cambios);
            showToast('Guardado', que, 'success');
            alGuardar();
        } catch (e) {
            showToast('No se pudo guardar', mensajeAmigable(e), 'error');
        } finally {
            setGuardando(false);
            setPidiendo(null);
        }
    };

    const TEXTO = {
        niveles_activos: {
            on: {
                titulo: '¿Encender los niveles?',
                mensaje: 'Desde ahora cada cliente queda en el nivel de lo que compró en los últimos 12 meses: cambian los puntos que gana por dólar, el regalo de cumpleaños, el raspable del mes y los días de anticipo de las ofertas. Hazlo sólo con el reglamento que los describe ya publicado.',
                boton: 'Encender niveles',
            },
            off: {
                titulo: '¿Apagar los niveles?',
                mensaje: 'Todos los clientes vuelven al nivel de entrada: 1 punto por dólar, el cumpleaños de ese nivel y sin raspable. Lo ya ganado no se toca.',
                boton: 'Apagar niveles',
            },
        },
        mayoreo_beneficios_activos: {
            on: {
                titulo: '¿Encender los beneficios del Cliente Mayorista?',
                mensaje: 'El Cliente Mayorista aprobado deja de recibir el cumpleaños y el raspable de su nivel y recibe los de su rango (Jade, Zafiro, Rubí o Diamante), como dicen las Condiciones §5.',
                boton: 'Encender',
            },
            off: {
                titulo: '¿Apagar los beneficios del Cliente Mayorista?',
                mensaje: 'El Cliente Mayorista vuelve a recibir el cumpleaños y el raspable como cualquier cliente.',
                boton: 'Apagar',
            },
        },
    };
    const t = pidiendo ? TEXTO[pidiendo.campo][pidiendo.valor ? 'on' : 'off'] : null;

    return (
        <section data-surface="card" className="p-4 md:p-5 flex flex-col gap-4 min-w-0">
            <h3 className="text-caption font-black text-content-2 uppercase tracking-wide flex items-center gap-2">
                <Power size={14} /> Estado del programa
            </h3>
            <div className="flex flex-col gap-3">
                <FilaInterruptor titulo="Niveles"
                    detalle={config?.niveles_activos
                        ? 'Encendidos: cada cliente está en el nivel de su compra de 12 meses.'
                        : 'Apagados: todos están en el nivel de entrada. La app dice «los niveles se activan pronto».'}
                    valor={!!config?.niveles_activos} puedeEditar={puedeEditar}
                    alCambiar={(v) => setPidiendo({ campo: 'niveles_activos', valor: v })} />
                <FilaInterruptor titulo="Beneficios del Cliente Mayorista"
                    detalle={config?.mayoreo_beneficios_activos
                        ? 'Encendidos: cumpleaños y raspable por rango.'
                        : 'Apagados: el mayorista recibe lo de cualquier cliente.'}
                    valor={!!config?.mayoreo_beneficios_activos} puedeEditar={puedeEditar}
                    alCambiar={(v) => setPidiendo({ campo: 'mayoreo_beneficios_activos', valor: v })} />
            </div>
            <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                <PortalInput className="sm:max-w-xs" label="Tope del raspable al mes (puntos)" type="number"
                    value={tope} onChange={(e) => setTope(e.target.value)} readOnly={!puedeEditar}
                    placeholder="Sin tope"
                    helperText={`Vacío = sin tope. Este mes ya se dieron ${pts(dadoMes)} puntos (${dolares(dadoMes)}).`} />
                {puedeEditar && (
                    <Button variant="secondary" icon={Save} disabled={!topeCambio} loading={guardando && !pidiendo}
                        onClick={() => guardar({ cupon_presupuesto_mensual: tope === '' ? null : Number(tope) }, 'Tope del raspable')}>
                        Guardar tope
                    </Button>
                )}
            </div>
            {t && (
                <ConfirmModal isOpen onClose={() => setPidiendo(null)} isDestructive={false} isProcessing={guardando}
                    title={t.titulo} message={t.mensaje} confirmText={t.boton}
                    onConfirm={() => guardar({ [pidiendo.campo]: pidiendo.valor }, t.boton)} />
            )}
        </section>
    );
}

function FilaInterruptor({ titulo, detalle, valor, alCambiar, puedeEditar }) {
    return (
        <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
                <p className="text-body-sm font-bold text-content">{titulo}</p>
                <p className="text-caption text-content-3">{detalle}</p>
            </div>
            <Switch checked={valor} onChange={puedeEditar ? alCambiar : undefined} label={titulo} />
        </div>
    );
}

// ── El editor del raspable ──────────────────────────────────────────────────
function EditorDePremios({ premios, alCambiar, puedeEditar }) {
    const lista = premios ?? [];
    const total = lista.reduce((a, p) => a + (Number(p.peso) || 0), 0);
    const poner = (i, campo, v) => alCambiar(lista.map((p, j) => (j === i ? { ...p, [campo]: v } : p)));
    return (
        <div className="flex flex-col gap-2">
            {lista.length === 0 && (
                <p className="text-caption text-content-3">Sin premios: no se da raspable en este nivel.</p>
            )}
            {lista.map((p, i) => (
                <div key={i} className="flex items-end gap-2">
                    <PortalInput className="flex-1" label={i === 0 ? 'Puntos' : undefined} type="number" compact
                        value={p.puntos ?? ''} onChange={(e) => poner(i, 'puntos', e.target.value)} readOnly={!puedeEditar} />
                    <PortalInput className="flex-1" label={i === 0 ? 'Peso' : undefined} type="number" compact
                        value={p.peso ?? ''} onChange={(e) => poner(i, 'peso', e.target.value)} readOnly={!puedeEditar} />
                    <span className="w-14 shrink-0 pb-2 text-caption text-content-3 tabular-nums text-right">
                        {total > 0 ? `${Math.round(((Number(p.peso) || 0) / total) * 1000) / 10}%` : '—'}
                    </span>
                    {puedeEditar && (
                        <Button variant="ghost" size="sm" iconOnly icon={Trash2} title="Quitar premio"
                            onClick={() => alCambiar(lista.filter((_, j) => j !== i))} />
                    )}
                </div>
            ))}
            {puedeEditar && lista.length < 12 && (
                <Button variant="ghost" size="sm" icon={Plus} className="self-start"
                    onClick={() => alCambiar([...lista, { puntos: '', peso: '' }])}>
                    Agregar premio
                </Button>
            )}
            <p className="text-caption text-content-3">
                El peso es la probabilidad relativa: la columna de la derecha dice cuánto sale cada uno. Sólo
                premios en puntos — el programa no sabe dar descuentos.
            </p>
        </div>
    );
}

const premiosLimpios = (lista) => (lista ?? [])
    .filter((p) => p.puntos !== '' && p.peso !== '')
    .map((p) => ({ puntos: Number(p.puntos), peso: Number(p.peso) }));

// ── Un nivel ────────────────────────────────────────────────────────────────
function TarjetaDeNivel({ nivel, conRaspable, esEntrada, puedeEditar, alGuardar }) {
    const showToast = useToastStore((s) => s.showToast);
    const llave = `puntos_nivel_${nivel.clave}`;
    const desdeFila = useMemo(() => ({
        ...Object.fromEntries(CAMPOS_NIVEL.map((c) => [c.key, nivel[c.key] == null ? '' : String(nivel[c.key])])),
        cupon_premios: (nivel.cupon_premios ?? []).map((p) => ({ puntos: String(p.puntos), peso: String(p.peso) })),
        nota: '',
    }), [nivel]);
    // El borrador sobrevive al cierre de sesión por inactividad (gate:borradores).
    const [form, setForm] = useState(() => loadDraft(llave) ?? desdeFila);
    const [guardando, setGuardando] = useState(false);
    useEffect(() => { if (!loadDraft(llave)) setForm(desdeFila); }, [desdeFila, llave]);

    const cambios = useMemo(() => {
        const c = {};
        for (const campo of CAMPOS_NIVEL) {
            const v = campo.tipo === 'number' ? num(form[campo.key]) : form[campo.key].trim();
            const antes = campo.tipo === 'number' ? num(nivel[campo.key]) : nivel[campo.key];
            if (v !== antes) c[campo.key] = v;
        }
        if (conRaspable) {
            const p = premiosLimpios(form.cupon_premios);
            if (JSON.stringify(p) !== JSON.stringify(nivel.cupon_premios ?? [])) c.cupon_premios = p.length ? p : null;
        }
        return c;
    }, [form, nivel, conRaspable]);
    const hayCambios = Object.keys(cambios).length > 0;

    const poner = (campo, v) => setForm((f) => {
        const nuevo = { ...f, [campo]: v };
        saveDraft(llave, nuevo);
        return nuevo;
    });

    const guardar = async () => {
        setGuardando(true);
        try {
            await guardarNivelDePuntos(nivel.clave, cambios, form.nota);
            clearDraft(llave);
            showToast('Guardado', `Nivel ${form.nombre || nivel.nombre}`, 'success');
            alGuardar();
        } catch (e) {
            showToast('No se pudo guardar', mensajeAmigable(e), 'error');
        } finally {
            setGuardando(false);
        }
    };
    const descartar = () => { clearDraft(llave); setForm(desdeFila); };

    const ev = esperado(premiosLimpios(form.cupon_premios), nivel.cupon_mensual);
    return (
        <section data-surface="card" className="p-4 md:p-5 flex flex-col gap-3 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-body font-black text-content flex items-center gap-2">
                    {nivel.nombre}
                    {esEntrada && <Badge variant="neutral" tone="soft" uppercase={false}>Entrada</Badge>}
                    {conRaspable && <Badge variant="info" tone="soft" uppercase={false}>Con raspable</Badge>}
                </h4>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {CAMPOS_NIVEL.map((c) => (
                    <PortalInput key={c.key} label={c.label} type={c.tipo} prefix={c.prefix}
                        value={form[c.key]} onChange={(e) => poner(c.key, e.target.value)}
                        readOnly={!puedeEditar || (esEntrada && c.key === 'desde')}
                        helperText={esEntrada && c.key === 'desde' ? 'El nivel de entrada empieza en $0.' : c.ayuda} />
                ))}
            </div>
            {conRaspable && (
                <div className="flex flex-col gap-2">
                    <p className="text-caption font-black text-content-2 uppercase tracking-wide flex items-center gap-2">
                        <Ticket size={13} /> Raspable del mes
                    </p>
                    <EditorDePremios premios={form.cupon_premios} puedeEditar={puedeEditar}
                        alCambiar={(l) => poner('cupon_premios', l)} />
                    {ev > 0 && (
                        <p className="text-caption text-content-2">
                            Cada raspable cuesta en promedio <span className="font-bold tabular-nums">{pts(Math.round(ev))} puntos</span> ({dolares(ev)}).
                        </p>
                    )}
                </div>
            )}
            {puedeEditar && hayCambios && (
                <div className="flex flex-col sm:flex-row sm:items-end gap-2">
                    <PortalInput className="flex-1" label="Motivo del cambio (opcional)" value={form.nota}
                        onChange={(e) => poner('nota', e.target.value)} placeholder="Ej.: premios de noviembre" />
                    <div className="flex gap-2">
                        <Button variant="secondary" onClick={descartar} disabled={guardando}>Descartar</Button>
                        <Button variant="primary" icon={Save} loading={guardando} onClick={guardar}>Guardar</Button>
                    </div>
                </div>
            )}
        </section>
    );
}

// ── Un rango de mayoreo ─────────────────────────────────────────────────────
function TarjetaDeRango({ rango, conRaspable, puedeEditar, alGuardar }) {
    const showToast = useToastStore((s) => s.showToast);
    const llave = `puntos_mayoreo_${rango.clave}`;
    const desdeFila = useMemo(() => ({
        puntos_cumpleanos: String(rango.puntos_cumpleanos ?? 0),
        cupon_premios: (rango.cupon_premios ?? []).map((p) => ({ puntos: String(p.puntos), peso: String(p.peso) })),
        nota: '',
    }), [rango]);
    const [form, setForm] = useState(() => loadDraft(llave) ?? desdeFila);
    const [guardando, setGuardando] = useState(false);
    useEffect(() => { if (!loadDraft(llave)) setForm(desdeFila); }, [desdeFila, llave]);

    const cambios = useMemo(() => {
        const c = {};
        if (num(form.puntos_cumpleanos) !== Number(rango.puntos_cumpleanos)) c.puntos_cumpleanos = num(form.puntos_cumpleanos);
        if (conRaspable) {
            const p = premiosLimpios(form.cupon_premios);
            if (JSON.stringify(p) !== JSON.stringify(rango.cupon_premios ?? [])) c.cupon_premios = p.length ? p : null;
        }
        return c;
    }, [form, rango, conRaspable]);
    const hayCambios = Object.keys(cambios).length > 0;
    const poner = (campo, v) => setForm((f) => { const nuevo = { ...f, [campo]: v }; saveDraft(llave, nuevo); return nuevo; });

    const guardar = async () => {
        setGuardando(true);
        try {
            await guardarRangoMayoreoDePuntos(rango.clave, cambios, form.nota);
            clearDraft(llave);
            showToast('Guardado', `Rango ${rango.nombre}`, 'success');
            alGuardar();
        } catch (e) {
            showToast('No se pudo guardar', mensajeAmigable(e), 'error');
        } finally {
            setGuardando(false);
        }
    };
    const ev = esperado(premiosLimpios(form.cupon_premios), rango.cupon_mensual);

    return (
        <section data-surface="card" className="p-4 md:p-5 flex flex-col gap-3 min-w-0">
            <h4 className="text-body font-black text-content flex items-center gap-2">
                {rango.nombre}
                {conRaspable && <Badge variant="info" tone="soft" uppercase={false}>Con raspable</Badge>}
            </h4>
            <PortalInput className="sm:max-w-xs" label="Puntos de cumpleaños" type="number"
                value={form.puntos_cumpleanos} onChange={(e) => poner('puntos_cumpleanos', e.target.value)}
                readOnly={!puedeEditar} helperText="Sólo persona natural con fecha de nacimiento." />
            {conRaspable && (
                <div className="flex flex-col gap-2">
                    <p className="text-caption font-black text-content-2 uppercase tracking-wide flex items-center gap-2">
                        <Ticket size={13} /> Raspable del mes
                    </p>
                    <EditorDePremios premios={form.cupon_premios} puedeEditar={puedeEditar}
                        alCambiar={(l) => poner('cupon_premios', l)} />
                    {ev > 0 && (
                        <p className="text-caption text-content-2">
                            Cada raspable cuesta en promedio <span className="font-bold tabular-nums">{pts(Math.round(ev))} puntos</span> ({dolares(ev)}).
                        </p>
                    )}
                </div>
            )}
            {puedeEditar && hayCambios && (
                <div className="flex flex-col sm:flex-row sm:items-end gap-2">
                    <PortalInput className="flex-1" label="Motivo del cambio (opcional)" value={form.nota}
                        onChange={(e) => poner('nota', e.target.value)} />
                    <div className="flex gap-2">
                        <Button variant="secondary" onClick={() => { clearDraft(llave); setForm(desdeFila); }} disabled={guardando}>Descartar</Button>
                        <Button variant="primary" icon={Save} loading={guardando} onClick={guardar}>Guardar</Button>
                    </div>
                </div>
            )}
        </section>
    );
}

// ── Historial ───────────────────────────────────────────────────────────────
function Historial({ filas, niveles, mayoreo }) {
    const nombreDe = (h) => {
        if (h.tabla === 'config') return 'Programa';
        const lista = h.tabla === 'nivel' ? niveles : mayoreo;
        const n = lista.find((x) => x.clave === h.clave)?.nombre ?? h.clave;
        return h.tabla === 'nivel' ? `Nivel ${n}` : `Mayoreo ${n}`;
    };
    return (
        <section className="flex flex-col gap-3">
            <h3 className="text-caption font-black text-content-2 uppercase tracking-wide flex items-center gap-2">
                <History size={14} /> Historial de cambios
            </h3>
            <DataTable
                columns={[
                    { key: 'cuando', label: 'Cuándo' },
                    { key: 'quien', label: 'Quién' },
                    { key: 'que', label: 'Qué' },
                    { key: 'cambio', label: 'Cambio' },
                    { key: 'nota', label: 'Motivo' },
                ]}
                minWidth="860px"
                movil={{ identidad: 'que', ancla: 'cuando' }}
                empty={{ icon: History, message: 'Todavía no hay cambios' }}
            >
                {filas.map((h, i) => (
                    <DataRow key={h.id} index={i}>
                        <DataCell>{fechaHora12(h.created_at)}</DataCell>
                        <DataCell>
                            {h.quien ? (
                                <span className="flex items-center gap-1.5 min-w-0">
                                    <AvatarConEstado emp={{ id: h.employee_id, name: h.quien }} px={20} radio="rounded-full" marco="" />
                                    <span className="truncate">{shortEmployeeName({ name: h.quien })}</span>
                                </span>
                            ) : <span className="text-content-3">—</span>}
                        </DataCell>
                        <DataCell>{nombreDe(h)}</DataCell>
                        <DataCell>
                            <ul className="flex flex-col gap-0.5">
                                {diferencias(h.antes, h.despues).map((d) => <li key={d} className="text-caption">{d}</li>)}
                            </ul>
                        </DataCell>
                        <DataCell>{h.nota || <span className="text-content-3">—</span>}</DataCell>
                    </DataRow>
                ))}
            </DataTable>
        </section>
    );
}
