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
} from '../../data/promociones';
import { mensajeAmigable } from '../../utils/errorMessages';
import { hoySV, fmtUnidades, rotuloPresentacion } from './promocionesUtils';

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

const renglonNuevo = (prod, salas) => ({
    erp_product_id: prod.id,
    producto: prod.nombre,
    laboratorio: prod.laboratorio_nombre || 'Sin laboratorio',
    factor_unidades: null,
    inicio: hoySV(),
    fin: '',
    // Vacío a propósito: «todavía no se sabe» es un estado válido y se puede
    // guardar así. La promoción cuenta las ventas de sus fechas igual.
    lote_total: '',
    tiene_bono: true,
    paga: 'proveedor',
    supplier_id: '',
    bono_vendedor: '1.00',
    bono_adm: '0.25',
    bono_bodega: '0.25',
    unidades_por_bono: '1',
    reparto: Object.fromEntries(salas.map((s) => [s.id, ''])),
    confirmado: false,
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
    const [guardando, setGuardando] = useState(false);
    const [fallo, setFallo] = useState(null);
    const [proveedores, setProveedores] = useState([]);

    useEffect(() => {
        if (!open) return;
        fetchProveedoresDelSistema().then(setProveedores).catch(() => setProveedores([]));
    }, [open]);

    const valor = useMemo(() => ({ nombre, nota, renglones }), [nombre, nota, renglones]);

    const { recuperado, cuando, descartar, hayBorrador } = useBorrador(
        CLAVE_BORRADOR, valor, { activo: open },
    );

    const reponer = useCallback(() => {
        if (!recuperado) return;
        setNombre(recuperado.nombre || '');
        setNota(recuperado.nota || '');
        setRenglones(Array.isArray(recuperado.renglones) ? recuperado.renglones : []);
        descartar();
    }, [recuperado, descartar]);

    const agregar = (prod) => setRenglones((rs) => (
        rs.some((r) => r.erp_product_id === prod.id) ? rs : [...rs, renglonNuevo(prod, salas)]
    ));

    const cambiar = (idx, campo, v) =>
        setRenglones((rs) => rs.map((r, i) => (i === idx ? { ...r, [campo]: v } : r)));

    const cambiarReparto = (idx, salaId, v) =>
        setRenglones((rs) => rs.map((r, i) => (
            i === idx ? { ...r, reparto: { ...r.reparto, [salaId]: v } } : r
        )));

    const quitar = (idx) => setRenglones((rs) => rs.filter((_, i) => i !== idx));

    const hayEditando = renglones.some((r) => !r.confirmado);

    const guardar = async () => {
        setFallo(null);
        setGuardando(true);
        try {
            await crearPromocion({
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
            descartar();
            onGuardada?.();
        } catch (e) {
            setFallo(mensajeAmigable(e, 'No se pudo crear la promoción.'));
        } finally {
            setGuardando(false);
        }
    };

    const listo = nombre.trim() && renglones.length > 0 && !hayEditando;

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

                    {/* El buscador sólo aparece cuando no hay nada a medio
                        llenar: preguntar «¿hay otro?» con un producto sin
                        terminar invita a dejarlo incompleto. */}
                    {!hayEditando && (
                        <div className="max-h-56 flex flex-col">
                            <BuscadorDeProducto
                                key={renglones.length}
                                onElegir={agregar}
                                placeholder={renglones.length
                                    ? 'Agregar otro producto…'
                                    : 'Buscar el producto de la promoción…'}
                                invitacion={{
                                    icono: renglones.length ? Plus : Tag,
                                    texto: renglones.length
                                        ? '¿Hay otro producto? Búscalo, o guarda la promoción'
                                        : 'Busca el producto que entra en la promoción',
                                }}
                            />
                        </div>
                    )}

                    <PortalTextarea
                        label="Nota"
                        name="nota"
                        value={nota}
                        onChange={(e) => setNota(e.target.value)}
                        placeholder="Lo que convenga recordar de esta negociación."
                        rows={2}
                    />

                    {fallo && <Notice variant="danger" icon={AlertTriangle}>{fallo}</Notice>}
                </div>
            </LiquidModal.Body>

            <LiquidModal.Footer>
                <span className="text-caption text-content-3 mr-auto">
                    {hayEditando
                        ? 'Termina el producto para poder guardar.'
                        : 'Nace en borrador — no cuenta hasta activarla.'}
                </span>
                <Button variant="secondary" onClick={onClose}>Cancelar</Button>
                <Button icon={Check} loading={guardando} disabled={!listo} onClick={guardar}>
                    Guardar promoción
                </Button>
            </LiquidModal.Footer>
        </LiquidModal>
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
        <div className="flex flex-col gap-1 min-w-0">
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
