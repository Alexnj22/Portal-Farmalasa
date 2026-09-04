import { PackageCheck } from 'lucide-react';
import ModalShell from '../../../components/common/ModalShell';
import CuerpoDialogo from '../../../components/common/CuerpoDialogo';
import Button from '../../../components/common/Button';
import Badge from '../../../components/common/Badge';
import { ERP_NAMES } from './constants';
import { sugerenciaParaLaRegla } from './helpers';

/**
 * Por qué este producto nunca va a entrar en un pedido, y con qué número sí.
 *
 * El badge REGLA sólo decía que había un problema. Llevar a la pantalla de
 * Reglas de despacho tampoco alcanzaba: ahí se ve CÓMO se despacha el producto,
 * pero no por qué su MÁX no da, ni cuánto habría que subirlo. Son dos datos que
 * viven en pantallas distintas y la resta hay que hacerla en la cabeza.
 *
 * Acá se dicen juntos: el paquete de despacho, el MÁX de hoy, el número mínimo
 * que destraba el producto, y un botón que lo aplica. El botón escribe donde
 * corresponda —borrador si la sala tiene borradores pendientes, valor vigente si
 * no— porque usa el mismo camino que la celda de la tabla.
 *
 * La otra salida es real y se ofrece igual de visible: si el producto de verdad
 * no se pide de a paquetes, lo que hay que cambiar es la REGLA, no el MÁX.
 */
export default function ReglaDeDespachoModal({ open, row, guardando, onAceptar, onVerReglas, onClose }) {
    if (!open || !row) return null;

    const factor   = Number(row.dispatch_pres_factor || 0);
    const multiplo = Number(row.dispatch_multiplo ?? 1);
    const maxHoy   = Number(row.effective_max ?? 0);
    const minHoy   = Number(row.effective_min ?? 0);
    const sug      = sugerenciaParaLaRegla(minHoy, maxHoy, factor, multiplo);

    const tipo = row.dispatch_tipo ? String(row.dispatch_tipo) : null;
    const comoSeDespacha = tipo
        ? `${tipo}${multiplo > 1 ? ` ×${multiplo}` : ''}`
        : `${(factor * multiplo).toLocaleString()} und`;

    return (
        <ModalShell open onClose={onClose} maxWidthClass="max-w-md" zClass="z-tooltip"
            surface={null} ariaLabel="Regla de despacho del producto">
            <CuerpoDialogo
                titulo={row.product_name}
                subtitulo={`${ERP_NAMES[row._erp_sucursal_id]} · Regla de despacho`}
                icono={PackageCheck}
                anchoEscritorio="max-w-md"
                pie={<>
                    <Button variant="secondary" onClick={onClose}>Cerrar</Button>
                    {sug && (
                        <Button variant="primary" loading={guardando}
                            onClick={() => onAceptar(sug.minNuevo, sug.maxNuevo)}>
                            Aceptar sugerencia
                        </Button>
                    )}
                </>}
            >
                <div className="flex flex-col gap-3 text-left">
                    {/* Cómo se despacha, que es el dato que hoy obliga a ir a otra
                        pantalla. Sale de la fila: `get_stock_analysis` ya lo trae. */}
                    <div data-surface="card" className="px-4 py-3.5 flex items-center justify-between gap-3">
                        <div className="flex flex-col gap-0.5 min-w-0">
                            <span className="text-micro font-black uppercase tracking-wide text-content-3">Se despacha de a</span>
                            <span className="text-h3 font-black tabular-nums text-content leading-none">
                                {(factor * multiplo).toLocaleString()}
                                <span className="text-label font-bold text-content-3 ml-1.5">und</span>
                            </span>
                        </div>
                        <Badge variant="neutral" size="sm" uppercase={false} className="shrink-0">{comoSeDespacha}</Badge>
                    </div>

                    <p className="text-body font-medium leading-relaxed text-content-3">
                        El MAX de hoy es <strong className="text-content-1">{maxHoy.toLocaleString()}</strong>, y
                        aunque la sala quede en cero eso no llega a pedir ni un paquete: el pedido
                        redondea a cero y este producto <strong className="text-content-1">nunca entra</strong>.
                    </p>

                    {sug && (
                        <div data-surface="card" className="px-4 py-3.5 flex flex-col gap-2">
                            <span className="text-micro font-black uppercase tracking-wide text-content-3">Sugerencia</span>
                            <div className="flex items-center gap-2 text-h3 font-black tabular-nums leading-none">
                                <span className="text-content-3">{minHoy.toLocaleString()} · {maxHoy.toLocaleString()}</span>
                                <span className="text-content-3 text-body">→</span>
                                <span className="text-content">{sug.minNuevo.toLocaleString()} · {sug.maxNuevo.toLocaleString()}</span>
                            </div>
                            <p className="text-caption leading-relaxed text-content-3">
                                {sug.maxNuevo.toLocaleString()} es el MAX más chico que alcanza el umbral —
                                el 40% del paquete, el mismo que usa el armado del pedido. El MIN mantiene la
                                proporción que ya tenía el par.
                            </p>
                        </div>
                    )}

                    <p className="text-caption leading-relaxed text-content-3">
                        Si este producto de verdad no se pide de a {(factor * multiplo).toLocaleString()} unidades,
                        lo que hay que cambiar es la regla y no el MAX.
                        {onVerReglas && <> <button type="button" onClick={onVerReglas}
                            className="font-bold text-content-2 underline underline-offset-2">Ver la regla</button>.</>}
                    </p>
                </div>
            </CuerpoDialogo>
        </ModalShell>
    );
}
