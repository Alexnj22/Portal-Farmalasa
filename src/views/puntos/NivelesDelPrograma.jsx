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
 * No ofrece premios en DESCUENTO: la caja no cobraría un porcentaje, y
 * ofrecerlo sería prometer algo que nadie da. Sí ofrece, desde el 2026-10-19,
 * premios que son un PRODUCTO del inventario (se entrega en la sala y se
 * descarta en el sistema de la caja) o un regalo PROMOCIONAL (con su propio
 * inventario por sala, en la pestaña Premios).
 *
 * La base valida todo de nuevo (la escalera, los rangos de cada número, que los
 * premios sean sólo puntos y probabilidad) y exige `puntos_tab_niveles` para
 * escribir: lo de acá sólo evita viajes que van a volver con error.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Crown, Gem, History, Plus, Save, Search, Trash2, Ticket, Power } from 'lucide-react';
import Button from '../../components/common/Button';
import BuscadorDeProducto from '../../components/common/BuscadorDeProducto';
import LiquidSelect from '../../components/common/LiquidSelect';
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
    fetchPanelDeNiveles, guardarNivelDePuntos, guardarRangoMayoreoDePuntos, guardarConfigDePuntos, fetchPromocionales,
} from '@nucleo/data/puntos';
import { fetchPresentaciones } from '@nucleo/data/inventoryMovements';

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

/** Un premio en palabras: «300 pts», «2 × MICROPORE», «Termo Salud». */
const premioTexto = (p) => (p.tipo === 'producto' ? `${Number(p.cantidad) > 1 ? `${p.cantidad} × ` : ''}${p.nombre}`
    : p.tipo === 'promocional' ? p.nombre : `${pts(p.puntos)} pts`);

/** La tabla de premios en palabras, para el historial. */
const premiosTexto = (lista) => (Array.isArray(lista) && lista.length
    ? lista.map((p) => `${premioTexto(p)} (${p.peso})`).join(' · ') : 'ninguno');

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

const esRegalo = (p) => p.tipo === 'producto' || p.tipo === 'promocional';
/**
 * Valor esperado de un raspable EN PUNTOS: lo que cuesta en promedio cada uno.
 * Los regalos cuentan como 0 puntos (su costo es de inventario, no de puntos),
 * así que pesan en el total y bajan el promedio.
 */
function esperado(premios, defecto) {
    const lista = (premios || []).filter((p) => Number(p.peso) > 0);
    if (!lista.length) return Number(defecto) || 0;
    const total = lista.reduce((a, p) => a + Number(p.peso), 0);
    return lista.reduce((a, p) => a + (esRegalo(p) ? 0 : Number(p.puntos) || 0) * Number(p.peso), 0) / total;
}
/** Qué parte de los raspables sale en regalo, en %. */
const parteEnRegalos = (premios) => {
    const lista = (premios || []).filter((p) => Number(p.peso) > 0);
    const total = lista.reduce((a, p) => a + Number(p.peso), 0);
    return total ? Math.round((lista.filter(esRegalo).reduce((a, p) => a + Number(p.peso), 0) / total) * 100) : 0;
};

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
// Cada premio es de PUNTOS (los de siempre), de PRODUCTO o PROMOCIONAL. La
// forma de cada uno es la que guarda la base y valida `puntos_premios_validos`.
const TIPOS_DE_PREMIO = [
    { value: 'puntos', label: 'Puntos' },
    { value: 'producto', label: 'Producto' },
    { value: 'promocional', label: 'Promocional' },
];

/** El rótulo de un campo que no lo trae (LiquidSelect), con la letra de PortalInput. */
const Campo = ({ rotulo, className = '', children }) => (
    <div className={`flex flex-col gap-1.5 min-w-0 ${className}`}>
        <span className="text-caption font-black uppercase tracking-widest text-content-3 ml-1">{rotulo}</span>
        {children}
    </div>
);

/** Un premio guardado → la fila del formulario (todo en texto). */
const filaDePremio = (p) => ({
    tipo: p.tipo ?? 'puntos', peso: String(p.peso ?? ''), puntos: p.puntos != null ? String(p.puntos) : '',
    product_id: p.product_id ?? null, presentacion_tipo: p.presentacion_tipo ?? '', factor: p.factor ?? null,
    cantidad: p.cantidad != null ? String(p.cantidad) : '1', nombre: p.nombre ?? '', promocional_id: p.promocional_id ?? null,
});

function FilaDeProducto({ p, poner, puedeEditar }) {
    const [buscando, setBuscando] = useState(!p.product_id);
    const [presentaciones, setPresentaciones] = useState(null);
    useEffect(() => {
        if (!p.product_id) return undefined;
        let vivo = true;
        fetchPresentaciones([p.product_id]).then(({ porProducto }) => {
            if (vivo) setPresentaciones(porProducto.get(Number(p.product_id)) ?? []);
        });
        return () => { vivo = false; };
    }, [p.product_id]);
    if (buscando && puedeEditar) {
        return (
            <div className="flex flex-col gap-1">
                <BuscadorDeProducto placeholder="Buscar el producto del premio…"
                    invitacion={{ icono: Search, texto: 'Escribe el nombre del producto que se regala' }}
                    onElegir={(prod) => {
                        poner({ product_id: Number(prod.id), nombre: prod.nombre, presentacion_tipo: '', factor: null });
                        setBuscando(false);
                    }} />
                {p.product_id && (
                    <button type="button" onClick={() => setBuscando(false)}
                        className="self-start text-caption underline text-content-3 min-h-[var(--tap-min)]">Cancelar</button>
                )}
            </div>
        );
    }
    const opciones = (presentaciones ?? []).map((x) => ({ value: `${x.tipo}|${x.factor}`, label: `${x.tipo} (${x.factor})` }));
    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 min-w-0">
                <span className="text-body-sm font-semibold text-content truncate flex-1">{p.nombre}</span>
                {puedeEditar && (
                    <Button variant="ghost" size="sm" onClick={() => setBuscando(true)}>Cambiar</Button>
                )}
            </div>
            <div className="grid grid-cols-2 gap-2">
                <Campo rotulo="Presentación">
                    <LiquidSelect placeholder="¿Cuál presentación?" options={opciones} clearable={false}
                        value={p.presentacion_tipo && p.factor ? `${p.presentacion_tipo}|${p.factor}` : ''} disabled={!puedeEditar}
                        onChange={(v) => { const [t, f] = String(v).split('|'); poner({ presentacion_tipo: t, factor: Number(f) }); }} />
                </Campo>
                <PortalInput label="Cantidad" type="number" compact value={p.cantidad} readOnly={!puedeEditar}
                    onChange={(e) => poner({ cantidad: e.target.value })} placeholder="1 a 20" />
            </div>
        </div>
    );
}

function EditorDePremios({ premios, alCambiar, puedeEditar }) {
    const lista = premios ?? [];
    const total = lista.reduce((a, p) => a + (Number(p.peso) || 0), 0);
    const ponerVarios = (i, cambios) => alCambiar(lista.map((p, j) => (j === i ? { ...p, ...cambios } : p)));
    const poner = (i, campo, v) => ponerVarios(i, { [campo]: v });
    const [promos, setPromos] = useState(null);
    const hayPromo = lista.some((p) => p.tipo === 'promocional');
    useEffect(() => {
        if (!hayPromo || promos) return undefined;
        let vivo = true;
        fetchPromocionales().then((r) => { if (vivo) setPromos((r?.promocionales ?? []).filter((x) => x.activo)); })
            .catch(() => { if (vivo) setPromos([]); });
        return () => { vivo = false; };
    }, [hayPromo, promos]);
    return (
        <div className="flex flex-col gap-3">
            {lista.length === 0 && (
                <p className="text-caption text-content-3">Sin premios: no se da raspable en este nivel.</p>
            )}
            {lista.map((p, i) => (
                <div key={i} data-surface="card" className="rounded-xl p-3 flex flex-col gap-2">
                    <div className="flex items-end gap-2">
                        <Campo rotulo="Premio" className="flex-1 min-w-[9.5rem]">
                            <LiquidSelect options={TIPOS_DE_PREMIO} value={p.tipo ?? 'puntos'} clearable={false}
                                disabled={!puedeEditar}
                                onChange={(v) => ponerVarios(i, { ...filaDePremio({ peso: p.peso }), tipo: v })} />
                        </Campo>
                        <PortalInput className="w-24" label="Peso" type="number" compact
                            value={p.peso ?? ''} onChange={(e) => poner(i, 'peso', e.target.value)} readOnly={!puedeEditar} />
                        <span className="w-14 shrink-0 pb-2 text-caption text-content-3 tabular-nums text-right">
                            {total > 0 ? `${Math.round(((Number(p.peso) || 0) / total) * 1000) / 10}%` : '—'}
                        </span>
                        {puedeEditar && (
                            <Button variant="ghost" size="sm" iconOnly icon={Trash2} title="Quitar premio"
                                onClick={() => alCambiar(lista.filter((_, j) => j !== i))} />
                        )}
                    </div>
                    {(p.tipo ?? 'puntos') === 'puntos' && (
                        <PortalInput label="Puntos" type="number" compact value={p.puntos ?? ''}
                            onChange={(e) => poner(i, 'puntos', e.target.value)} readOnly={!puedeEditar}
                            placeholder="1 a 10,000 · 100 puntos = $1" />
                    )}
                    {p.tipo === 'producto' && (
                        <FilaDeProducto p={p} puedeEditar={puedeEditar} poner={(c) => ponerVarios(i, c)} />
                    )}
                    {p.tipo === 'promocional' && (
                        <Campo rotulo="Regalo">
                            <LiquidSelect placeholder={promos == null ? 'Cargando…' : '¿Cuál regalo?'} clearable={false}
                                options={(promos ?? []).map((x) => ({ value: x.id, label: x.nombre }))}
                                value={p.promocional_id ?? ''} disabled={!puedeEditar}
                                onChange={(v) => ponerVarios(i, { promocional_id: Number(v),
                                    nombre: (promos ?? []).find((x) => Number(x.id) === Number(v))?.nombre ?? '' })} />
                        </Campo>
                    )}
                    {p.tipo === 'promocional' && promos?.length === 0 && (
                        <p className="text-caption text-content-3">No hay regalos en el catálogo: créalos en la pestaña Premios.</p>
                    )}
                </div>
            ))}
            {puedeEditar && lista.length < 12 && (
                <Button variant="ghost" size="sm" icon={Plus} className="self-start"
                    onClick={() => alCambiar([...lista, filaDePremio({})])}>
                    Agregar premio
                </Button>
            )}
            <p className="text-caption text-content-3">
                El peso es la probabilidad relativa: la columna de la derecha dice cuánto sale cada uno. Un producto
                se entrega en la sala y se descarga del inventario; un promocional sale del inventario de regalos de
                esa sala. No hay premios en descuento: la caja no cobra porcentajes.
            </p>
        </div>
    );
}

/** El formulario → la lista que guarda la base, sin filas a medio llenar. */
const premiosLimpios = (lista) => (lista ?? []).flatMap((p) => {
    if (p.peso === '' || p.peso == null) return [];
    const peso = Number(p.peso);
    if ((p.tipo ?? 'puntos') === 'puntos') return p.puntos === '' ? [] : [{ puntos: Number(p.puntos), peso }];
    if (p.tipo === 'producto') {
        if (!p.product_id || !p.presentacion_tipo || !p.factor) return [];
        return [{ tipo: 'producto', product_id: Number(p.product_id), presentacion_tipo: p.presentacion_tipo,
            factor: Number(p.factor), cantidad: Number(p.cantidad) || 1, nombre: p.nombre, peso }];
    }
    if (p.tipo === 'promocional') {
        if (!p.promocional_id) return [];
        return [{ tipo: 'promocional', promocional_id: Number(p.promocional_id), nombre: p.nombre, peso }];
    }
    return [];
});
/** Para comparar con lo guardado: la base reordena las claves de cada premio. */
const canonico = (lista) => JSON.stringify((lista ?? []).map((o) => Object.fromEntries(Object.entries(o).sort())));

// ── Un nivel ────────────────────────────────────────────────────────────────
function TarjetaDeNivel({ nivel, conRaspable, esEntrada, puedeEditar, alGuardar }) {
    const showToast = useToastStore((s) => s.showToast);
    const llave = `puntos_nivel_${nivel.clave}`;
    const desdeFila = useMemo(() => ({
        ...Object.fromEntries(CAMPOS_NIVEL.map((c) => [c.key, nivel[c.key] == null ? '' : String(nivel[c.key])])),
        cupon_premios: (nivel.cupon_premios ?? []).map(filaDePremio),
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
            if (canonico(p) !== canonico(nivel.cupon_premios)) c.cupon_premios = p.length ? p : null;
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
                            Cada raspable cuesta en promedio <span className="font-bold tabular-nums">{pts(Math.round(ev))} puntos</span> ({dolares(ev)}){parteEnRegalos(premiosLimpios(form.cupon_premios)) > 0
                                && ` en puntos; además ${parteEnRegalos(premiosLimpios(form.cupon_premios))}% de las veces sale un regalo`}.
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
        cupon_premios: (rango.cupon_premios ?? []).map(filaDePremio),
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
            if (canonico(p) !== canonico(rango.cupon_premios)) c.cupon_premios = p.length ? p : null;
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
                            Cada raspable cuesta en promedio <span className="font-bold tabular-nums">{pts(Math.round(ev))} puntos</span> ({dolares(ev)}){parteEnRegalos(premiosLimpios(form.cupon_premios)) > 0
                                && ` en puntos; además ${parteEnRegalos(premiosLimpios(form.cupon_premios))}% de las veces sale un regalo`}.
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
