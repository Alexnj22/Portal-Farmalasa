import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Trash2, AlertTriangle, Check, Tag, Pencil, Plus } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import LiquidSelect from '../../components/common/LiquidSelect';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import BuscadorDeProducto from '../../components/common/BuscadorDeProducto';
import AvisoDeBorrador from '../../components/common/AvisoDeBorrador';
import useBorrador from '../../hooks/useBorrador';
import { useStaffStore } from '../../store/staffStore';
import { SALAS_VENTA } from '../metas/metasUtils';
import {
    crearPromocion, fetchPresentacionesDeProducto, fetchProveedoresDelSistema,
    fetchLaboratoriosConProductos,
} from '../../data/promociones';
import AgregarProductos from './AgregarProductos';
import { guardarDescuento } from '../../data/descuentos';
import { useAuth } from '../../context/AuthContext';
import DescuentoEnVentas from './DescuentoEnVentas';
import { mensajeAmigable } from '../../utils/errorMessages';
import {
    hoySV, fmtUnidades, rotuloPresentacion,
    descuentoDesdeLaPromocion, problemasDelDescuento,
} from './promocionesUtils';

const CLAVE_BORRADOR = 'promocion_nueva';

/**
 * Las seis salas de VENTA, del catálogo canónico.
 *
 * El filtro anterior era `!b.es_bodega && b.name !== 'Bodega'`, y dejaba entrar
 * a **Administración**: el `branches` del store trae sólo `id` y `name`, así que
 * `b.es_bodega` es `undefined` y su negación es cierta para todos. Un prop que
 * no existe no da error — deja pasar todo.
 */
const useSalasDeVenta = () => {
    const branches = useStaffStore((s) => s.branches);
    return useMemo(
        () => SALAS_VENTA
            .map((id) => (branches || []).find((b) => Number(b.id) === id))
            .filter(Boolean),
        [branches],
    );
};

/**
 * Lo que se pregunta UNA vez y vale para todos los productos.
 *
 * Existe porque el formulario preguntaba producto por producto —sus fechas, su
 * lote, su bono— y una promoción de doce leches eran doce veces lo mismo, que
 * en la negociación se dijo una sola vez. Reportado el 2026-09-05.
 *
 * **La base NO cambia**: `promocion_renglon` sigue guardando fecha, lote y bono
 * POR RENGLÓN, y eso es a propósito —dos productos de la misma campaña pueden
 * llegar en fechas distintas—. Lo que cambia es de dónde salen: se rellenan
 * desde acá, y el que necesite otra cosa se ajusta uno por uno.
 */
const generalNuevo = (salas = []) => ({
    inicio: hoySV(),
    // Vacío a propósito: «todavía no se sabe» es un estado válido y se puede
    // guardar así. La promoción cuenta las ventas de sus fechas igual.
    fin: '',
    lote_total: '',
    tiene_bono: true,
    paga: 'proveedor',
    supplier_id: '',
    bono_vendedor: '1.00',
    bono_adm: '0.25',
    bono_bodega: '0.25',
    unidades_por_bono: '1',
    /* A qué salas va el lote. Vacío = a todas: sin reparto la promoción cuenta
       las ventas de TODAS, que es lo que hace falta la mayoría de las veces.
       Repartir sirve para acotar cuántas unidades le tocan a cada una, y la
       base exige que la suma dé exactamente el lote. */
    reparto: Object.fromEntries(salas.map((s) => [s.id, ''])),
});

/* Un producto nace con los valores generales YA puestos y **confirmado**: antes
   cada uno abría su propio formulario y había que cerrarlo, que es justo lo que
   volvía inviable agregar doce. El que necesite algo distinto se abre con
   «Ajustar». */
const renglonNuevo = (prod, salas, general) => ({
    erp_product_id: prod.id,
    producto: prod.nombre,
    laboratorio: prod.laboratorio_nombre || 'Sin laboratorio',
    factor_unidades: null,
    inicio: general.inicio,
    fin: general.fin,
    lote_total: general.lote_total,
    tiene_bono: general.tiene_bono,
    paga: general.paga,
    supplier_id: general.supplier_id,
    bono_vendedor: general.bono_vendedor,
    bono_adm: general.bono_adm,
    bono_bodega: general.bono_bodega,
    unidades_por_bono: general.unidades_por_bono,
    reparto: { ...(general.reparto || {}) },
    confirmado: true,
    /* Marca si alguien lo tocó a mano. Sin esto, cambiar la fecha general
       después de agregar productos pisaría en silencio el ajuste que alguien ya
       hizo — y no habría cómo notarlo. */
    ajustado: false,
});

/**
 * Nueva promoción.
 *
 * **Nada toca la base hasta «Guardar promoción»** (decisión del usuario): cada
 * producto se confirma en la lista y el formulario pregunta si hay otro, pero la
 * escritura es una sola al final. Si alguien se arrepiente a mitad, no queda una
 * promoción incompleta que después haya que limpiar — y el borrador ya protege
 * lo escrito de un cierre de sesión.
 */
export default function PromocionModal({ open, onClose, onGuardada }) {
    const salas = useSalasDeVenta();

    const [nombre, setNombre] = useState('');
    const [nota, setNota] = useState('');
    const [renglones, setRenglones] = useState([]);
    const [general, setGeneral] = useState(() => generalNuevo(salas));
    const [laboratorios, setLaboratorios] = useState([]);
    const [guardando, setGuardando] = useState(false);
    const [fallo, setFallo] = useState(null);
    const [proveedores, setProveedores] = useState([]);

    /* El descuento en la venta. Nace apagado: la mayoría de las promociones
       paga una bonificación y NO le baja el precio a nadie, así que encenderlo
       por defecto pondría a descontar campañas que nadie decidió descontar. */
    const [desc, setDesc] = useState({
        activo: false, tipo: '%', monto: '', todas: true, branchId: '', finPropio: '',
    });
    const cambiarDesc = useCallback(
        (campo, v) => setDesc((d) => ({ ...d, [campo]: v })), [],
    );

    /* La promoción ya se creó y el descuento no: sólo falta reintentar ESA
       mitad. Sin esto, el único camino sería crear la promoción de nuevo. */
    const [promoCreada, setPromoCreada] = useState(null);
    const [avisosDesc, setAvisosDesc] = useState([]);

    /* El ALCANCE, no el permiso: con una sola sala el descuento va a la propia
       y el servidor lo fija ahí igual, así que preguntarlo ofrecería una opción
       que va a rechazar. Sale del mismo terminal que usa la base. */
    const { getScope } = useAuth();
    const alcanceTodo = getScope('promociones') === 'ALL';

    useEffect(() => {
        if (!open) return;
        fetchProveedoresDelSistema().then(setProveedores).catch(() => setProveedores([]));
        fetchLaboratoriosConProductos()
            .then(setLaboratorios)
            .catch(() => setLaboratorios([]));
    }, [open]);

    /* Cambiar un valor general lo aplica a los productos que NADIE ajustó a
       mano. Los ajustados se respetan: pisarlos sería deshacer trabajo sin
       decirlo, y el formulario no tiene cómo avisar de un cambio que ya ocurrió. */
    const cambiarGeneral = useCallback((campo, v) => {
        setGeneral((g) => ({ ...g, [campo]: v }));
        setRenglones((rs) => rs.map((r) => (r.ajustado ? r : { ...r, [campo]: v })));
    }, []);

    const cambiarRepartoGeneral = useCallback((salaId, v) => {
        setGeneral((g) => ({ ...g, reparto: { ...g.reparto, [salaId]: v } }));
        setRenglones((rs) => rs.map((r) => (
            r.ajustado ? r : { ...r, reparto: { ...r.reparto, [salaId]: v } }
        )));
    }, []);

    const valor = useMemo(() => ({ nombre, nota, renglones, desc, general }),
        [nombre, nota, renglones, desc, general]);

    const { recuperado, cuando, descartar, hayBorrador } = useBorrador(
        CLAVE_BORRADOR, valor, { activo: open },
    );

    const reponer = useCallback(() => {
        if (!recuperado) return;
        setNombre(recuperado.nombre || '');
        setNota(recuperado.nota || '');
        setRenglones(Array.isArray(recuperado.renglones) ? recuperado.renglones : []);
        if (recuperado.desc) setDesc((d) => ({ ...d, ...recuperado.desc }));
        if (recuperado.general) setGeneral((g) => ({ ...g, ...recuperado.general }));
        descartar();
    }, [recuperado, descartar]);

    /* Recibe una LISTA: el bloque de agregar manda todos los marcados de una
       vez. Los repetidos se descartan acá y no en el llamador — el mismo
       producto puede venir de una búsqueda y del laboratorio. */
    const agregar = (prods) => setRenglones((rs) => {
        const vistos = new Set(rs.map((r) => Number(r.erp_product_id)));
        const nuevos = (Array.isArray(prods) ? prods : [prods])
            .filter((p) => !vistos.has(Number(p.id)))
            .map((p) => renglonNuevo(p, salas, general));
        return nuevos.length ? [...rs, ...nuevos] : rs;
    });

    const cambiar = (idx, campo, v) =>
        setRenglones((rs) => rs.map((r, i) => (
            /* Tocar un renglón lo marca como ajustado, salvo abrir/cerrar su
               editor: eso no es cambiar un dato. */
            i === idx
                ? { ...r, [campo]: v, ...(campo === 'confirmado' ? {} : { ajustado: true }) }
                : r
        )));

    const cambiarReparto = (idx, salaId, v) =>
        setRenglones((rs) => rs.map((r, i) => (
            i === idx ? { ...r, reparto: { ...r.reparto, [salaId]: v } } : r
        )));

    const quitar = (idx) => setRenglones((rs) => rs.filter((_, i) => i !== idx));

    const hayEditando = renglones.some((r) => !r.confirmado);

    /* Sólo el descuento, para el caso en que la promoción ya se creó y esta
       mitad falló. Devuelve `true` si quedó. */
    const mandarDescuento = async (promoId, forzar = false) => {
        const r = await guardarDescuento({
            ...descuentoDesdeLaPromocion(renglones, desc, salas),
            descripcion: nombre.trim(),
            promocion_id: promoId,
            forzar,
        });
        if (r.avisos) {
            setAvisosDesc(r.avisos);
            return false;
        }
        setAvisosDesc([]);
        return true;
    };

    /**
     * Guarda.
     *
     * **La promoción PRIMERO y el descuento después, y el orden no es
     * arbitrario.** Al revés, si la promoción fallara quedaría un descuento
     * vivo en el sistema de ventas que nadie pidió, bajándole el precio a
     * productos reales sin que ninguna pantalla del portal lo nombre. Así, lo
     * peor que puede pasar es una promoción sin su descuento — visible,
     * corregible, y sin tocar ningún precio.
     */
    const guardar = async (forzarDescuento = false) => {
        setFallo(null);
        setGuardando(true);
        try {
            /* Si ya se creó en un intento anterior, no se vuelve a crear:
               reintentar entero dejaría dos promociones iguales. */
            if (promoCreada) {
                const ok = await mandarDescuento(promoCreada, forzarDescuento);
                if (!ok) return;
                descartar();
                onGuardada?.();
                return;
            }

            const creada = await crearPromocion({
                nombre,
                nota,
                renglones: renglones.map((r) => ({
                    erp_product_id: r.erp_product_id,
                    factor_unidades: r.factor_unidades,
                    inicio: r.inicio,
                    fin: r.fin,
                    // Vacío viaja como vacío, no como cero: la base distingue
                    // «no se sabe» de «cero», y `Number('')` daría 0.
                    lote_total: r.lote_total === '' ? null : Number(r.lote_total),
                    tiene_bono: !!r.tiene_bono,
                    paga: r.tiene_bono ? r.paga : null,
                    supplier_id: r.tiene_bono && r.paga === 'proveedor'
                        ? (r.supplier_id === '' ? null : Number(r.supplier_id))
                        : null,
                    bono_vendedor: r.tiene_bono ? Number(r.bono_vendedor) || 0 : 0,
                    bono_adm: r.tiene_bono ? Number(r.bono_adm) || 0 : 0,
                    bono_bodega: r.tiene_bono ? Number(r.bono_bodega) || 0 : 0,
                    unidades_por_bono: Number(r.unidades_por_bono) || 1,
                    reparto: Object.entries(r.reparto || {})
                        .filter(([, u]) => Number(u) > 0)
                        .map(([branch_id, u]) => ({ branch_id: Number(branch_id), unidades: Number(u) })),
                })),
            });

            if (!desc.activo) {
                descartar();
                onGuardada?.();
                return;
            }

            /* Desde acá la promoción YA EXISTE. Se recuerda para que un fallo
               del descuento no obligue a crearla de nuevo. */
            const promoId = Number(creada?.id) || null;
            setPromoCreada(promoId);
            if (!promoId) {
                setFallo('La promoción se creó pero el portal no supo con qué número, '
                    + 'así que el descuento no se pudo ligar. Créalo desde Descuentos.');
                return;
            }

            let ok = false;
            try {
                ok = await mandarDescuento(promoId, forzarDescuento);
            } catch (e) {
                /* El mensaje dice las DOS cosas: que la promoción sí quedó y que
                   el descuento no. Un «no se pudo guardar» a secas haría creer
                   que no quedó nada y llevaría a crearla otra vez. */
                setFallo(`La promoción «${nombre.trim()}» quedó creada, pero el descuento no: `
                    + `${mensajeAmigable(e, 'el sistema de ventas no lo aceptó')}. `
                    + 'Puedes reintentar sólo el descuento.');
                return;
            }
            if (!ok) return;

            descartar();
            onGuardada?.();
        } catch (e) {
            setFallo(mensajeAmigable(e, 'No se pudo crear la promoción.'));
        } finally {
            setGuardando(false);
        }
    };

    const problemasDesc = problemasDelDescuento(renglones, desc, alcanceTodo);
    const listo = nombre.trim() && renglones.length > 0 && !hayEditando
        && problemasDesc.length === 0;

    return (
        <LiquidModal open={open} onClose={onClose} maxWidth="max-w-3xl" ariaLabel="Nueva promoción">
            <LiquidModal.Header>
                <h2 className="text-body-xl font-semibold text-content">Nueva promoción</h2>
            </LiquidModal.Header>

            <LiquidModal.Body>
                <div className="space-y-4">
                    {hayBorrador && (
                        <AvisoDeBorrador cuando={cuando} onRecuperar={reponer} onDescartar={descartar} />
                    )}

                    <PortalInput
                        label="Nombre de la promoción"
                        name="nombre"
                        value={nombre}
                        onChange={(e) => setNombre(e.target.value)}
                        placeholder="El nombre que va a ver la sala"
                        required
                    />

                    {/* ── 1 · Lo que vale para TODA la promoción ──────────
                        Va arriba y se pregunta una vez. Antes esto vivía dentro
                        de cada producto, así que una promoción de doce leches
                        eran doce veces las mismas fechas y el mismo bono. */}
                    <GeneralDeLaPromocion
                        valor={general}
                        onCambiar={cambiarGeneral}
                        onReparto={cambiarRepartoGeneral}
                        salas={salas}
                        proveedores={proveedores}
                    />

                    {/* ── 2 · Además, ¿baja el precio? ────────────────────── */}
                    <DescuentoEnVentas
                        renglones={renglones}
                        salas={salas}
                        valor={desc}
                        onCambiar={cambiarDesc}
                        alcanceTodo={alcanceTodo}
                    />

                    {/* ── 3 · Los productos ──────────────────────────────── */}
                    <div className="space-y-2">
                        <p className="text-label uppercase tracking-wide font-semibold text-content-2">
                            {renglones.length
                                ? `${renglones.length} ${renglones.length === 1 ? 'producto' : 'productos'}`
                                : 'Productos'}
                        </p>

                        {renglones.map((r, i) => (r.confirmado ? (
                            <RenglonListo
                                key={r.erp_product_id}
                                r={r}
                                proveedores={proveedores}
                                onEditar={() => cambiar(i, 'confirmado', false)}
                                onQuitar={() => quitar(i)}
                            />
                        ) : (
                            <RenglonEditor
                                key={r.erp_product_id}
                                r={r}
                                salas={salas}
                                proveedores={proveedores}
                                onCambiar={(c, v) => cambiar(i, c, v)}
                                onReparto={(s, v) => cambiarReparto(i, s, v)}
                                onQuitar={() => quitar(i)}
                                onListo={() => cambiar(i, 'confirmado', true)}
                            />
                        )))}

                        {/* El bloque de agregar sólo aparece cuando no hay nada a
                            medio ajustar: ofrecer «¿otro?» con un producto abierto
                            invita a dejarlo incompleto. */}
                        {!hayEditando && (
                            <AgregarProductos
                                yaElegidos={renglones.map((r) => r.erp_product_id)}
                                laboratorios={laboratorios}
                                onAgregar={agregar}
                            />
                        )}
                    </div>

                    <PortalTextarea
                        label="Nota"
                        name="nota"
                        value={nota}
                        onChange={(e) => setNota(e.target.value)}
                        placeholder="Lo que convenga recordar de esta negociación."
                        rows={2}
                    />

                    {avisosDesc.length > 0 && (
                        <Notice variant="warning" icon={AlertTriangle}>
                            <p className="font-semibold mb-1">Antes de guardar el descuento, mira esto:</p>
                            <ul className="list-disc pl-4 space-y-0.5">
                                {avisosDesc.map((a) => <li key={a.texto}>{a.texto}</li>)}
                            </ul>
                            <p className="mt-1.5 text-caption">
                                Cuando dos descuentos toman el mismo producto en las mismas fechas,
                                la venta aplica uno solo y no dice cuál.
                            </p>
                        </Notice>
                    )}

                    {fallo && <Notice variant="danger" icon={AlertTriangle}>{fallo}</Notice>}
                </div>
            </LiquidModal.Body>

            <LiquidModal.Footer>
                <span className="text-caption text-content-3 mr-auto">
                    {hayEditando
                        ? 'Termina el producto para poder guardar.'
                        : (problemasDesc[0]
                            || (promoCreada ? 'La promoción ya quedó: falta el descuento.'
                                : 'Nace en borrador — no cuenta hasta activarla.'))}
                </span>
                <Button variant="secondary" onClick={onClose}>
                    {promoCreada ? 'Dejarlo así' : 'Cancelar'}
                </Button>
                {avisosDesc.length > 0 ? (
                    <Button variant="danger" icon={Check} loading={guardando}
                        onClick={() => guardar(true)}>
                        Guardar de todos modos
                    </Button>
                ) : (
                    <Button icon={Check} loading={guardando} disabled={!listo}
                        onClick={() => guardar(false)}>
                        {promoCreada ? 'Reintentar el descuento' : 'Guardar promoción'}
                    </Button>
                )}
            </LiquidModal.Footer>
        </LiquidModal>
    );
}

/**
 * Lo que vale para TODA la promoción: vigencia, lote y bono.
 *
 * ── Por qué está acá arriba y no dentro de cada producto (2026-09-05) ─────
 * Reportado por el usuario: «configurar la promoción general, fecha inicio,
 * fin y si tiene bono, y luego un listado de producto». El formulario
 * preguntaba producto por producto, así que una campaña de doce leches eran
 * doce veces las mismas fechas y el mismo bono — datos que en la negociación
 * se acordaron UNA vez.
 *
 * **Lo que se escribe acá se copia a cada producto al agregarlo**, y cambiarlo
 * después alcanza a los que nadie tocó. El que necesite otra cosa se abre con
 * «Ajustar» y a partir de ahí queda a salvo: pisar un ajuste hecho a mano sería
 * deshacer trabajo sin decirlo.
 */
function GeneralDeLaPromocion({ valor, onCambiar, onReparto, salas, proveedores }) {
    const unidadPago = Number(valor.unidades_por_bono) > 1
        ? `por cada ${valor.unidades_por_bono} u.`
        : 'por unidad';
    const loteNum = Number(valor.lote_total) || 0;
    const repartoPuesto = Object.values(valor.reparto || {})
        .reduce((a, v) => a + (Number(v) || 0), 0);

    return (
        <div className="rounded-lg border border-border-card bg-surface-card-hover p-3 space-y-3">
            {/* `items-start`: sin él, el grid estira cada celda al alto de la
                más alta y el campo de fecha —que mide 40px— salía de 140.
                Medido el 2026-09-05. */}
            <div className="grid gap-3 sm:grid-cols-3 items-start">
                <Campo rotulo="Empieza" falta={!valor.inicio}>
                    <LiquidDatePicker value={valor.inicio} onChange={(v) => onCambiar('inicio', v)} />
                </Campo>
                <Campo rotulo="Termina">
                    <LiquidDatePicker value={valor.fin} onChange={(v) => onCambiar('fin', v)}
                        min={valor.inicio || undefined} />
                </Campo>
                <PortalInput
                    label="Lote en unidades"
                    name="lote-general"
                    /* Puede quedar vacío: «todavía no se sabe» es un estado válido
                       —el lote se conoce cuando llega la mercadería— y la promoción
                       cuenta las ventas de sus fechas igual. */
                    value={valor.lote_total}
                    onChange={(e) => onCambiar('lote_total', e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="Se sabrá al llegar"
                />
            </div>

            {/* A qué salas va el lote. Sube acá desde el editor de cada producto
                (2026-09-05): con 50 productos, decir el reparto uno por uno son
                50 formularios — justo lo que este rediseño vino a quitar.

                Vacío = a TODAS. No es un descuido: sin reparto la promoción
                cuenta las ventas de todas las salas, que es lo que hace falta la
                mayoría de las veces. Repartir sirve para acotar cuántas unidades
                le tocan a cada una, y la base exige que la suma dé exactamente
                el lote. */}
            <div className="space-y-1">
                <span className="text-label uppercase tracking-wide font-semibold text-content-2">
                    Reparto por sala
                </span>
                <p className="text-caption text-content-3">
                    {repartoPuesto === 0
                        ? 'Sin repartir cuenta las ventas de todas las salas.'
                        : (repartoPuesto === loteNum && loteNum > 0
                            ? `Reparte las ${loteNum} unidades del lote.`
                            : `Repartes ${repartoPuesto}${loteNum ? ` de ${loteNum}` : ''} — tiene que sumar exactamente el lote.`)}
                </p>
                <div className="grid gap-2 grid-cols-2 sm:grid-cols-3">
                    {salas.map((s) => (
                        <PortalInput
                            key={s.id}
                            label={s.name}
                            name={`rep-gen-${s.id}`}
                            value={valor.reparto?.[s.id] ?? ''}
                            onChange={(e) => onReparto(s.id, e.target.value.replace(/[^0-9]/g, ''))}
                            inputMode="numeric"
                            placeholder="—"
                        />
                    ))}
                </div>
            </div>

            <Campo rotulo="¿Paga bono?">
                <LiquidSelect
                    value={valor.tiene_bono ? 'si' : 'no'}
                    onChange={(v) => onCambiar('tiene_bono', v === 'si')}
                    options={[
                        { value: 'si', label: 'Sí, paga por unidad vendida' },
                        { value: 'no', label: 'No — sólo mide las ventas' },
                    ]}
                    clearable={false}
                    ariaLabel="¿Paga bono?"
                />
            </Campo>

            {valor.tiene_bono && (
                <>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Campo rotulo="¿Quién lo cancela?">
                            <LiquidSelect
                                value={valor.paga}
                                onChange={(v) => onCambiar('paga', v)}
                                options={[
                                    { value: 'proveedor', label: 'Un proveedor' },
                                    { value: 'empresa', label: 'La empresa' },
                                ]}
                                clearable={false}
                                ariaLabel="Quién paga el bono"
                            />
                        </Campo>
                        {valor.paga === 'proveedor' && (
                            <Campo rotulo="Proveedor" falta={!valor.supplier_id}>
                                <LiquidSelect
                                    value={String(valor.supplier_id || '')}
                                    onChange={(v) => onCambiar('supplier_id', v || '')}
                                    options={proveedores}
                                    placeholder="¿Quién emite la nota de crédito?"
                                    ariaLabel="Proveedor que paga"
                                />
                            </Campo>
                        )}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-4">
                        <PortalInput label={`Vendedor ${unidadPago}`} name="bv-general"
                            value={valor.bono_vendedor} prefix="$"
                            onChange={(e) => onCambiar('bono_vendedor', e.target.value.replace(/[^0-9.]/g, ''))} />
                        <PortalInput label="Fondo admón." name="ba-general"
                            value={valor.bono_adm} prefix="$"
                            onChange={(e) => onCambiar('bono_adm', e.target.value.replace(/[^0-9.]/g, ''))} />
                        <PortalInput label="Fondo bodega" name="bb-general"
                            value={valor.bono_bodega} prefix="$"
                            onChange={(e) => onCambiar('bono_bodega', e.target.value.replace(/[^0-9.]/g, ''))} />
                        <PortalInput label="Cada cuántas u." name="upb-general"
                            value={valor.unidades_por_bono}
                            onChange={(e) => onCambiar('unidades_por_bono', e.target.value.replace(/[^0-9]/g, ''))} />
                    </div>
                </>
            )}
        </div>
    );
}

/** Un producto ya confirmado: una línea, no un formulario abierto. */
function RenglonListo({ r, proveedores, onEditar, onQuitar }) {
    const prov = proveedores.find((p) => p.value === String(r.supplier_id))?.label;
    return (
        <div className="rounded-lg border border-border-card bg-surface-card-hover px-3 py-2.5
                        flex items-center gap-2">
            <Check size={15} className="text-success shrink-0" />
            <div className="flex-1 min-w-0">
                <p className="text-body-sm font-semibold text-content truncate">{r.producto}</p>
                <p className="text-caption text-content-3 truncate">
                    {r.lote_total ? `Lote ${fmtUnidades(r.lote_total)} · ` : 'Sin lote · '}
                    {r.tiene_bono
                        ? `$${r.bono_vendedor} · paga ${r.paga === 'empresa' ? 'la empresa' : (prov || 'un proveedor')}`
                        : 'sólo mide, no paga bono'}
                </p>
            </div>
            <Button variant="ghost" size="sm" iconOnly icon={Pencil} onClick={onEditar} title="Editar" />
            <Button variant="ghost" size="sm" iconOnly icon={Trash2} onClick={onQuitar} title="Quitar" />
        </div>
    );
}

/**
 * El rótulo de un control que no trae el suyo — `LiquidSelect` y
 * `LiquidDatePicker` no llevan etiqueta y `PortalInput` sí. Mezclarlos en una
 * fila sin esto deja las columnas arrancando a alturas distintas.
 */
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

function RenglonEditor({ r, salas, proveedores, onCambiar, onReparto, onQuitar, onListo }) {
    const [presentaciones, setPresentaciones] = useState([]);

    useEffect(() => {
        fetchPresentacionesDeProducto(r.erp_product_id)
            .then((p) => setPresentaciones(p || []))
            .catch(() => setPresentaciones([]));
    }, [r.erp_product_id]);

    const opcionesPres = useMemo(() => ([
        { value: '', label: 'Cualquier presentación' },
        ...presentaciones.map((p) => ({ value: String(p.factor), label: `${p.etiqueta} · ×${p.factor}` })),
    ]), [presentaciones]);

    const etiquetaPres = presentaciones
        .find((p) => String(p.factor) === String(r.factor_unidades))?.etiqueta;

    const suma = Object.values(r.reparto || {}).reduce((a, u) => a + (Number(u) || 0), 0);
    const lote = Number(r.lote_total) || 0;
    const hayLote = r.lote_total !== '' && lote > 0;
    // El reparto sólo tiene que cuadrar si alguien empezó a repartir. Sin lote y
    // sin reparto, la promoción mide y ya.
    const repartoOk = suma === 0 || (hayLote && suma === lote);

    const unidadPago = r.factor_unidades == null
        ? '$/unidad'
        : `$/${(etiquetaPres || 'presentación').split(' ')[0].toLowerCase()}`;

    const puedeConfirmar = !!r.fin
        && repartoOk
        && (!r.tiene_bono || r.paga === 'empresa' || (r.paga === 'proveedor' && !!r.supplier_id));

    return (
        <div className="rounded-lg border border-border-card bg-surface-card p-3 space-y-3">
            <div className="flex items-center gap-2">
                <span className="flex-1 min-w-0 truncate text-body-sm font-semibold text-content">
                    {r.producto}
                </span>
                <span className="text-micro uppercase text-content-3 shrink-0">{r.laboratorio}</span>
                <Button variant="ghost" size="sm" iconOnly icon={Trash2}
                    onClick={onQuitar} title="Quitar producto" />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
                <Campo rotulo="Presentación">
                    <LiquidSelect
                        value={r.factor_unidades == null ? '' : String(r.factor_unidades)}
                        onChange={(v) => onCambiar('factor_unidades', v === '' ? null : Number(v))}
                        options={opcionesPres}
                        clearable={false}
                        ariaLabel="Presentación"
                    />
                </Campo>
                <Campo rotulo="Lote en unidades">
                    <PortalInput
                        name={`lote-${r.erp_product_id}`}
                        value={r.lote_total}
                        onChange={(e) => onCambiar('lote_total', e.target.value)}
                        inputMode="numeric"
                        placeholder="Vacío si todavía no se sabe"
                    />
                </Campo>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
                <Campo rotulo="Empieza">
                    <LiquidDatePicker value={r.inicio} onChange={(v) => onCambiar('inicio', v)} />
                </Campo>
                <Campo rotulo="Termina" falta={!r.fin}>
                    <LiquidDatePicker value={r.fin} onChange={(v) => onCambiar('fin', v)} />
                </Campo>
            </div>

            <div className="rounded-lg bg-surface-card-hover p-2.5 space-y-3">
                <Campo rotulo="¿Este producto paga bono?">
                    <LiquidSelect
                        value={r.tiene_bono ? 'si' : 'no'}
                        onChange={(v) => onCambiar('tiene_bono', v === 'si')}
                        options={[
                            { value: 'si', label: 'Sí, paga por unidad vendida' },
                            { value: 'no', label: 'No — sólo medir cuánto se vende' },
                        ]}
                        clearable={false}
                        ariaLabel="Paga bono"
                    />
                </Campo>

                {/* Sin bono no se pregunta nada más: ni montos ni quién paga. Un
                    formulario que pide datos que no aplican invita a llenarlos,
                    y después alguien cobra lo que nadie acordó. */}
                {r.tiene_bono && (
                    <>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <Campo rotulo="¿Quién lo cancela?">
                                <LiquidSelect
                                    value={r.paga || ''}
                                    onChange={(v) => onCambiar('paga', v)}
                                    options={[
                                        { value: 'empresa',   label: 'La empresa' },
                                        { value: 'proveedor', label: 'Un proveedor' },
                                    ]}
                                    clearable={false}
                                    ariaLabel="Quién paga el bono"
                                />
                            </Campo>
                            {r.paga === 'proveedor' && (
                                <Campo rotulo="Proveedor" falta={!r.supplier_id}>
                                    <LiquidSelect
                                        value={String(r.supplier_id || '')}
                                        onChange={(v) => onCambiar('supplier_id', v)}
                                        options={proveedores}
                                        placeholder="Elige el proveedor"
                                        clearable={false}
                                       
                                        ariaLabel="Proveedor que paga"
                                    />
                                </Campo>
                            )}
                        </div>

                        <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
                            <PortalInput label={`Vendedor ${unidadPago}`} name={`bv-${r.erp_product_id}`}
                                value={r.bono_vendedor} onChange={(e) => onCambiar('bono_vendedor', e.target.value)}
                                inputMode="decimal" />
                            <PortalInput label="Fondo admón." name={`ba-${r.erp_product_id}`}
                                value={r.bono_adm} onChange={(e) => onCambiar('bono_adm', e.target.value)}
                                inputMode="decimal" />
                            <PortalInput label="Fondo bodega" name={`bb-${r.erp_product_id}`}
                                value={r.bono_bodega} onChange={(e) => onCambiar('bono_bodega', e.target.value)}
                                inputMode="decimal" />
                        </div>
                    </>
                )}
            </div>

            {/* El reparto sólo aparece si hay lote que repartir: sin lote no hay
                nada que dividir, y seis campos vacíos parecen obligatorios. */}
            {hayLote && (
                <div>
                    <div className="flex items-baseline gap-2 mb-1.5 flex-wrap">
                        <span className="text-label uppercase tracking-wide text-content-3 font-semibold">
                            Reparto por sala
                        </span>
                        <span className="text-caption text-content-3">opcional</span>
                        <span className="flex-1" />
                        {suma > 0 && (
                            <Badge variant={repartoOk ? 'success' : 'warning'} size="sm">
                                {fmtUnidades(suma)} de {fmtUnidades(lote)}
                            </Badge>
                        )}
                    </div>
                    <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
                        {salas.map((s) => (
                            <PortalInput
                                key={s.id}
                                label={s.name}
                                name={`rep-${r.erp_product_id}-${s.id}`}
                                value={r.reparto?.[s.id] ?? ''}
                                onChange={(e) => onReparto(s.id, e.target.value)}
                                inputMode="numeric"
                               
                            />
                        ))}
                    </div>
                    {!repartoOk && (
                        <p className="text-caption text-warning-text mt-1.5">
                            Si repartes, tiene que sumar exactamente el lote — si no, alguna sala
                            vendería contra un número que no es suyo. Déjalo todo vacío para no repartir.
                        </p>
                    )}
                </div>
            )}

            <p className="text-caption text-content-3">
                {r.factor_unidades == null
                    ? 'Cuenta cualquier presentación'
                    : `Sólo cuentan las ventas hechas como ${rotuloPresentacion(r.factor_unidades, etiquetaPres)}`}
                {r.lote_total === '' && ' · sin lote, sólo mide las ventas de esas fechas'}
                {'.'}
            </p>

            <Button icon={Check} size="sm" disabled={!puedeConfirmar} onClick={onListo}>
                Guardar producto
            </Button>
        </div>
    );
}
