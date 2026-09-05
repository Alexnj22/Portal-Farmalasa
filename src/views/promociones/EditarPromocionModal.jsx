import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Trash2, CalendarPlus, DollarSign, Percent } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import LiquidSelect from '../../components/common/LiquidSelect';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import PortalInput from '../../components/common/PortalInput';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import ConfirmModal from '../../components/common/ConfirmModal';
import { LoadingState } from '../../components/common/StateViews';
import {
    fetchPromocion, fetchPresentacionesDeProducto, fetchProveedoresDelSistema,
    editarRenglon, editarTarifaRenglon, extenderRenglon,
    quitarRenglon, borrarPromocion,
} from '../../data/promociones';
import { guardarDescuento } from '../../data/descuentos';
import { mensajeAmigable } from '../../utils/errorMessages';
import { useStaffStore } from '../../store/staffStore';
import { SALAS_VENTA } from '../metas/metasUtils';
import { fmtUnidades, fmtVigencia, MOTIVO_CIERRE, descuentoDesdeLaPromocion } from './promocionesUtils';
import DescuentoEnVentas from './DescuentoEnVentas';
import Campo from './Campo';

/**
 * Corregir una promoción ya creada.
 *
 * ── Por qué hay DOS caminos y no un «guardar» único ─────────────────────────
 * No todo lo de un renglón se corrige igual, y meterlo todo en un botón haría
 * invisible la diferencia:
 *
 *   · el **lote**, la **presentación**, **quién paga** y el **reparto** son
 *     declaraciones sobre el acuerdo. Corregirlas es retroactivo a propósito:
 *     el cálculo vuelve a leer las ventas con el dato bueno.
 *   · los **montos** ya se ganaron. Cambiarlos NO reescribe el pasado: la base
 *     agrega una tarifa con su fecha y cada venta se paga con la que regía ese
 *     día. Por eso van por su propio botón, que dice desde cuándo rige.
 *
 * Mezclarlos dejaría a alguien creyendo que subir el monto le paga de más a lo
 * ya vendido, o que corregir el lote no toca lo ya contado.
 */
export default function EditarPromocionModal({ promocionId, open, onClose, onCambio }) {
    const branches = useStaffStore((s) => s.branches);
    const salas = useMemo(
        () => SALAS_VENTA.map((id) => (branches || []).find((b) => Number(b.id) === id)).filter(Boolean),
        [branches],
    );

    const [promo, setPromo] = useState(null);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState(null);
    const [fallo, setFallo] = useState(null);
    const [proveedores, setProveedores] = useState([]);
    const [recarga, setRecarga] = useState(0);
    const [borrando, setBorrando] = useState(false);

    /* El descuento en la venta, para las promociones que todavía no lo tienen —
       una duplicada, por ejemplo. Nace apagado: entrar a corregir el lote no
       puede terminar bajando un precio sin que nadie lo haya pedido. */
    const [desc, setDesc] = useState({
        activo: false, tipo: '%', monto: '', todas: true, branchId: '', finPropio: '',
    });
    const [avisosDesc, setAvisosDesc] = useState([]);
    const [mandando, setMandando] = useState(false);

    const recargar = useCallback(() => {
        setRecarga((n) => n + 1);
        onCambio?.();
    }, [onCambio]);

    useEffect(() => {
        if (!open) return;
        fetchProveedoresDelSistema().then(setProveedores).catch(() => setProveedores([]));
    }, [open]);

    useEffect(() => {
        if (!open || !promocionId) return undefined;
        let vivo = true;
        setCargando(true);
        setError(null);
        fetchPromocion(promocionId)
            .then((d) => { if (vivo) setPromo(d); })
            .catch((e) => { if (vivo) setError(e); })
            .finally(() => { if (vivo) setCargando(false); });
        return () => { vivo = false; };
    }, [open, promocionId, recarga]);

    /* Las salas donde aplica, con la forma que espera `DescuentoEnVentas`:
       `{ [branchId]: true }`. Salen del reparto que devuelve la ficha — no se
       vuelven a preguntar, porque dos respuestas para la misma cosa terminan
       diciendo cosas distintas. Vacío = todas. */
    const salasDeLaPromocion = useMemo(
        () => Object.fromEntries((promo?.salas ?? []).map((id) => [Number(id), true])),
        [promo],
    );

    /**
     * Crea el descuento en el sistema de ventas para una promoción que ya
     * existe.
     *
     * Es la MISMA cuenta que al crearla —una sola llamada, porque allá un
     * descuento vale para una sala o para todas y nunca para un conjunto— y por
     * eso el cuerpo sale de `descuentoDesdeLaPromocion`, que vive una vez.
     */
    const crearDescuento = async (forzar = false) => {
        setFallo(null);
        setMandando(true);
        try {
            const marcadas = salas.filter((x) => salasDeLaPromocion[x.id]);
            const unaSola = marcadas.length === 1 ? marcadas[0] : null;
            const todas = unaSola ? false : (marcadas.length === 0 ? true : !!desc.todas);
            const branchId = unaSola
                ? unaSola.id
                : (todas ? (salas[0]?.id ?? null) : Number(desc.branchId) || null);

            const r2 = await guardarDescuento({
                ...descuentoDesdeLaPromocion(promo.renglones ?? [], desc),
                descripcion: (promo.nombre || '').trim(),
                todas_las_salas: todas,
                branch_id: branchId,
                promocion_id: promocionId,
                forzar,
            });
            if (r2.avisos) { setAvisosDesc(r2.avisos); return; }
            setAvisosDesc([]);
            setDesc((x) => ({ ...x, activo: false }));
            recargar();
        } catch (e) {
            setFallo(mensajeAmigable(e, 'No se pudo crear el descuento.'));
        } finally {
            setMandando(false);
        }
    };

    const borrar = async () => {
        setFallo(null);
        try {
            await borrarPromocion(promocionId);
            setBorrando(false);
            onCambio?.();
            onClose?.();
        } catch (e) {
            setBorrando(false);
            setFallo(mensajeAmigable(e, 'No se pudo borrar la promoción.'));
        }
    };

    return (
        <LiquidModal open={open} onClose={onClose} maxWidth="max-w-3xl" ariaLabel="Editar promoción">
            <LiquidModal.Header>
                <div className="min-w-0">
                    <h2 className="text-body-xl font-semibold text-content truncate">
                        {promo?.nombre || 'Editar promoción'}
                    </h2>
                    {promo && (
                        <p className="text-caption text-content-3">
                            {fmtVigencia(promo.inicio, promo.fin)} · {promo.estado}
                        </p>
                    )}
                </div>
            </LiquidModal.Header>

            <LiquidModal.Body>
                {cargando && <LoadingState label="Cargando la promoción…" />}

                {error && (
                    <Notice variant="danger" icon={AlertTriangle}>
                        {error.code === '42501'
                            ? 'Tu cargo todavía no tiene el módulo de Promociones.'
                            : (error.message || 'No se pudo cargar la promoción.')}
                    </Notice>
                )}

                {!cargando && !error && promo && (
                    <div className="space-y-4">
                        {fallo && <Notice variant="danger" icon={AlertTriangle}>{fallo}</Notice>}

                        <Notice variant="info" compact>
                            Corregir el <span className="font-semibold">lote</span>, la{' '}
                            <span className="font-semibold">presentación</span> o el{' '}
                            <span className="font-semibold">reparto</span> vuelve a contar las ventas
                            con el dato bueno. Cambiar los <span className="font-semibold">montos</span>{' '}
                            no reescribe lo ya ganado: rige desde el día del cambio.
                        </Notice>

                        {(promo.renglones ?? []).map((r) => (
                            <RenglonEditable
                                key={r.id}
                                r={r}
                                salas={salas}
                                proveedores={proveedores}
                                onCambio={recargar}
                                onFallo={setFallo}
                            />
                        ))}

                        {/* ── El descuento en la venta ─────────────────────
                            Vive acá porque si no, no vive en ningún lado: al
                            crear la promoción se ofrece, y una promoción
                            DUPLICADA nace sin él a propósito. Sin esta sección,
                            una copia no podía tener descuento nunca — el aviso
                            del duplicado decía «se le agrega desde su propia
                            ficha» y la ficha no tenía dónde.

                            Y si ya tiene, no se ofrece otro: el sistema de
                            ventas admite UNO por producto y ventana de fechas en
                            toda la cadena, así que el segundo se rechazaría. */}
                        {(promo.renglones ?? []).length > 0 && (
                            promo.descuentos > 0 ? (
                                <Notice variant="success" icon={Percent} compact>
                                    Esta promoción <span className="font-semibold">baja el precio
                                    en la venta</span>. Se corrige desde la pestaña{' '}
                                    <span className="font-semibold">Descuentos</span>.
                                </Notice>
                            ) : (
                                <div className="space-y-3">
                                    <DescuentoEnVentas
                                        renglones={promo.renglones}
                                        salas={salas}
                                        valor={desc}
                                        onCambiar={(campo, v) => setDesc((x) => ({ ...x, [campo]: v }))}
                                        salasDeLaPromocion={salasDeLaPromocion}
                                    />

                                    {/* Confirmación, no informe: la lista de
                                        arriba ya dice en cuánto queda cada uno. */}
                                    {avisosDesc.length > 0 && (
                                        <Notice variant="warning" icon={AlertTriangle}>
                                            {avisosDesc.length === 1 ? (
                                                <p>{avisosDesc[0].texto}</p>
                                            ) : (
                                                <ul className="list-disc pl-4 space-y-0.5">
                                                    {avisosDesc.map((a) => <li key={a.texto}>{a.texto}</li>)}
                                                </ul>
                                            )}
                                            {avisosDesc.some((a) => a.tipo === 'solape') && (
                                                <p className="mt-1.5 text-caption">
                                                    Cuando dos descuentos toman el mismo producto en las
                                                    mismas fechas, la venta aplica uno solo y no dice cuál.
                                                </p>
                                            )}
                                        </Notice>
                                    )}

                                    {desc.activo && (
                                        <Button
                                            variant={avisosDesc.length > 0 ? 'danger' : 'primary'}
                                            icon={Check}
                                            loading={mandando}
                                            disabled={!(Number(desc.monto) > 0)}
                                            onClick={() => crearDescuento(avisosDesc.length > 0)}
                                            className="w-full"
                                        >
                                            {avisosDesc.length > 0
                                                ? 'Crear el descuento de todos modos'
                                                : 'Crear el descuento'}
                                        </Button>
                                    )}
                                </div>
                            )
                        )}
                    </div>
                )}
            </LiquidModal.Body>

            <LiquidModal.Footer>
                {promo?.estado === 'borrador' && (
                    <Button variant="destructive" icon={Trash2} className="mr-auto"
                        onClick={() => setBorrando(true)}>
                        Borrar promoción
                    </Button>
                )}
                <Button variant="secondary" onClick={onClose}>Cerrar</Button>
            </LiquidModal.Footer>

            <ConfirmModal
                isOpen={borrando}
                onClose={() => setBorrando(false)}
                onConfirm={borrar}
                title="Borrar la promoción"
                message={`«${promo?.nombre}» se borra con todos sus productos. Sólo se puede porque sigue en borrador: una que ya corrió es historia y no se borra.`}
                confirmText="Borrar"
                isDestructive
            />
        </LiquidModal>
    );
}

function RenglonEditable({ r, salas, proveedores, onCambio, onFallo }) {
    const [presentaciones, setPresentaciones] = useState([]);
    const [ocupado, setOcupado] = useState(null);

    // Lo declarado: se corrige y vuelve a contar.
    const [lote, setLote] = useState(r.lote_total ?? '');
    const [factor, setFactor] = useState(r.factor_unidades == null ? '' : String(r.factor_unidades));
    const [tieneBono, setTieneBono] = useState(!!r.tiene_bono);
    const [paga, setPaga] = useState(r.paga || 'proveedor');
    const [prov, setProv] = useState('');
    const [reparto, setReparto] = useState(() => Object.fromEntries(
        salas.map((s) => {
            const fila = (r.reparto || []).find((x) => Number(x.branch_id) === Number(s.id));
            return [s.id, fila ? String(fila.asignado_vigente) : ''];
        }),
    ));

    // Los montos: van con fecha y no reescriben el pasado.
    const [bv, setBv] = useState(String(r.bono_vendedor ?? '0'));
    const [ba, setBa] = useState(String(r.bono_adm ?? '0'));
    const [bb, setBb] = useState(String(r.bono_bodega ?? '0'));
    const [fin, setFin] = useState(r.fin || '');

    useEffect(() => {
        fetchPresentacionesDeProducto(r.erp_product_id)
            .then((p) => setPresentaciones(p || []))
            .catch(() => setPresentaciones([]));
    }, [r.erp_product_id]);

    const opcionesPres = useMemo(() => ([
        { value: '', label: 'Cualquier presentación' },
        ...presentaciones.map((p) => ({ value: String(p.factor), label: `${p.etiqueta} · ×${p.factor}` })),
    ]), [presentaciones]);

    const correr = async (clave, fn) => {
        setOcupado(clave);
        onFallo(null);
        try { await fn(); onCambio(); }
        catch (e) { onFallo(mensajeAmigable(e, 'No se pudo guardar el cambio.')); }
        finally { setOcupado(null); }
    };

    const sumaReparto = Object.values(reparto).reduce((a, u) => a + (Number(u) || 0), 0);

    return (
        <div className="rounded-lg border border-border-card bg-surface-card p-3 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
                <span className="flex-1 min-w-0 truncate text-body-sm font-semibold text-content">
                    {r.producto}
                </span>
                {r.estado === 'cerrado' && (
                    <Badge variant="neutral" size="sm">
                        {MOTIVO_CIERRE[r.cerrado_motivo] || 'Terminado'}
                    </Badge>
                )}
                <Button variant="ghost" size="sm" iconOnly icon={Trash2} title="Quitar de la promoción"
                    loading={ocupado === 'quitar'}
                    onClick={() => correr('quitar', () => quitarRenglon(r.id))} />
            </div>

            <p className="text-caption text-content-3 tabular-nums">
                Lleva <span className="text-content font-semibold">{fmtUnidades(r.vendido_base)}</span> unidades
                {r.lote_total ? ` de ${fmtUnidades(r.lote_total)}` : ' · sin lote declarado'}
            </p>

            {/* ── Lo declarado ─────────────────────────────────────────────── */}
            <div className="grid gap-3 sm:grid-cols-2">
                <Campo rotulo="Presentación">
                    <LiquidSelect value={factor} onChange={setFactor} options={opcionesPres}
                        clearable={false} ariaLabel="Presentación" />
                </Campo>
                <Campo rotulo="Lote en unidades">
                    <PortalInput name={`e-lote-${r.id}`} value={lote}
                        onChange={(e) => setLote(e.target.value)}
                        inputMode="numeric" placeholder="Vacío si no se sabe" />
                </Campo>
            </div>

            <Campo rotulo="¿Paga bono?">
                <LiquidSelect
                    value={tieneBono ? 'si' : 'no'}
                    onChange={(v) => setTieneBono(v === 'si')}
                    options={[
                        { value: 'si', label: 'Sí, paga por unidad vendida' },
                        { value: 'no', label: 'No — sólo medir cuánto se vende' },
                    ]}
                    clearable={false} ariaLabel="Paga bono" />
            </Campo>

            {tieneBono && (
                <div className="grid gap-3 sm:grid-cols-2">
                    <Campo rotulo="¿Quién lo cancela?">
                        <LiquidSelect value={paga} onChange={setPaga}
                            options={[
                                { value: 'empresa',   label: 'La empresa' },
                                { value: 'proveedor', label: 'Un proveedor' },
                            ]}
                            clearable={false} ariaLabel="Quién paga" />
                    </Campo>
                    {paga === 'proveedor' && (
                        <Campo rotulo="Proveedor">
                            <LiquidSelect value={prov} onChange={setProv} options={proveedores}
                                placeholder={r.proveedor || 'Elige el proveedor'}
                                clearable={false} ariaLabel="Proveedor" />
                        </Campo>
                    )}
                </div>
            )}



            {/* ── El reparto ───────────────────────────────────────────────── */}
            {lote !== '' && Number(lote) > 0 && (
                <div className="pt-2 border-t border-border-muted">
                    <div className="flex items-baseline gap-2 mb-1.5 flex-wrap">
                        <span className="text-label uppercase tracking-wide text-content-3 font-semibold">
                            Reparto por sala
                        </span>
                        <span className="flex-1" />
                        {sumaReparto > 0 && (
                            <Badge variant={sumaReparto === Number(lote) ? 'success' : 'warning'} size="sm">
                                {fmtUnidades(sumaReparto)} de {fmtUnidades(lote)}
                            </Badge>
                        )}
                    </div>
                    <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
                        {salas.map((s) => (
                            <PortalInput key={s.id} label={s.name} name={`e-rep-${r.id}-${s.id}`}
                                value={reparto[s.id] ?? ''}
                                onChange={(e) => setReparto((x) => ({ ...x, [s.id]: e.target.value }))}
                                inputMode="numeric" />
                        ))}
                    </div>

                </div>
            )}

            {/* Un solo botón para el lote, la presentación y el reparto: la
                base los valida juntos y ofrecerlos por separado dejaba un
                candado sin llave — bajar el lote pedía arreglar el reparto, y
                el reparto no se podía cambiar por no cuadrar con el lote viejo. */}
            <Button size="sm" icon={Check} loading={ocupado === 'declarado'}
                onClick={() => correr('declarado', () => editarRenglon({
                    renglonId: r.id,
                    loteTotal: lote === '' ? null : lote,
                    factorUnidades: factor === '' ? null : factor,
                    tieneBono,
                    paga: tieneBono ? paga : null,
                    supplierId: prov || null,
                    borrarLote: lote === '',
                    cualquierPresentacion: factor === '',
                    reparto: Object.entries(reparto)
                        .filter(([, u]) => Number(u) > 0)
                        .map(([b, u]) => ({ branch_id: Number(b), unidades: Number(u) })),
                }))}>
                Guardar lote, presentación y reparto
            </Button>

            {/* ── Lo que NO reescribe el pasado ────────────────────────────── */}
            <div className="pt-2 border-t border-border-muted space-y-3">
                <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
                    <PortalInput label="Vendedor" name={`e-bv-${r.id}`} value={bv}
                        onChange={(e) => setBv(e.target.value)} inputMode="decimal" />
                    <PortalInput label="Fondo admón." name={`e-ba-${r.id}`} value={ba}
                        onChange={(e) => setBa(e.target.value)} inputMode="decimal" />
                    <PortalInput label="Fondo bodega" name={`e-bb-${r.id}`} value={bb}
                        onChange={(e) => setBb(e.target.value)} inputMode="decimal" />
                </div>
                <p className="text-caption text-content-3">
                    Los montos nuevos rigen <span className="font-semibold">desde hoy</span>. Lo vendido
                    antes se sigue pagando con el monto que regía ese día.
                </p>
                <Button size="sm" variant="secondary" icon={DollarSign} loading={ocupado === 'tarifa'}
                    onClick={() => correr('tarifa', () => editarTarifaRenglon({
                        renglonId: r.id, bonoVendedor: bv, bonoAdm: ba, bonoBodega: bb,
                    }))}>
                    Guardar montos desde hoy
                </Button>
            </div>

            {/* ── La fecha ─────────────────────────────────────────────────── */}
            <div className="pt-2 border-t border-border-muted">
                <Campo rotulo="Termina">
                    <LiquidDatePicker value={fin} onChange={setFin} />
                </Campo>
                <p className="text-caption text-content-3 mt-1.5">
                    Extender un producto extiende la promoción. Un producto que cerró porque se
                    acabó el lote no se reabre moviendo la fecha.
                </p>
                <Button size="sm" variant="secondary" icon={CalendarPlus} className="mt-2"
                    disabled={!fin || fin === r.fin} loading={ocupado === 'fin'}
                    onClick={() => correr('fin', () => extenderRenglon(r.id, fin))}>
                    Guardar la fecha
                </Button>
            </div>
        </div>
    );
}

