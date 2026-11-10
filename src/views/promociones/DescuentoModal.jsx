import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Percent, Tag, Plus, Info } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import LiquidSelect from '../../components/common/LiquidSelect';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import PortalInput from '../../components/common/PortalInput';
import Button from '../../components/common/Button';
import PieDeModal from '../../components/common/PieDeModal';
import Notice from '../../components/common/Notice';
import Checkbox from '../../components/common/Checkbox';
import BuscadorDeProducto from '../../components/common/BuscadorDeProducto';
import { LoadingState } from '../../components/common/StateViews';
import AvisoDeBorrador from '../../components/common/AvisoDeBorrador';
import useBorrador from '@nucleo/hooks/useBorrador';
import { useStaffStore } from '@nucleo/store/staffStore';
import { SALAS_VENTA } from '@nucleo/utils/metasUtils';
import {
    fetchDescuento, fetchPreciosDeProductos, guardarDescuento,
} from '@nucleo/data/descuentos';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { formatMoney } from '@nucleo/utils/formatNumber';
import {
    TIPOS_DE_DESCUENTO, formaDeDescuento, ordenarPorPerdida, payloadDeDescuento, problemasAlCorregirDescuento,
} from '@nucleo/utils/promocionesUtils';
import { hoySV } from '@nucleo/utils/fecha';
import Campo from './Campo';
import { AvisosDelDescuento, FilaPrecioDelProducto } from './PiezasDelDescuento';

/**
 * Los dos tipos, dichos como los aplica la venta.
 *
 * «Monto por unidad» y no «Monto» a secas porque el sistema de la caja hace
 * `subtotal -= monto × cantidad`: sobre tres unidades, un descuento de $10.04
 * son $30.12. Medido. El rótulo corto se lee como «$10.04 y ya», que es la
 * mitad del dinero en una venta de dos.
 */
// Los tipos, la forma del formulario, lo que impide guardar y lo que se manda
// salen del núcleo (`promocionesUtils`): la app corrige el mismo descuento.
const TIPOS = TIPOS_DE_DESCUENTO;

const vacio = () => formaDeDescuento(null, hoySV());

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
        setCargando(true);
        setFallo(null);
        fetchDescuento(descuentoId)
            .then((d) => {
                if (!vivo) return;
                setF(formaDeDescuento(d, hoySV()));
            })
            .catch((e) => { if (vivo) setFallo(mensajeAmigable(e, 'No se pudo cargar el descuento.')); })
            .finally(() => { if (vivo) setCargando(false); });
        return () => { vivo = false; };
    }, [open, editando, descuentoId]);

    // ── Los precios de los productos elegidos ──────────────────────────────
    const ids = useMemo(() => f.productos.map((p) => p.id).join(','), [f.productos]);
    useEffect(() => {
        if (!open || !ids) { setPrecios([]); return undefined; }
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

    const monto = Number(f.monto);

    /* Primero el que más se pierde: es el que decide si el descuento va. Va
       después de `monto` porque el array de dependencias se evalúa al llamar a
       `useMemo`, o sea en el render — leerlo antes de su `const` lanza. */
    const enOrden = useMemo(
        () => ordenarPorPerdida(f.productos, porProducto, f.tipo, monto),
        [f.productos, porProducto, f.tipo, monto],
    );

    // ── Lo que impide guardar, dicho antes de intentarlo ───────────────────
    const problemas = useMemo(() => problemasAlCorregirDescuento(f, alcanceTodo), [f, alcanceTodo]);

    const enviar = async (forzar) => {
        setFallo(null);
        setGuardando(true);
        try {
            const r = await guardarDescuento(payloadDeDescuento(f, {
                id: editando ? descuentoId : 0, salaPorDefecto: salas[0]?.id ?? null, forzar,
            }));
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
        <LiquidModal open={open} onClose={onClose} maxWidth="max-w-4xl" ariaLabel={titulo}>
            <LiquidModal.Header titulo={titulo} onClose={onClose} />

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
                                    onChange={(v) => set('todas', v)}
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
                                {enOrden.map((p) => (
                                    <FilaPrecioDelProducto
                                        key={p.id}
                                        producto={p}
                                        datos={porProducto.get(p.id)}
                                        tipo={f.tipo}
                                        monto={monto}
                                        destacado
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

                        {/* Confirmación, no informe: la lista de productos de
                            arriba ya dice en cuánto queda cada uno y cuánto se
                            pierde, ordenada por el que más pierde. */}
                        <AvisosDelDescuento avisos={avisos} />

                        {fallo && <Notice variant="danger" icon={AlertTriangle}>{fallo}</Notice>}
                    </div>
                )}
            </LiquidModal.Body>

            <PieDeModal izquierda={(
                <span className="text-caption text-content-3">
                    {problemas.length ? problemas[0] : 'Empieza a descontar en la fecha de inicio.'}
                </span>
            )}>
                <Button variant="secondary" onClick={onClose}>Cancelar</Button>
                {avisos.length > 0 ? (
                    <Button
                        variant="destructive"
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
            </PieDeModal>
        </LiquidModal>
    );
}
