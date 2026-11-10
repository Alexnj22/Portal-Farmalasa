import React from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import Notice from '../../components/common/Notice';
import Button from '../../components/common/Button';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { cuentaDelProducto } from '@nucleo/utils/promocionesUtils';

/**
 * Las piezas que comparten los tres lugares donde se arma un descuento —el
 * alta de la promoción, su edición y «Corregir descuento»—. Estaban copiadas
 * tres y dos veces: una copia que se corrige sola es cómo dos pantallas
 * terminan diciendo cosas distintas del mismo descuento.
 */

/**
 * Lo que el servidor pide confirmar antes de guardar el descuento.
 *
 * Esto PIDE CONFIRMACIÓN, no vuelve a informar: la lista de productos ya dice
 * en cuánto queda cada uno y cuánto se pierde. El servidor manda una línea por
 * motivo —no una por producto—, y la nota del solape sólo sale si hay un
 * solape: una explicación que aparece siempre deja de leerse.
 */
export function AvisosDelDescuento({ avisos }) {
    if (!avisos?.length) return null;
    return (
        <Notice variant="warning" icon={AlertTriangle}>
            {avisos.length === 1 ? (
                <p>{avisos[0].texto}</p>
            ) : (
                <ul className="list-disc pl-4 space-y-0.5">
                    {avisos.map((a) => <li key={a.texto}>{a.texto}</li>)}
                </ul>
            )}
            {avisos.some((a) => a.tipo === 'solape') && (
                <p className="mt-1.5 text-caption">
                    Cuando dos descuentos toman el mismo producto en las mismas fechas,
                    la venta aplica uno solo y no dice cuál.
                </p>
            )}
        </Notice>
    );
}

/**
 * Un producto del descuento, con en cuánto le queda el precio.
 *
 * El precio que llega es el MÁS BAJO de sus presentaciones y el costo el MÁS
 * ALTO (`get_precios_para_descuento`): el peor caso es el que decide. El costo
 * llega YA con IVA —`vineta` es el precio al público y la columna `costo` el
 * neto de la factura—; la cuenta sale del núcleo (`cuentaDelProducto`).
 *
 * «Pierde por unidad» y no «bajo el costo» a secas: no es lo mismo perder tres
 * centavos que dos dólares, y por unidad es la cifra que se multiplica por lo
 * que se espera vender.
 *
 * @param onQuitar  si viene, la fila lleva el botón de quitar.
 * @param destacado el nombre en negrita (la lista que se edita).
 */
export function FilaPrecioDelProducto({ producto, datos, tipo, monto, onQuitar, destacado = false }) {
    const { precio, costo, queda, bajoCosto, pierde } = cuentaDelProducto(datos, tipo, monto);
    return (
        <div className={`flex items-center gap-2 px-3 ${onQuitar ? 'py-2.5' : 'py-2'}`}>
            <div className="min-w-0 flex-1">
                <p className={`text-body-sm text-content truncate ${destacado ? 'font-semibold' : ''}`}>{producto.nombre}</p>
                <p className="text-caption text-content-3 tabular-nums">
                    {!precio ? 'Sin precio registrado' : (
                        <>
                            {formatMoney(precio)} →{' '}
                            <span className={bajoCosto ? 'text-danger font-semibold' : 'text-success font-semibold'}>
                                {formatMoney(queda)}
                            </span>
                            {costo > 0 && <> · cuesta {formatMoney(costo)} con IVA</>}
                        </>
                    )}
                </p>
            </div>
            {bajoCosto && (
                <span className="text-caption text-danger font-semibold shrink-0 text-right leading-tight">
                    <span className="flex items-center gap-1 justify-end">
                        <AlertTriangle size={13} aria-hidden /> bajo el costo
                    </span>
                    <span className="block tabular-nums font-normal">
                        pierde {formatMoney(pierde)} por unidad
                    </span>
                </span>
            )}
            {onQuitar && (
                <Button variant="ghost" size="sm" iconOnly icon={Trash2} onClick={onQuitar} title="Quitar" />
            )}
        </div>
    );
}
