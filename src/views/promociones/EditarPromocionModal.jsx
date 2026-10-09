import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Trash2, CalendarPlus, DollarSign, Percent, BellOff, ShieldCheck, Store, ChevronDown } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import LiquidSelect from '../../components/common/LiquidSelect';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import PortalInput from '../../components/common/PortalInput';
import Button from '../../components/common/Button';
import PieDeModal from '../../components/common/PieDeModal';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import ConfirmModal from '../../components/common/ConfirmModal';
import { LoadingState } from '../../components/common/StateViews';
import {
    fetchPromocion, fetchPresentacionesDeProducto, fetchProveedoresDelSistema,
    fetchLaboratoriosConProductos, agregarRenglonesAPromocion,
    editarRenglon, editarTarifaRenglon, extenderRenglon,
    quitarRenglon, borrarPromocion, fetchResumenDePromocion, ajustarResumenPromocion,
} from '@nucleo/data/promociones';
import { guardarDescuento, sincronizarProductosDelDescuento } from '@nucleo/data/descuentos';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { useStaffStore } from '@nucleo/store/staffStore';
import { SALAS_VENTA } from '@nucleo/utils/metasUtils';
import { fmtUnidades, fmtVigencia, MOTIVO_CIERRE, descuentoDesdeLaPromocion, estadoVisible, mensajeDeCarga, numeroEscrito, renglonesParaAgregar, OPCIONES_RESUMEN_DIARIO, alternarResumen, resumenElegido } from '@nucleo/utils/promocionesUtils';
import DescuentoEnVentas from './DescuentoEnVentas';
import AgregarProductos from './AgregarProductos';
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
    const [laboratorios, setLaboratorios] = useState([]);
    const [agregando, setAgregando] = useState(false);
    /* Lo que está esperando la respuesta de «¿también en el descuento?».
       `{ tipo: 'agregar'|'quitar', prods, renglon }` — se guarda entero porque
       la acción se ejecuta DESPUÉS de contestar, y para entonces el clic ya
       pasó. */
    const [pendiente, setPendiente] = useState(null);
    const [sincronizando, setSincronizando] = useState(false);
    const [avisoSync, setAvisoSync] = useState(null);
    const [recarga, setRecarga] = useState(0);
    const [borrando, setBorrando] = useState(false);
    const [borrandoYa, setBorrandoYa] = useState(false);
    const [aQuitar, setAQuitar] = useState(null);      // renglón a quitar (sin descuento)

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
        fetchLaboratoriosConProductos().then(setLaboratorios).catch(() => setLaboratorios([]));
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

    /**
     * Agrega productos a la promoción que ya existe.
     *
     * ── De dónde salen los valores del renglón nuevo ──────────────────────
     * De la promoción, no de un formulario aparte. Las fechas son las que la
     * promoción ya tiene (la más temprana y la más tardía de sus renglones), y
     * el reparto son sus mismas salas sin unidades asignadas —«aplica acá, sin
     * lote todavía»—. Pedirlos de nuevo abriría la puerta a que un producto
     * agregado el martes cuente un período distinto que sus hermanos, y eso no
     * se vería en ninguna pantalla.
     *
     * El bono y el lote quedan en los valores neutros y se ajustan renglón por
     * renglón, que es exactamente lo que esta pantalla ya sabe hacer.
     */
    /* Con descuento en la venta, agregar o quitar un producto PREGUNTA antes de
       tocar el sistema de ventas. Sin la pregunta hay dos salidas y las dos son
       peores: escribir en silencio —el módulo no lo hace en ningún lado— o no
       escribir nunca, que es como estaba y deja el precio bajo en un producto
       que ya no es de ninguna campaña. */
    const conDescuento = (promo?.descuentos ?? 0) > 0;

    /* El ORDEN de estos cinco no es estético: los que preguntan leen a los que
       escriben, y `gate:tdz` cuenta como deuda toda lectura que viva antes de su
       `const` —hoy no lanza porque el cuerpo de una función corre después, pero
       mover ese uso fuera de la función lo convierte en un fallo de cada render—.
       Así que primero los que escriben, después los que preguntan. */
    /**
     * Le pasa el cambio a los descuentos del sistema de ventas.
     *
     * No lanza: la promoción YA se escribió cuando esto corre, así que un fallo
     * acá no puede deshacer nada — lo único útil es decir qué quedó a medias, y
     * con el nombre del descuento, que es lo que permite ir a corregirlo.
     */
    const sincronizar = async (delta) => {
        setSincronizando(true);
        try {
            const r = await sincronizarProductosDelDescuento(promocionId, delta);
            setAvisoSync(r);
        } catch (e) {
            setFallo(mensajeAmigable(e,
                'El producto quedó en la promoción, pero su descuento no se pudo actualizar. Corrígelo desde Descuentos.'));
        } finally {
            setSincronizando(false);
        }
    };

    const agregarYa = async (prods, tambienElDescuento) => {
        setFallo(null);
        setAgregando(true);
        try {
            // El cuerpo (vigencia, salas y bono heredados; el proveedor
            // resuelto por nombre): núcleo, `renglonesParaAgregar`, igual que la app.
            const cuerpo = renglonesParaAgregar(promo, prods, proveedores);
            if (cuerpo.error) { setFallo(cuerpo.error); return; }
            const r2 = await agregarRenglonesAPromocion(promocionId, cuerpo.renglones);
            if (!r2.agregados) {
                setFallo('Esos productos ya estaban en la promoción.');
                return;
            }
            /* El descuento DESPUÉS de la promoción, igual que al crearla: si la
               promoción fallara, un descuento nuevo quedaría vivo bajándole el
               precio a productos que no son de ninguna campaña. Al revés, lo
               peor que pasa es un producto en la promoción sin su descuento —
               visible, y con el aviso que lo nombra. */
            if (tambienElDescuento) await sincronizar({ agregar: prods.map((p) => p.id) });
            recargar();
        } catch (e) {
            setFallo(mensajeAmigable(e, 'No se pudieron agregar los productos.'));
        } finally {
            setAgregando(false);
        }
    };

    const quitarYa = async (renglon, tambienElDescuento) => {
        setFallo(null);
        setAQuitar(null);
        try {
            await quitarRenglon(renglon.id);
            if (tambienElDescuento) await sincronizar({ quitar: [renglon.erp_product_id] });
            recargar();
        } catch (e) {
            setFallo(mensajeAmigable(e, 'No se pudo quitar el producto.'));
        }
    };

    const agregarProductos = async (prods) => {
        if (conDescuento) { setPendiente({ tipo: 'agregar', prods }); return; }
        await agregarYa(prods, false);
    };

    /** Quitar un producto: con descuento, pregunta antes. */
    const quitarProducto = (renglon) => {
        if (conDescuento) { setPendiente({ tipo: 'quitar', renglon }); return; }
        // Sin descuento también se confirma: era un clic directo, y un doble
        // toque mandaba dos llamadas sobre una promoción viva.
        setAQuitar(renglon);
    };


    const borrar = async () => {
        if (borrandoYa) return;
        setFallo(null);
        setBorrandoYa(true);
        try {
            await borrarPromocion(promocionId);
            setBorrando(false);
            onCambio?.();
            onClose?.();
        } catch (e) {
            setBorrando(false);
            setFallo(mensajeAmigable(e, 'No se pudo borrar la promoción.'));
        } finally {
            setBorrandoYa(false);
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
                            {fmtVigencia(promo.inicio, promo.fin)} · {estadoVisible(promo).rotulo}
                        </p>
                    )}
                </div>
            </LiquidModal.Header>

            <LiquidModal.Body>
                {cargando && <LoadingState label="Cargando la promoción…" />}

                {error && (
                    <Notice variant="danger" icon={AlertTriangle}>
                        {mensajeDeCarga(error, 'No se pudo cargar la promoción.')}
                    </Notice>
                )}

                {!cargando && !error && promo && (
                    <div className="space-y-4">
                        {fallo && <Notice variant="danger" icon={AlertTriangle}>{fallo}</Notice>}

                        {/* Qué se escribió en el sistema de ventas, dicho. Un
                            «listo» a secas sobre una escritura en otro sistema
                            no se puede verificar desde acá, y `sin_productos`
                            es justo el caso que hay que ir a resolver a mano. */}
                        {avisoSync && (
                            <Notice
                                variant={avisoSync.sin_productos?.length ? 'warning' : 'success'}
                                icon={avisoSync.sin_productos?.length ? AlertTriangle : Check}
                                action={<Button variant="ghost" size="sm"
                                    onClick={() => setAvisoSync(null)}>Entendido</Button>}
                            >
                                {avisoSync.sin_productos?.length ? (
                                    <>
                                        El descuento{' '}
                                        <span className="font-semibold">
                                            «{avisoSync.sin_productos[0].descripcion}»
                                        </span>{' '}
                                        quedaría sin ningún producto, así que no se tocó. Quítalo desde
                                        la pestaña <span className="font-semibold">Descuentos</span>:
                                        borrarlo desde aquí sería deshacer un descuento entero por haber
                                        quitado un producto.
                                    </>
                                ) : avisoSync.cambiados?.length ? (
                                    <>
                                        Descuento actualizado:{' '}
                                        {avisoSync.cambiados.map((c) => (
                                            `«${c.descripcion}» queda con ${c.productos} producto${c.productos === 1 ? '' : 's'}`
                                        )).join(' · ')}.
                                    </>
                                ) : (
                                    'El descuento ya tenía ese cambio: no hizo falta tocarlo.'
                                )}
                            </Notice>
                        )}

                        <ResumenDiario promocionId={promocionId} />

                        <Notice variant="info" compact>
                            Si corriges el <span className="font-semibold">lote</span>, la{' '}
                            <span className="font-semibold">presentación</span> o el{' '}
                            <span className="font-semibold">reparto entre salas</span>, lo vendido se
                            vuelve a contar desde el inicio con el dato corregido. Si cambias{' '}
                            <span className="font-semibold">cuánto se paga por unidad</span>, lo ya
                            ganado no cambia: el monto nuevo cuenta desde hoy.
                        </Notice>

                        {/* Plegados cuando son muchos: con 102 productos se
                            abrían 102 formularios y 102 consultas de
                            presentaciones de golpe. Ahora cada uno consulta al
                            abrirse. */}
                        {(promo.renglones ?? []).map((r) => (
                            <RenglonEditable
                                key={r.id}
                                r={r}
                                abiertoInicial={(promo.renglones ?? []).length <= 3}
                                salas={salas}
                                proveedores={proveedores}
                                onCambio={recargar}
                                onFallo={setFallo}
                                onQuitar={quitarProducto}
                            />
                        ))}

                        {/* ── Agregar productos ────────────────────────────
                            No existía: `crear_promocion` los mete todos de una
                            vez y después no había forma de sumar uno, así que
                            una campaña a la que el laboratorio le agrega un
                            producto a mitad de mes había que rehacerla entera
                            —perdiendo su avance, su lote repartido y su
                            descuento— o dejarla incompleta. Reportado el
                            2026-09-05.

                            Con la promoción TERMINADA no se ofrece: sumarle un
                            producto cambiaría lo que ya se pagó, y la base lo
                            rechaza igual. Ofrecerlo para que falle es peor que
                            no ofrecerlo. */}
                        {promo.estado !== 'finalizada' && (
                            <div className="space-y-2">
                                <p className="text-label uppercase tracking-wide font-semibold text-content-2">
                                    Agregar productos
                                </p>
                                <AgregarProductos
                                    yaElegidos={(promo.renglones ?? []).map((x) => x.erp_product_id)}
                                    laboratorios={laboratorios}
                                    onAgregar={agregarProductos}
                                    ocupado={agregando}
                                />
                                {promo.descuentos > 0 && (
                                    <Notice variant="info" icon={Percent} compact>
                                        Esta promoción <span className="font-semibold">baja el precio en la
                                        venta</span>: al agregar se pregunta si los productos nuevos entran
                                        también al descuento.
                                    </Notice>
                                )}
                            </div>
                        )}

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
                isProcessing={borrandoYa}
            />

            <ConfirmModal
                isOpen={!!aQuitar}
                onClose={() => setAQuitar(null)}
                onConfirm={() => quitarYa(aQuitar, false)}
                title="Quitar el producto"
                message={aQuitar
                    ? `«${aQuitar.producto}» sale de la promoción. Lleva ${fmtUnidades(aQuitar.vendido_base)} unidades vendidas en ella: dejan de contar.`
                    : ''}
                confirmText="Quitar"
                isDestructive
            />

            {/* ── ¿También en el descuento? ─────────────────────────────────
                Un diálogo PROPIO y no `ConfirmModal`, porque la decisión tiene
                TRES salidas y el canónico tiene dos. Meterla ahí obligaría a
                que «sólo en la promoción» viajara en el botón de cancelar —o
                sea que Escape y el clic afuera ejecutarían una escritura—, que
                es exactamente lo que `hideCancel` existe para evitar.

                Las tres son legítimas y por eso se pregunta en vez de decidir:
                · las dos — el producto entra o sale de la campaña entera.
                · sólo la promoción — el descuento se negoció aparte, o ese
                  producto ya tiene el suyo y el sistema de ventas rechazaría
                  otro por cruzarse de fechas.
                · nada.

                El destacado es «las dos»: quitar un producto y DEJAR su precio
                bajo es lo que cuesta dinero. */}
            <LiquidModal
                open={!!pendiente}
                onClose={() => !(agregando || sincronizando) && setPendiente(null)}
                maxWidth="max-w-md"
                ariaLabel="¿También en el descuento?"
            >
                <LiquidModal.Header>
                    <h2 className="text-body-lg font-black text-content">
                        {pendiente?.tipo === 'quitar'
                            ? '¿También le quito el descuento?'
                            : '¿También le bajo el precio?'}
                    </h2>
                </LiquidModal.Header>

                <LiquidModal.Body>
                    <Notice variant={pendiente?.tipo === 'quitar' ? 'warning' : 'info'}
                        icon={pendiente?.tipo === 'quitar' ? AlertTriangle : Percent}>
                        {pendiente?.tipo === 'quitar' ? (
                            <>
                                <span className="font-semibold">{pendiente?.renglon?.producto ?? ''}</span>{' '}
                                sale de la promoción. Si no se quita también del descuento, la venta{' '}
                                <span className="font-semibold">le sigue bajando el precio</span>{' '}
                                a un producto que ya no es de ninguna campaña.
                            </>
                        ) : (
                            <>
                                Esta promoción baja el precio en la venta.{' '}
                                {pendiente?.prods?.length === 1
                                    ? 'El producto nuevo puede entrar'
                                    : `Los ${pendiente?.prods?.length ?? 0} productos nuevos pueden entrar`}{' '}
                                también al descuento, con el mismo porcentaje o monto y las mismas fechas.
                            </>
                        )}
                    </Notice>
                </LiquidModal.Body>

                <PieDeModal>
                    <Button variant="secondary" disabled={agregando || sincronizando}
                        onClick={() => setPendiente(null)}>
                        Cancelar
                    </Button>
                    <Button variant="secondary" disabled={agregando || sincronizando}
                        onClick={() => {
                            const p = pendiente;
                            setPendiente(null);
                            if (p?.tipo === 'quitar') quitarYa(p.renglon, false);
                            else agregarYa(p.prods, false);
                        }}>
                        Sólo en la promoción
                    </Button>
                    <Button icon={Check} loading={agregando || sincronizando}
                        onClick={() => {
                            const p = pendiente;
                            setPendiente(null);
                            if (p?.tipo === 'quitar') quitarYa(p.renglon, true);
                            else agregarYa(p.prods, true);
                        }}>
                        {pendiente?.tipo === 'quitar' ? 'Quitar de los dos' : 'Agregar a los dos'}
                    </Button>
                </PieDeModal>
            </LiquidModal>

        </LiquidModal>
    );
}

function RenglonEditable({ r, salas, proveedores, onCambio, onFallo, onQuitar, abiertoInicial = true }) {
    const [abierto, setAbierto] = useState(abiertoInicial);
    const [presentaciones, setPresentaciones] = useState([]);
    const [ocupado, setOcupado] = useState(null);

    // Lo declarado: se corrige y vuelve a contar.
    const [lote, setLote] = useState(r.lote_total ?? '');
    const [factor, setFactor] = useState(r.factor_unidades == null ? '' : String(r.factor_unidades));
    const [tieneBono, setTieneBono] = useState(!!r.tiene_bono);
    const [paga, setPaga] = useState(r.paga || 'proveedor');
    const [prov, setProv] = useState('');
    const repartoOriginal = useMemo(() => Object.fromEntries(
        salas.map((s) => {
            const fila = (r.reparto || []).find((x) => Number(x.branch_id) === Number(s.id));
            return [s.id, fila ? String(fila.asignado_vigente) : ''];
        }),
    ), [salas, r.reparto]);
    const [reparto, setReparto] = useState(repartoOriginal);
    /* El reparto viaja SÓLO si se tocó. Hasta el 2026-10-01 iba siempre, y la
       base lo reemplazaba entero quedándose con las salas de más de 0: las
       filas en 0 —«aplica en esta sala, sin lote»; eran las 108 que había— se
       borraban, y corregir la presentación de un producto lo pasaba a contar
       en TODAS las salas. La base ya conserva las de 0
       (`20261001154209_editar_renglon_conserva_salas_en_cero`); no mandarlo
       cuando no cambió sigue ahorrando el borrado y la reinserción. */
    const repartoCambio = salas.some((s) =>
        (Number(reparto[s.id]) || 0) !== (Number(repartoOriginal[s.id]) || 0));

    // Los montos: van con fecha y no reescriben el pasado.
    const [bv, setBv] = useState(String(r.bono_vendedor ?? '0'));
    const [ba, setBa] = useState(String(r.bono_adm ?? '0'));
    const [bb, setBb] = useState(String(r.bono_bodega ?? '0'));
    const [fin, setFin] = useState(r.fin || '');

    useEffect(() => {
        if (!abierto) return undefined;
        let vivo = true;
        fetchPresentacionesDeProducto(r.erp_product_id)
            .then((p) => { if (vivo) setPresentaciones(p || []); })
            .catch(() => { if (vivo) setPresentaciones([]); });
        return () => { vivo = false; };
    }, [r.erp_product_id, abierto]);

    const tarifaCambio = String(bv) !== String(r.bono_vendedor ?? '0')
        || String(ba) !== String(r.bono_adm ?? '0')
        || String(bb) !== String(r.bono_bodega ?? '0');

    const opcionesPres = useMemo(() => ([
        { value: '', label: 'Cualquier presentación' },
        ...presentaciones.map((p) => ({ value: String(p.factor), label: `${p.etiqueta} · ×${p.factor}` })),
    ]), [presentaciones]);

    /* Lo escrito se lee con `numeroEscrito`: la capa de datos hace
       `Number(x) || 0`, y «abc» o «1.2.3» se guardaban como $0 sin aviso. */
    const montosIlegibles = [bv, ba, bb].some((v) => String(v ?? '').trim() !== '' && numeroEscrito(v) == null);
    const loteIlegible = String(lote ?? '').trim() !== ''
        && !(numeroEscrito(lote) > 0 && Number.isInteger(numeroEscrito(lote)));

    const correr = async (clave, fn) => {
        setOcupado(clave);
        onFallo(null);
        try { await fn(); onCambio(); }
        catch (e) { onFallo(mensajeAmigable(e, 'No se pudo guardar el cambio.')); }
        finally { setOcupado(null); }
    };

    const sumaReparto = Object.values(reparto).reduce((a, u) => a + (Number(u) || 0), 0);

    const pct = r.lote_total ? Math.min(Math.round((Number(r.vendido_base) || 0) / r.lote_total * 100), 999) : null;

    return (
        <div className="rounded-lg border border-border-card bg-surface-card p-3 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
                <button type="button" onClick={() => setAbierto((x) => !x)} aria-expanded={abierto}
                    className="flex-1 min-w-0 flex items-center gap-1.5 text-left min-h-[var(--tap-min)] active:scale-[0.99]">
                    <ChevronDown size={16} aria-hidden
                        className={`shrink-0 text-content-3 transition-transform duration-[var(--dur-base)] ${abierto ? '' : '-rotate-90'}`} />
                    <span className="min-w-0 truncate text-body-sm font-semibold text-content">{r.producto}</span>
                    {!abierto && (
                        <span className="shrink-0 text-caption text-content-3 tabular-nums">
                            · {fmtUnidades(r.vendido_base)}{r.lote_total ? ` de ${fmtUnidades(r.lote_total)} (${pct}%)` : ' u.'}
                        </span>
                    )}
                </button>
                {r.estado === 'cerrado' && (
                    <Badge variant="neutral" size="sm">
                        {MOTIVO_CIERRE[r.cerrado_motivo] || 'Terminado'}
                    </Badge>
                )}
                <Button variant="ghost" size="sm" iconOnly icon={Trash2} title="Quitar de la promoción"
                    onClick={() => onQuitar?.(r)} />
            </div>

            {abierto && (<>
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
            {loteIlegible && (
                <p className="text-caption text-danger-text">El lote tiene que ser un número entero mayor que cero, o quedar vacío.</p>
            )}
            <Button size="sm" icon={Check} loading={ocupado === 'declarado'} disabled={loteIlegible}
                onClick={() => correr('declarado', () => editarRenglon({
                    renglonId: r.id,
                    loteTotal: lote === '' ? null : numeroEscrito(lote),
                    factorUnidades: factor === '' ? null : factor,
                    tieneBono,
                    paga: tieneBono ? paga : null,
                    supplierId: prov || null,
                    borrarLote: lote === '',
                    cualquierPresentacion: factor === '',
                    /* Van las salas con unidades Y las que ya estaban marcadas
                       aunque queden en 0: desde v2.1117 la base conserva las
                       filas en 0 («aplica acá, sin lote»). Sin ellas, cambiar
                       las unidades de una sala desmarcaba a las demás. */
                    reparto: repartoCambio
                        ? Object.entries(reparto)
                            .filter(([b, u]) => (numeroEscrito(u) || 0) > 0 || repartoOriginal[b] !== '')
                            .map(([b, u]) => ({ branch_id: Number(b), unidades: numeroEscrito(u) || 0 }))
                        : null,
                }))}>
                Guardar lote, presentación y reparto
            </Button>

            {/* ── Lo que NO reescribe el pasado ─────────────────────────────
                Sólo si el producto PAGA bono. Con «sólo medir cuánto se vende»
                los tres montos son cero y guardarlos no hace nada: preguntar
                cuánto se paga por algo que no se paga invita a escribir un
                número que la base va a ignorar, y quien lo escribe queda
                creyendo que configuró un bono. Reportado con captura el
                2026-09-05. */}
            {tieneBono && (
            <div className="pt-2 border-t border-border-muted space-y-3">
                <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
                    <PortalInput label="Vendedor" name={`e-bv-${r.id}`} value={bv}
                        onChange={(e) => setBv(e.target.value)} inputMode="decimal" />
                    <PortalInput label="Fondo admón." name={`e-ba-${r.id}`} value={ba}
                        onChange={(e) => setBa(e.target.value)} inputMode="decimal" />
                    <PortalInput label="Fondo bodega" name={`e-bb-${r.id}`} value={bb}
                        onChange={(e) => setBb(e.target.value)} inputMode="decimal" />
                </div>
                {montosIlegibles && (
                    <p className="text-caption text-danger-text">Uno de los montos no se entiende como número.</p>
                )}
                <p className="text-caption text-content-3">
                    Los montos nuevos rigen <span className="font-semibold">desde hoy</span>. Lo vendido
                    antes se sigue pagando con el monto que regía ese día.
                </p>
                {/* `unidadesPorBono` viaja con el valor vigente: sin él la capa de
                    datos ponía 1, y un producto que pagaba «cada 3 u.» pasaba a
                    pagar por unidad desde hoy. */}
                <Button size="sm" variant="secondary" icon={DollarSign} loading={ocupado === 'tarifa'}
                    disabled={!tarifaCambio || montosIlegibles}
                    onClick={() => correr('tarifa', () => editarTarifaRenglon({
                        renglonId: r.id,
                        bonoVendedor: numeroEscrito(bv) ?? 0,
                        bonoAdm: numeroEscrito(ba) ?? 0,
                        bonoBodega: numeroEscrito(bb) ?? 0,
                        unidadesPorBono: Number(r.unidades_por_bono) || 1,
                    }))}>
                    Guardar montos desde hoy
                </Button>
            </div>
            )}

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
            </>)}
        </div>
    );
}

/* ── El resumen diario de la promoción (usuario, 24-sep) ───────────────────
 * «¿Podría activar en la promoción si lleva o no notificación, y si sólo llega
 * a supervisión o a la sucursal?». Se guarda al elegir —es un solo dato y no
 * tiene nada que confirmar— y queda en el historial de la promoción.
 *
 * Supervisión y Salas se eligen JUNTAS o por separado; «Sin avisar» es la única
 * que excluye a las otras (usuario, 24-sep: «que sean seleccionables múltiples,
 * menos el sin avisar»). Quitar la última elegida vuelve a «Sin avisar»: nunca
 * queda un estado sin ninguna marcada, que se leería como «no cargó». */
// Rótulos y lógica en el núcleo (la app ajusta el mismo resumen); acá, los íconos.
const ICONO_RESUMEN = { no: BellOff, supervision: ShieldCheck, salas: Store };
const OPCIONES_RESUMEN = OPCIONES_RESUMEN_DIARIO.map((o) => ({ ...o, icon: ICONO_RESUMEN[o.key] }));

function ResumenDiario({ promocionId }) {
    const [valor, setValor] = useState(null);   // { supervision, salas }
    const [guardando, setGuardando] = useState(false);
    const [fallo, setFallo] = useState(null);

    useEffect(() => {
        let vivo = true;
        fetchResumenDePromocion(promocionId)
            .then((r) => { if (vivo) setValor({ supervision: !!r?.supervision, salas: !!r?.salas }); })
            .catch((e) => { if (vivo) setFallo(mensajeAmigable(e, 'No se pudo leer el resumen diario.')); });
        return () => { vivo = false; };
    }, [promocionId]);

    const elegida = (key) => resumenElegido(valor, key);

    const tocar = async (key) => {
        const antes = valor;
        const nuevo = alternarResumen(valor, key);
        setValor(nuevo);
        setGuardando(true);
        setFallo(null);
        try {
            await ajustarResumenPromocion(promocionId, nuevo);
        } catch (e) {
            setValor(antes);
            setFallo(mensajeAmigable(e, 'No se pudo guardar el resumen diario.'));
        } finally {
            setGuardando(false);
        }
    };

    if (valor == null && !fallo) return null;
    return (
        <Campo rotulo="Resumen diario · 7:30 a. m.">
            <div role="group" aria-label="A quién le llega el resumen diario"
                className="grid grid-cols-1 min-[420px]:grid-cols-3 gap-2">
                {OPCIONES_RESUMEN.map(({ key, icon: Icono, rotulo, detalle }) => {
                    const si = elegida(key);
                    return (
                        <button
                            key={key}
                            type="button"
                            aria-pressed={si}
                            disabled={guardando || valor == null}
                            onClick={() => tocar(key)}
                            className={`relative flex items-center gap-2.5 min-w-0 h-auto text-left rounded-card border px-4 py-3.5
                                min-h-[var(--tap-min)]
                                transition-[background-color,border-color,transform] duration-[var(--dur-base)]
                                active:scale-[0.97] disabled:opacity-60 disabled:cursor-not-allowed
                                ${si
                                    ? 'border-brand bg-brand/10'
                                    : 'border-border-card bg-surface-card-hover hover:border-brand/40'}`}
                        >
                            <span className={`shrink-0 grid place-items-center size-8 rounded-full
                                ${si ? 'bg-brand text-white' : 'bg-surface-card text-content-3'}`}>
                                <Icono size={16} aria-hidden />
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className={`block text-body font-semibold ${si ? 'text-content' : 'text-content-2'}`}>
                                    {rotulo}
                                </span>
                                <span className="block text-caption text-content-3">{detalle}</span>
                            </span>
                            <span aria-hidden className={`shrink-0 grid place-items-center size-5 border
                                ${key === 'no' ? 'rounded-full' : 'rounded-md'}
                                ${si ? 'bg-brand border-brand text-white' : 'border-border-card'}`}>
                                {si && <Check size={13} strokeWidth={3} />}
                            </span>
                        </button>
                    );
                })}
            </div>
            {fallo && <p className="text-caption text-danger-text mt-1.5">{fallo}</p>}
        </Campo>
    );
}
