import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Info, Percent } from 'lucide-react';
import LiquidSelect from '../../components/common/LiquidSelect';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import PortalInput from '../../components/common/PortalInput';
import Checkbox from '../../components/common/Checkbox';
import Notice from '../../components/common/Notice';
import { fetchPreciosDeProductos } from '@nucleo/data/descuentos';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { TIPOS_DE_DESCUENTO, descuentoDesdeLaPromocion, fmtVigencia, ordenarPorPerdida } from '@nucleo/utils/promocionesUtils';
import Campo from './Campo';
import { FilaPrecioDelProducto } from './PiezasDelDescuento';

/**
 * «¿Esta promoción además le baja el precio al cliente?»
 *
 * ── Por qué vive DENTRO de crear una promoción ────────────────────────────
 * Porque son la misma decisión. Negociar una campaña con un laboratorio
 * incluye si el producto sale más barato en la sala, y separarlo en otra
 * pantalla obliga a cargar **los mismos productos y las mismas fechas dos
 * veces** — que es exactamente cómo dos listas que deberían decir lo mismo
 * terminan diciendo cosas distintas.
 *
 * Por eso acá NO se vuelven a pedir: los productos y la vigencia se HEREDAN de
 * los renglones de la promoción y se muestran para confirmarlos. Lo único
 * propio del descuento es cómo descuenta, cuánto, y en qué salas.
 *
 * ── Las dos formas, dichas como las aplica la venta ───────────────────────
 * · **Porcentaje** — ese % del renglón.
 * · **Monto por cada unidad** — `subtotal -= monto × cantidad`. Medido en el
 *   sistema de ventas: sobre tres unidades, $10.04 son $30.12. El rótulo corto
 *   («Monto») se lee como «$10.04 y ya», que es la mitad del dinero en una
 *   venta de dos.
 *
 * ── Lo que se ve acá y no se ve allá ──────────────────────────────────────
 * En cuánto queda el precio de cada producto, y en rojo el que caería bajo el
 * costo. Un 60 % se teclea igual de rápido que un 25 %.
 *
 * @param renglones  Los de la promoción — de ahí salen productos y fechas.
 * @param valor      `{ activo, tipo, monto, todas, branchId, finPropio }`
 * @param onCambiar  `(campo, v) => void`
 */
export default function DescuentoEnVentas({ renglones, salas, valor, onCambiar, salasDeLaPromocion = {} }) {
    const [precios, setPrecios] = useState([]);

    /* Las salas que se marcaron arriba, con su nombre. Vacío = todas. */
    const salasMarcadas = useMemo(
        () => salas.filter((s) => salasDeLaPromocion?.[s.id]),
        [salas, salasDeLaPromocion],
    );

    /* Las que NO entran en la promoción — sólo importan cuando el descuento se
       manda «a todas»: ahí el precio baja donde la promoción no aplica. */
    const salasSinPromocion = useMemo(
        () => salas.filter((s) => !salasDeLaPromocion?.[s.id]),
        [salas, salasDeLaPromocion],
    );

    // ── Lo que se hereda ───────────────────────────────────────────────────
    const productos = useMemo(() => {
        const vistos = new Map();
        for (const r of renglones) {
            if (!vistos.has(r.erp_product_id)) vistos.set(r.erp_product_id, r.producto);
        }
        return [...vistos].map(([id, nombre]) => ({ id, nombre }));
    }, [renglones]);

    /* La promoción tiene una vigencia POR RENGLÓN; el descuento es uno solo, así
       que toma la ventana que las cubre a todas. La cuenta es la MISMA que se
       manda al guardar (`descuentoDesdeLaPromocion`): escrita dos veces, la
       pantalla podía mostrar una ventana y mandar otra.

       El `fin` de un renglón puede estar vacío a propósito —«todavía no se
       sabe» es un estado válido en la promoción—. Pero el sistema de ventas
       EXIGE una fecha de fin, así que cuando ninguno la tiene se pide acá en
       vez de inventar una: un descuento sin fecha de corte no se apaga solo. */
    const { inicio, fin: finHeredado } = useMemo(
        () => descuentoDesdeLaPromocion(renglones, {}),
        [renglones],
    );

    const fin = finHeredado || valor.finPropio || '';

    const monto = Number(valor.monto);

    // ── Los precios, para ver en cuánto queda ──────────────────────────────
    const ids = useMemo(() => productos.map((p) => p.id).join(','), [productos]);
    useEffect(() => {
        if (!valor.activo || !ids) { setPrecios([]); return undefined; } // eslint-disable-line react-hooks/set-state-in-effect -- sin descuento o sin productos no hay precio que calcular
        let vivo = true;
        fetchPreciosDeProductos(ids.split(',').map(Number))
            .then((r) => { if (vivo) setPrecios(r || []); })
            .catch(() => { if (vivo) setPrecios([]); });
        return () => { vivo = false; };
    }, [valor.activo, ids]);

    const porProducto = useMemo(
        () => new Map((precios || []).map((p) => [Number(p.id), p])),
        [precios],
    );

    /* Primero el que más se pierde. Con 36 productos, el que duele puede estar
       en el renglón doce y el orden por nombre obliga a recorrerlos todos. */
    const enOrden = useMemo(
        () => ordenarPorPerdida(productos, porProducto, valor.tipo || '%', monto),
        [productos, porProducto, valor.tipo, monto],
    );

    return (
        <div className="rounded-lg border border-border-card bg-surface-card-hover p-3 space-y-3">
            <Checkbox
                checked={!!valor.activo}
                onChange={(v) => onCambiar('activo', v)}
                label="Además baja el precio en la venta"
                description="La venta le descuenta al renglón cuando se vende cualquiera de estos productos."
            />

            {valor.activo && (
                <>
                    {!productos.length ? (
                        <Notice variant="warning" icon={AlertTriangle}>
                            Agrega primero los productos de la promoción: el descuento se aplica a esos.
                        </Notice>
                    ) : (
                        <>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <Campo rotulo="Cómo descuenta">
                                    <LiquidSelect
                                        value={valor.tipo || '%'}
                                        onChange={(v) => onCambiar('tipo', v)}
                                        options={TIPOS_DE_DESCUENTO}
                                        clearable={false}
                                        icon={Percent}
                                        ariaLabel="Cómo descuenta"
                                    />
                                </Campo>

                                <PortalInput
                                    label={valor.tipo === '$' ? 'Monto por unidad' : 'Porcentaje'}
                                    name="descuento_monto"
                                    /* Nunca `type="number"`: en el teléfono el separador
                                       decimal depende del equipo y una coma se pierde entera. */
                                    value={valor.monto || ''}
                                    onChange={(e) => onCambiar('monto', e.target.value.replace(/[^0-9.]/g, ''))}
                                    placeholder={valor.tipo === '$' ? '1.50' : '25'}
                                    prefix={valor.tipo === '$' ? '$' : '%'}
                                />
                            </div>

                            {valor.tipo === '$' && monto > 0 && (
                                <Notice variant="info" icon={Info}>
                                    Se descuenta {formatMoney(monto)}{' '}
                                    <span className="font-semibold">por cada unidad</span>.
                                    {' '}En una venta de 3 unidades son {formatMoney(monto * 3)}.
                                </Notice>
                            )}

                            {/* ── Dónde baja el precio ────────────────────
                                Hereda las salas marcadas arriba, PERO con un
                                límite del sistema de ventas que se midió el
                                2026-09-05 y no se puede sortear:

                                **admite UN descuento por producto y ventana de
                                fechas, en toda la cadena.** La sala no importa —
                                el mismo producto con las mismas fechas en otra
                                sala lo rechaza («ya tiene una promocion activa
                                en esa fecha»); con fechas que no se cruzan, lo
                                acepta.

                                O sea que «un descuento por cada sala marcada» es
                                IMPOSIBLE. Con una sala marcada va ahí; con
                                ninguna, a todas; con varias hay que elegir, y la
                                pantalla lo dice en vez de fallar al guardar. */}
                            {salasMarcadas.length <= 1 ? (
                                <Notice variant="info" icon={Info}>
                                    {salasMarcadas.length === 0
                                        ? 'Baja el precio en todas las salas, igual que la promoción.'
                                        : `Baja el precio sólo en ${salasMarcadas[0].name}, igual que la promoción.`}
                                </Notice>
                            ) : (
                                <>
                                    <Notice variant="warning" icon={AlertTriangle}>
                                        La promoción aplica en {salasMarcadas.length} salas, pero la
                                        venta admite <span className="font-semibold">un
                                        solo descuento por producto</span> en unas mismas fechas —da
                                        igual la sala. Elige dónde baja el precio.
                                    </Notice>
                                    <Campo rotulo="Dónde baja el precio">
                                        <LiquidSelect
                                            value={valor.todas ? 'todas' : String(valor.branchId || '')}
                                            onChange={(v) => {
                                                onCambiar('todas', v === 'todas');
                                                onCambiar('branchId', v === 'todas' ? '' : v);
                                            }}
                                            options={[
                                                { value: 'todas', label: 'En todas las salas' },
                                                ...salasMarcadas.map((x) => ({
                                                    value: String(x.id), label: `Sólo en ${x.name}` })),
                                            ]}
                                            placeholder="Elige dónde"
                                            clearable={false}
                                            ariaLabel="Dónde baja el precio"
                                        />
                                    </Campo>

                                    {/* La consecuencia de elegir «todas», dicha
                                        con nombre y apellido. Es una decisión
                                        razonable —evita tener que partir la
                                        promoción— pero el precio baja TAMBIÉN
                                        donde la promoción no aplica, y eso no
                                        se ve en ninguna otra pantalla: allá el
                                        descuento no dice a qué promoción
                                        pertenece. Nombrar las salas y no decir
                                        «en las demás» es a propósito: quien
                                        decide tiene que poder mirar si en ésas
                                        el margen aguanta. */}
                                    {valor.todas && salasSinPromocion.length > 0 && (
                                        <Notice variant="warning" icon={AlertTriangle}>
                                            El precio va a bajar también en{' '}
                                            <span className="font-semibold">
                                                {salasSinPromocion.map((x) => x.name).join(', ')}
                                            </span>, donde esta promoción no aplica: el bono no se
                                            acumula ahí, pero el producto sí se vende más barato.
                                        </Notice>
                                    )}
                                </>
                            )}

                            {/* La vigencia NO se vuelve a pedir: es la de la promoción.
                                Salvo que ningún renglón tenga fecha de fin — ahí el
                                sistema de ventas exige una y se pide, porque un
                                descuento sin corte no se apaga solo. */}
                            {finHeredado ? (
                                <p className="text-caption text-content-2">
                                    Descuenta durante la vigencia de la promoción:{' '}
                                    <span className="font-semibold tabular-nums">{fmtVigencia(inicio, fin)}</span>
                                </p>
                            ) : (
                                <Campo rotulo="Hasta cuándo descuenta">
                                    <LiquidDatePicker
                                        value={valor.finPropio || ''}
                                        onChange={(v) => onCambiar('finPropio', v)}
                                        min={inicio || undefined}
                                    />
                                    <p className="text-caption text-content-3 mt-1">
                                        Los productos de la promoción todavía no tienen fecha de fin,
                                        y un descuento sin fecha de corte no se apaga solo.
                                    </p>
                                </Campo>
                            )}

                            {/* En cuánto queda cada uno. Es lo único que distingue una
                                campaña de una venta a pérdida. */}
                            {monto > 0 && (
                                <ul className="divide-y divide-border-card rounded-lg border border-border-card">
                                    {enOrden.map((p) => (
                                        <li key={p.id}>
                                            <FilaPrecioDelProducto
                                                producto={p}
                                                datos={porProducto.get(p.id)}
                                                tipo={valor.tipo || '%'}
                                                monto={monto}
                                            />
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </>
                    )}
                </>
            )}
        </div>
    );
}
