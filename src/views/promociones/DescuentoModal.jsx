import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Percent, Trash2, Tag, Plus, Info } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import LiquidSelect from '../../components/common/LiquidSelect';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import PortalInput from '../../components/common/PortalInput';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import Checkbox from '../../components/common/Checkbox';
import BuscadorDeProducto from '../../components/common/BuscadorDeProducto';
import { LoadingState } from '../../components/common/StateViews';
import AvisoDeBorrador from '../../components/common/AvisoDeBorrador';
import useBorrador from '../../hooks/useBorrador';
import { useStaffStore } from '../../store/staffStore';
import { SALAS_VENTA } from '../metas/metasUtils';
import {
    fetchDescuento, fetchPreciosDeProductos, guardarDescuento,
} from '../../data/descuentos';
import { mensajeAmigable } from '../../utils/errorMessages';
import { formatMoney } from '../../utils/formatNumber';
import { hoySV, precioConDescuento } from './promocionesUtils';

/**
 * Los dos tipos, dichos como los aplica la venta.
 *
 * «Monto por unidad» y no «Monto» a secas porque el sistema de la caja hace
 * `subtotal -= monto × cantidad`: sobre tres unidades, un descuento de $10.04
 * son $30.12. Medido. El rótulo corto se lee como «$10.04 y ya», que es la
 * mitad del dinero en una venta de dos.
 */
const TIPOS = [
    { value: '%', label: 'Porcentaje del renglón' },
    { value: '$', label: 'Monto por cada unidad' },
];

const vacio = () => ({
    descripcion: '',
    tipo: '%',
    monto: '',
    inicio: hoySV(),
    fin: '',
    todas: true,
    branchId: '',
    productos: [],   // [{ id, nombre }]
});

/**
 * CORREGIR un descuento que ya existe. Acá no se crea.
 *
 * ── Por qué no se crea acá (2026-09-04) ──────────────────────────────────
 * Un descuento nace al crear su promoción, marcando «Además baja el precio en
 * la venta». Tener las dos puertas era el defecto: obligaba a cargar los
 * mismos productos y las mismas fechas dos veces, que es exactamente cómo dos
 * listas que deberían decir lo mismo terminan diciendo cosas distintas.
 *
 * Corregir sí vive acá, y hace falta: hay descuentos hechos directamente en el
 * sistema de ventas —13 al 2026-09-04— que no tienen promoción en el portal, y
 * alguien tiene que poder verles la fecha, cambiarla o quitarlos.
 *
 * ── Lo que esta pantalla agrega sobre la del sistema de ventas ───────────
 * Allá se escribe un número y se guarda. Acá se ve **en cuánto queda el
 * precio** de cada producto mientras se escribe, y en rojo el que caería bajo
 * el costo. Un 60 % se teclea igual de rápido que un 25 %: lo único que
 * distingue una campaña de una venta a pérdida es ese número.
 *
 * Las otras dos verificaciones —el solape con otro descuento vigente y el
 * alcance de sala— las hace el servidor, porque un formulario se puede saltear
 * cambiando el cuerpo de la petición.
 */
export default function DescuentoModal({ open, descuentoId, alcanceTodo, onClose, onGuardado }) {
    const editando = Number(descuentoId) > 0;

    const branches = useStaffStore((s) => s.branches);
    const salas = useMemo(
        () => SALAS_VENTA
            .map((id) => (branches || []).find((b) => Number(b.id) === id))
            .filter(Boolean),
        [branches],
    );

    const [f, setF] = useState(vacio);
    const [cargando, setCargando] = useState(editando);
    const [guardando, setGuardando] = useState(false);
    const [fallo, setFallo] = useState(null);
    const [avisos, setAvisos] = useState([]);
    const [precios, setPrecios] = useState([]);   // [{ id, nombre, precio, costo }]

    const set = useCallback((campo, v) => setF((x) => ({ ...x, [campo]: v })), []);

    /* El borrador va con el ID ADENTRO de la clave.
     *
     * La sesión de sala se cierra sola a los 5 minutos y acá se corrige algo que
     * mueve precios, así que perder lo escrito no es una molestia. Pero una
     * clave común —`descuento_editar`— repondría lo tecleado para el descuento
     * 14 encima del 15, y eso no se notaría hasta después de guardar. Con el id
     * en la clave, un borrador sólo puede volver a su propio descuento.
     */
    const { recuperado, cuando, descartar, hayBorrador } = useBorrador(
        `descuento_${descuentoId}`, f, { activo: open && editando && !cargando },
    );
    const reponer = () => { if (recuperado) setF((x) => ({ ...x, ...recuperado })); descartar(); };

    // ── Cargar el que se corrige ───────────────────────────────────────────
    useEffect(() => {
        if (!open || !editando) return undefined;
        let vivo = true;
        setCargando(true); // eslint-disable-line react-hooks/set-state-in-effect -- el descuento vive en un sistema ajeno: no hay forma de tenerlo antes de pedirlo
        setFallo(null);
        fetchDescuento(descuentoId)
            .then((d) => {
                if (!vivo) return;
                setF({
                    descripcion: d.descripcion || '',
                    tipo: d.tipo === '$' ? '$' : '%',
                    monto: d.monto ? String(d.monto) : '',
                    inicio: d.inicio || hoySV(),
                    fin: d.fin || '',
                    todas: d.todas_las_salas === true,
                    branchId: d.branch_id ? String(d.branch_id) : '',
                    productos: d.productos || [],
                });
            })
            .catch((e) => { if (vivo) setFallo(mensajeAmigable(e, 'No se pudo cargar el descuento.')); })
            .finally(() => { if (vivo) setCargando(false); });
        return () => { vivo = false; };
    }, [open, editando, descuentoId]);

    // ── Los precios de los productos elegidos ──────────────────────────────
    const ids = useMemo(() => f.productos.map((p) => p.id).join(','), [f.productos]);
    useEffect(() => {
        if (!open || !ids) { setPrecios([]); return undefined; } // eslint-disable-line react-hooks/set-state-in-effect -- sin productos no hay precios que mostrar
        let vivo = true;
        fetchPreciosDeProductos(ids.split(',').map(Number))
            .then((r) => { if (vivo) setPrecios(r || []); })
            .catch(() => { if (vivo) setPrecios([]); });
        return () => { vivo = false; };
    }, [open, ids]);

    const porProducto = useMemo(
        () => new Map((precios || []).map((p) => [Number(p.id), p])),
        [precios],
    );

    const agregar = (prod) => setF((x) => (
        x.productos.some((p) => p.id === prod.id)
            ? x
            : { ...x, productos: [...x.productos, { id: prod.id, nombre: prod.nombre }] }
    ));

    const quitar = (id) => setF((x) => ({ ...x, productos: x.productos.filter((p) => p.id !== id) }));

    // ── Lo que impide guardar, dicho antes de intentarlo ───────────────────
    const monto = Number(f.monto);
    const problemas = useMemo(() => {
        const l = [];
        if (!f.descripcion.trim()) l.push('Ponle un nombre al descuento.');
        if (!Number.isFinite(monto) || monto <= 0) l.push('El descuento tiene que ser mayor que cero.');
        if (f.tipo === '%' && monto > 100) l.push('Un porcentaje no puede pasar de 100.');
        if (!f.fin) l.push('Falta la fecha de fin.');
        if (f.inicio && f.fin && f.fin < f.inicio) l.push('La fecha de fin es anterior a la de inicio.');
        if (!f.productos.length) l.push('Agrega al menos un producto.');
        if (alcanceTodo && !f.todas && !f.branchId) l.push('Elige la sala.');
        return l;
    }, [f, monto, alcanceTodo]);

    const enviar = async (forzar) => {
        setFallo(null);
        setGuardando(true);
        try {
            const r = await guardarDescuento({
                id: editando ? Number(descuentoId) : 0,
                descripcion: f.descripcion.trim(),
                tipo: f.tipo,
                monto,
                inicio: f.inicio,
                fin: f.fin,
                todas_las_salas: f.todas,
                branch_id: f.todas ? (salas[0]?.id ?? null) : Number(f.branchId),
                productos: f.productos.map((p) => p.id),
                forzar: forzar === true,
            });
            if (r.avisos) { setAvisos(r.avisos); return; }
            setAvisos([]);
            descartar();
            onGuardado?.();
        } catch (e) {
            setFallo(mensajeAmigable(e, 'No se pudo guardar el descuento.'));
        } finally {
            setGuardando(false);
        }
    };

    const titulo = 'Corregir descuento';

    return (
        <LiquidModal open={open} onClose={onClose} maxWidth="max-w-3xl" ariaLabel={titulo}>
            <LiquidModal.Header>
                <h2 className="text-body-xl font-semibold text-content">{titulo}</h2>
            </LiquidModal.Header>

            <LiquidModal.Body>
                {cargando ? <LoadingState label="Cargando el descuento…" /> : (
                    <div className="space-y-4">
                        {hayBorrador && (
                            <AvisoDeBorrador cuando={cuando} onRecuperar={reponer} onDescartar={descartar} />
                        )}

                        <PortalInput
                            label="Nombre del descuento"
                            name="descripcion"
                            value={f.descripcion}
                            onChange={(e) => set('descripcion', e.target.value)}
                            placeholder="Cómo se va a reconocer en la lista"
                            required
                        />

                        <div className="grid gap-3 sm:grid-cols-2">
                            <Campo rotulo="Cómo descuenta" falta>
                                <LiquidSelect
                                    value={f.tipo}
                                    onChange={(v) => set('tipo', v)}
                                    options={TIPOS}
                                    clearable={false}
                                    icon={Percent}
                                    ariaLabel="Cómo descuenta"
                                />
                            </Campo>

                            <PortalInput
                                label={f.tipo === '%' ? 'Porcentaje' : 'Monto por unidad'}
                                name="monto"
                                /* Nunca `type="number"`: en el teclado del teléfono el
                                   separador decimal depende de la configuración del
                                   equipo y una coma se pierde entera. */
                                value={f.monto}
                                onChange={(e) => set('monto', e.target.value.replace(/[^0-9.]/g, ''))}
                                placeholder={f.tipo === '%' ? '25' : '1.50'}
                                prefix={f.tipo === '%' ? '%' : '$'}
                                required
                            />
                        </div>

                        {/* La frase que evita el malentendido del módulo: el monto es
                            POR UNIDAD, y en una venta de tres se multiplica. */}
                        {f.tipo === '$' && monto > 0 && (
                            <Notice variant="info" icon={Info}>
                                Se descuenta {formatMoney(monto)} <span className="font-semibold">por cada unidad</span>.
                                {' '}En una venta de 3 unidades son {formatMoney(monto * 3)}.
                            </Notice>
                        )}

                        <div className="grid gap-3 sm:grid-cols-2">
                            <Campo rotulo="Desde" falta>
                                <LiquidDatePicker value={f.inicio} onChange={(v) => set('inicio', v)} />
                            </Campo>
                            <Campo rotulo="Hasta" falta>
                                <LiquidDatePicker value={f.fin} onChange={(v) => set('fin', v)} min={f.inicio} />
                            </Campo>
                        </div>

                        {/* Con alcance de una sola sala no se pregunta: el servidor lo
                            fija en la propia y preguntarlo ofrecería una opción que va
                            a rechazar. */}
                        {alcanceTodo && (
                            <div className="space-y-2">
                                <Checkbox
                                    checked={f.todas}
                                    onChange={(e) => set('todas', e.target.checked)}
                                    label="En todas las salas"
                                    description="Sin esto, el descuento vale sólo en la sala que elijas."
                                />
                                {!f.todas && (
                                    <Campo rotulo="Sala" falta>
                                        <LiquidSelect
                                            value={f.branchId}
                                            onChange={(v) => set('branchId', v)}
                                            options={salas.map((s) => ({ value: String(s.id), label: s.name }))}
                                            placeholder="Elige la sala"
                                            clearable={false}
                                            ariaLabel="Sala del descuento"
                                        />
                                    </Campo>
                                )}
                            </div>
                        )}

                        {/* ── Los productos, con el precio resultante ──────────── */}
                        {f.productos.length > 0 && (
                            <div className="rounded-lg border border-border-card divide-y divide-border-card">
                                {f.productos.map((p) => (
                                    <FilaProducto
                                        key={p.id}
                                        producto={p}
                                        datos={porProducto.get(p.id)}
                                        tipo={f.tipo}
                                        monto={monto}
                                        onQuitar={() => quitar(p.id)}
                                    />
                                ))}
                            </div>
                        )}

                        <div className="max-h-56 flex flex-col">
                            <BuscadorDeProducto
                                key={f.productos.length}
                                onElegir={agregar}
                                placeholder={f.productos.length
                                    ? 'Agregar otro producto…'
                                    : 'Buscar el producto que entra en el descuento…'}
                                invitacion={{
                                    icono: f.productos.length ? Plus : Tag,
                                    texto: f.productos.length
                                        ? '¿Entra otro producto? Búscalo, o guarda el descuento'
                                        : 'Busca el producto al que se le va a descontar',
                                }}
                            />
                        </div>

                        {avisos.length > 0 && (
                            <Notice variant="warning" icon={AlertTriangle}>
                                <p className="font-semibold mb-1">Antes de guardar, mira esto:</p>
                                <ul className="list-disc pl-4 space-y-0.5">
                                    {avisos.map((a) => <li key={a.texto}>{a.texto}</li>)}
                                </ul>
                                <p className="mt-1.5 text-caption">
                                    Cuando dos descuentos toman el mismo producto en las mismas fechas,
                                    la venta aplica uno solo y no dice cuál.
                                </p>
                            </Notice>
                        )}

                        {fallo && <Notice variant="danger" icon={AlertTriangle}>{fallo}</Notice>}
                    </div>
                )}
            </LiquidModal.Body>

            <LiquidModal.Footer>
                <span className="text-caption text-content-3 mr-auto">
                    {problemas.length ? problemas[0] : 'Empieza a descontar en la fecha de inicio.'}
                </span>
                <Button variant="secondary" onClick={onClose}>Cancelar</Button>
                {avisos.length > 0 ? (
                    <Button
                        variant="danger"
                        icon={Check}
                        loading={guardando}
                        onClick={() => enviar(true)}
                    >
                        Guardar de todos modos
                    </Button>
                ) : (
                    <Button
                        icon={Check}
                        loading={guardando}
                        disabled={problemas.length > 0 || cargando}
                        onClick={() => enviar(false)}
                    >
                        Guardar cambios
                    </Button>
                )}
            </LiquidModal.Footer>
        </LiquidModal>
    );
}

/**
 * Un producto del descuento, con en cuánto le queda el precio.
 *
 * El precio que se muestra es el MÁS BAJO de sus presentaciones y el costo el
 * MÁS ALTO: el peor caso es el que decide. Un promedio escondería justo la
 * presentación que se vendería perdiendo.
 */
function FilaProducto({ producto, datos, tipo, monto, onQuitar }) {
    const precio = Number(datos?.precio) || 0;
    const costo = Number(datos?.costo) || 0;
    const queda = precio ? precioConDescuento(precio, tipo, monto) : null;
    const bajoCosto = queda !== null && costo > 0 && queda < costo;

    return (
        <div className="flex items-center gap-2 px-3 py-2.5">
            <div className="min-w-0 flex-1">
                <p className="text-body-sm font-semibold text-content truncate">{producto.nombre}</p>
                <p className="text-caption text-content-3 tabular-nums">
                    {!precio ? 'Sin precio registrado' : (
                        <>
                            {formatMoney(precio)} → <span className={bajoCosto ? 'text-danger font-semibold' : 'text-success font-semibold'}>{formatMoney(queda)}</span>
                            {costo > 0 && <> · cuesta {formatMoney(costo)}</>}
                        </>
                    )}
                </p>
            </div>
            {bajoCosto && (
                <span className="text-caption text-danger font-semibold shrink-0 flex items-center gap-1">
                    <AlertTriangle size={13} aria-hidden /> bajo el costo
                </span>
            )}
            <Button variant="ghost" size="sm" iconOnly icon={Trash2} onClick={onQuitar} title="Quitar" />
        </div>
    );
}

/** El rótulo de los controles que no traen el suyo (`LiquidSelect`, el de fecha). */
function Campo({ rotulo, falta = false, children }) {
    return (
        /* `space-y-1` en BLOQUE y no `flex flex-col`: `LiquidDatePicker`
           declara `basis-[140px]` —su ANCHO cuando vive en una fila— y en un
           contenedor `flex-col` ese basis manda sobre el eje VERTICAL, así que
           su ancho se convertía en 140px de ALTO. Medido el 2026-09-05: el
           control declara `h-[max(40px,var(--tap-min))]` y computaba 140px.
           En un contenedor `block`, `flex-basis` no aplica. */
        <div className="space-y-1 min-w-0">
            <span className="text-label uppercase tracking-wide font-semibold text-content-2 flex items-center gap-1.5">
                {rotulo}
                {falta && <span className="text-danger" aria-label="requerido">*</span>}
            </span>
            {children}
        </div>
    );
}
