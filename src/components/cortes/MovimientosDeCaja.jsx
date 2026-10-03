import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, ChevronRight, HandCoins, History, Paperclip, Pencil, Scale, Search, ShoppingBag, Trash2, Wallet } from 'lucide-react';
import Badge from '../common/Badge';
import Button from '../common/Button';
import LiquidModal from '../common/LiquidModal';
import Notice from '../common/Notice';
import TablePagination from '../common/TablePagination';
import { EmptyState } from '../common/StateViews';
import AvatarConEstado from '../common/AvatarConEstado';
import PhotoLightbox from '../common/PhotoLightbox';
import { getSignedFileUrl } from '@nucleo/utils/storageFiles';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { usePaginaEnUrl } from '../../plataforma/usePaginaEnUrl';
import { filtrarMovimientos, fueEditado as fueEditadoMov, historiaDe as historiaDeMov, historiaPorMovimiento, renglonesDeMovimientos } from '@nucleo/utils/movimientosDeCaja';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { hora12, fechaHora12 } from '@nucleo/utils/hora';
import { diaSV, fechaTexto, relojSV } from '@nucleo/utils/fecha';

/**
 * Los movimientos de caja de un período: verlos y buscarlos TODOS.
 *
 * ── Por qué esta lista existe aparte del detalle de un corte ───────────────
 * `CorteDetalleModal` ya muestra los movimientos de un día para explicar UNA
 * diferencia. Eso contesta «¿por qué no cuadró este corte?», y deja sin
 * contestar la otra pregunta, que es la que trajo esta pantalla: «¿qué se movió
 * en la caja, y quién lo tocó después?».
 *
 * ── Lo que hay que poder ver, y antes no se veía ───────────────────────────
 * Un movimiento se puede EDITAR y BORRAR en el sistema de la caja sin dejar
 * rastro. Desde v2.838.0 la captura lo anota, así que acá una fila puede estar
 * en tres estados y los tres importan:
 *
 *   vigente       está en el sistema y nadie lo tocó.
 *   editado       cambió el monto, el concepto o el tipo después de guardarse.
 *   ya no está    desapareció del sistema. La fila se queda: es lo ÚNICO que
 *                 queda de él, y borrarla acá sería repetir el olvido.
 *
 * El caso real que lo pide: el 22-ago en Salud 1 apareció un ingreso de $454.00
 * —el monto exacto del sobrante del corte anterior— que dejó la diferencia en
 * cero. Un movimiento así no se distingue de uno legítimo mirando el monto; se
 * distingue mirando CUÁNDO apareció y contra qué corte.
 *
 * ── Por qué dejó de ser una tabla (v2.914.0) ───────────────────────────────
 * Era cinco columnas —fecha, sala, concepto, estado, monto— donde todo pesaba
 * lo mismo: un movimiento normal y uno borrado ocupaban el mismo renglón gris y
 * se distinguían por un badge del ancho de un dedo. Pero esta lista no existe
 * para leerse en orden: existe para que salte lo que está mal.
 *
 * Tres cambios, y cada uno contesta una de las preguntas de arriba:
 *
 *  1. **Agrupada por día y por sala, con el neto de cada grupo.** Los
 *     movimientos de una sala son una serie que termina en su corte; mezclados
 *     con los de otra sala hay que reconstruir cuál va con cuál.
 *  2. **El corte, dibujado como línea.** Es la única forma de ver de qué lado
 *     cayó cada movimiento, y era el dato que el párrafo de arriba pedía desde
 *     que se escribió — la hora del corte y la del movimiento ya existían y
 *     nunca se habían puesto una contra otra.
 *  3. **El estado ES la forma de la fila, no un badge.** Un borrado va tachado
 *     y en rojo; un editado muestra el monto anterior tachado al lado del
 *     nuevo. Sin abrir nada, y sin leer una columna que en el teléfono ni
 *     siquiera se dibujaba (`hideBelow: 'md'`).
 *
 * ⚠️ **«Se vio después del corte» sale de la CAPTURA, no del sistema de la
 * caja.** Sus movimientos no publican hora — la tabla tiene `fecha` y nada
 * más—, así que lo que se compara contra el corte es `created_at`, o sea cuándo
 * la captura lo vio por primera vez, con la resolución de su cadencia (30 min).
 * Por eso el rótulo dice «se vio» y no «se anotó»: prometer la hora exacta
 * sería inventarla. Y sólo se marca cuando la captura lo vio EL MISMO DÍA de su
 * fecha; en un movimiento traído por un relleno hacia atrás, `created_at` es la
 * fecha del relleno y la comparación no significaría nada.
 *
 * ── Los cobros de crédito, y por qué no son una lista aparte ───────────────
 * Cobrar un crédito desde el portal mete efectivo en ESTA caja. El sistema de
 * la caja lo anota como un renglón que dice `POR ABONO A CREDITO` y nada más
 * —sin cliente, sin crédito, sin quién cobró—, así que la pregunta que trae a
 * alguien acá al minuto de cobrar («¿se hizo o no se hizo?») no se podía
 * contestar con esta lista: el renglón tarda en llegar, y cuando llega no dice
 * de quién es.
 *
 * Los dos lados se juntan en UNA fila (`emparejarCobrosConMovimientos`), y
 * tiene que ser una: son el mismo dinero, y uno debajo del otro la pantalla
 * diría que se cobró el doble. Lo que no encontró renglón sale como fila
 * propia, y ahí la forma de pago decide qué significa:
 *
 *   con tarjeta o transferencia   nunca entra al cajón, así que allá no se
 *                                 anota NUNCA. Suelto es su estado normal.
 *   en efectivo                   o la captura todavía no pasó, o allá no se
 *                                 anotó. Eso sí hay que poder verlo.
 *
 * El neto del grupo es el mismo antes y después de que la captura pase: un
 * cobro suelto en efectivo suma por su cuenta, y cuando aparece su renglón deja
 * de sumar por su cuenta para sumar como renglón. Sin esa invariante, el neto
 * de una sala cambiaría solo a media tarde sin que nadie hubiera movido nada.
 */

const fechaLarga = (f) => (f
    ? fechaTexto(f, {
        weekday: 'long', day: 'numeric', month: 'long' })
    : '—');

const cuando = (iso) => fechaHora12(iso) || '—';

const horaDe = (iso) => hora12(iso) || null;

const horaReloj = (t) => hora12(t) || '—';

/** El día de El Salvador de una marca de tiempo, para comparar contra `fecha`. */
const diaDe = (iso) => (iso ? diaSV(iso) : null);

// El desempate del orden (el id de la caja comparado como NÚMERO) vive en
// `utils/movimientosDeCaja`, con el resto del orden.

/** Minutos desde medianoche, en hora de sala. Para ordenar y comparar. */
const minutosDeIso = (iso) => {
    if (!iso) return null;
    const d = relojSV(iso);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const minutosDeHora = (t) => {
    if (!t) return null;
    const [h, m] = String(t).split(':').map(Number);
    return Number.isFinite(h) ? h * 60 + (m || 0) : null;
};

// El rótulo de un cambio, en términos de lo que pasó y no del código.
const CAMBIOS = {
    APARECIO:     { texto: 'Se anotó',       variant: 'info',    icon: Wallet },
    EDITADO:      { texto: 'Se modificó',    variant: 'warning', icon: Pencil },
    DESAPARECIO:  { texto: 'Se borró',       variant: 'danger',  icon: Trash2 },
    REAPARECIO:   { texto: 'Volvió a estar', variant: 'info',    icon: History },
};

export default function MovimientosDeCaja({
    movimientos = [],
    historial = [],
    cortes = [],
    cobros = [],
    cobraron,
    salidasDeBolsa = [],
    tiposDeSalida = [],
    sacaron,
    anotados = [],
    anotaron,
    puedeVerBolsas = true,
    salas,
    cargando = false,
    busqueda = '',
    tipo = 'TODOS',
    estado = 'TODOS',
    onLimpiarBusqueda,
}) {
    const [abierto, setAbierto] = useState(null);

    // La historia agrupada por movimiento, una vez. Sin esto, marcar «editado»
    // en la lista costaría un recorrido del historial por fila.
    const historiaPorMov = useMemo(() => historiaPorMovimiento(historial), [historial]);

    const historiaDe = useCallback((mov) => historiaDeMov(historiaPorMov, mov), [historiaPorMov]);

    // «Editado» es haber cambiado DESPUÉS de anotarse: un `APARECIO` suelto es
    // la vida normal de cualquier movimiento, no un hallazgo.
    const fueEditado = useCallback((mov) => fueEditadoMov(historiaPorMov, mov), [historiaPorMov]);

    const ultimaEdicion = useCallback(
        (mov) => historiaDe(mov).filter((h) => h.cambio === 'EDITADO').pop() || null,
        [historiaDe],
    );

    /* Cada cobro del portal con el renglón que la caja anotó por él, y los que
     * no encontraron ninguno. La regla vive en `cortesDiagnostico` —el mismo
     * archivo que reparte los movimientos por corte— y no acá: es una decisión
     * sobre DINERO, y escrita dentro de un componente no se puede probar. */

    /** El rótulo de un motivo de salida sale de la TABLA, nunca de una lista
     *  escrita acá: un motivo nuevo aparecería en la base y no en la pantalla. */
    const etiquetaDeSalida = useCallback(
        (codigo) => tiposDeSalida.find((t) => t.codigo === codigo)?.etiqueta || codigo || 'Salida',
        [tiposDeSalida],
    );

    /* La lista mezclada: los renglones de la caja, los cobros que quedaron
     * sueltos y las salidas de bolsa que ningún vale contó. Se mezclan ANTES de
     * paginar —y no al pintar cada día— porque de otro modo una fila podría
     * caer fuera de la página y desaparecer sin que nada lo diga. */
    // La lista unida y ordenada: `renglonesDeMovimientos` (núcleo).
    const items = useMemo(() => renglonesDeMovimientos({ movimientos, cobros, salidasDeBolsa, anotados }), [movimientos, cobros, salidasDeBolsa, anotados]);

    // El filtro (tipo, estado, búsqueda): `filtrarMovimientos` (núcleo).
    const filtrados = useMemo(() => filtrarMovimientos(items, {
        tipo, estado, busqueda, salas, cobraron, sacaron, anotaron, etiquetaDeSalida, porMov: historiaPorMov,
    }), [items, tipo, estado, busqueda, salas, cobraron, sacaron, anotaron, etiquetaDeSalida, historiaPorMov]);

    const { page, pageSize, totalPages, setPage, setPageSize } = usePaginaEnUrl({ total: filtrados.length });
    const pagina = useMemo(
        () => filtrados.slice((page - 1) * pageSize, page * pageSize),
        [filtrados, page, pageSize],
    );

    /* Los cortes que cuentan efectivo, por día y sala, ordenados por hora.
     *
     * Sólo los de tipo 'C': el cierre del día (Z) y las lecturas (X) no cuentan
     * dinero, así que dibujar su línea diría que un movimiento «cayó después de
     * algo» que no midió nada. */
    const cortesPorGrupo = useMemo(() => {
        const m = new Map();
        for (const c of cortes) {
            if (c.tipo !== 'C') continue;
            const clave = `${c.fecha}:${c.branch_id}`;
            if (!m.has(clave)) m.set(clave, []);
            m.get(clave).push(c);
        }
        for (const lista of m.values()) {
            lista.sort((a, b) => String(a.hora).localeCompare(String(b.hora)));
        }
        return m;
    }, [cortes]);

    /* La página, armada como expediente: día → sala → renglones intercalados
     * con los cortes de esa sala ese día.
     *
     * Cada renglón sale con su minuto en hora de sala —el de la captura para el
     * movimiento, el de la fila para el corte— y se ordena de más nuevo a más
     * viejo, que es el orden con el que se entra a mirar. Un movimiento sin
     * minuto comparable (ver el ⚠️ del encabezado) va al final del grupo, sin
     * cruzar ninguna línea: no se puede afirmar de qué lado cayó. */
    const dias = useMemo(() => {
        const porDia = new Map();
        for (const it of pagina) {
            if (!porDia.has(it.fecha)) porDia.set(it.fecha, new Map());
            const salasDelDia = porDia.get(it.fecha);
            if (!salasDelDia.has(it.branchId)) salasDelDia.set(it.branchId, []);
            salasDelDia.get(it.branchId).push(it);
        }

        return [...porDia.entries()]
            .sort((a, b) => String(b[0]).localeCompare(String(a[0])))
            .map(([fecha, salasDelDia]) => {
                const grupos = [...salasDelDia.entries()]
                    .map(([branchId, lista]) => {
                        /* El minuto comparable de cada fila. En un renglón de la
                         * caja es el de la CAPTURA (ver el ⚠️ del encabezado);
                         * en un cobro del portal es la hora real del cobro, que
                         * el portal sí guarda — y por eso un cobro nunca queda
                         * «sin hora comparable». */
                        const conMinuto = lista.map((it) => {
                            if (it.kind === 'cobro') {
                                return { tipoFila: 'cobro', it, minuto: minutosDeIso(it.cb.created_at) };
                            }
                            if (it.kind === 'bolsa') {
                                return { tipoFila: 'bolsa', it, minuto: minutosDeIso(it.op.registrado_at) };
                            }
                            /* Si lo anotó o lo cobró el portal, su hora es la REAL y no la
                             * de la captura: se compara ésa contra el corte, y
                             * «cayó después» pasa de estimación a hecho. */
                            const real = it.anotado?.registrado_at || it.cobro?.created_at;
                            if (real && diaDe(real) === it.mv.fecha) {
                                return { tipoFila: 'mov', it, minuto: minutosDeIso(real) };
                            }
                            return {
                                tipoFila: 'mov', it,
                                minuto: diaDe(it.mv.created_at) === it.mv.fecha
                                    ? minutosDeIso(it.mv.created_at) : null,
                            };
                        });
                        const cortesAqui = (cortesPorGrupo.get(`${fecha}:${branchId}`) || []).map((c) => ({
                            tipoFila: 'corte', corte: c, minuto: minutosDeHora(c.hora),
                        }));

                        const conHora = conMinuto.filter((f) => f.minuto != null);
                        const sinHora = conMinuto.filter((f) => f.minuto == null);
                        const filas = [...conHora, ...cortesAqui]
                            .sort((a, b) => (b.minuto ?? 0) - (a.minuto ?? 0))
                            .concat(sinHora);

                        /* El neto, con las dos reglas que lo mantienen honesto:
                         *
                         *  · un movimiento que ya no está tampoco está en el
                         *    dinero, y sumarlo daría un neto que no coincide con
                         *    ningún tiquete;
                         *  · un cobro suelto suma sólo si entró al CAJÓN. Los
                         *    emparejados no se cuentan acá —ya los cuenta su
                         *    renglón— y por eso el neto no cambia solo cuando la
                         *    captura pasa. */
                        const neto = lista.reduce((s, it) => {
                            if (it.kind === 'cobro') {
                                return (it.cb.anulado_at || !it.cb.entroAlCajon)
                                    ? s : s + (Number(it.cb.monto) || 0);
                            }
                            // La salida de bolsa NUNCA suma. Ese dinero salió de
                            // la caja en un corte anterior —cuando se embolsó, y
                            // ESO sí es un vale que se ve—, así que restarlo acá
                            // lo contaría dos veces. La fila existe para poder
                            // rastrearla, no para mover el número.
                            if (it.kind === 'bolsa') return s;
                            const mv = it.mv;
                            return mv.desaparecido_at ? s
                                : s + (mv.tipo === 'ENTRADA' ? 1 : -1) * (Number(mv.monto) || 0);
                        }, 0);

                        return {
                            branchId,
                            nombre: salas?.get(branchId) || `Sucursal ${branchId}`,
                            filas, neto, cuantos: lista.length,
                        };
                    })
                    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
                return { fecha, grupos };
            });
    }, [pagina, cortesPorGrupo, salas]);

    /* Cuántos aparecieron DESPUÉS del último corte de su día y sala. Es el
     * hallazgo del 22-ago convertido en número, y va arriba de todo porque
     * quien entra a esta lista con una diferencia en la mano viene a buscar
     * exactamente eso. */
    const tardios = useMemo(() => {
        let n = 0;
        for (const d of dias) {
            for (const g of d.grupos) {
                // Sin una línea de corte no hay «después»: una sala que todavía
                // no cortó tiene todos sus movimientos ANTES del primer corte,
                // no después de ninguno. Sin esta guarda, `vistoCorte` se queda
                // en false hasta el final y el aviso cuenta el día entero —que
                // es exactamente lo contrario de lo que dice.
                if (!g.filas.some((f) => f.tipoFila === 'corte')) continue;
                let vistoCorte = false;
                // Las filas van de más nueva a más vieja: todo lo que aparece
                // ANTES de cruzar la primera línea de corte es posterior a él.
                for (const f of g.filas) {
                    if (f.tipoFila === 'corte') { vistoCorte = true; continue; }
                    if (!vistoCorte && f.minuto != null) n++;
                }
                // Los cobros del portal cuentan igual, y con más razón: su hora
                // es la real y no la de la captura, así que «cayó después del
                // corte» es un hecho y no una estimación.
            }
        }
        return n;
    }, [dias]);

    /* El aviso del permiso que falta. Va acá arriba y no dentro del cuerpo
     * porque también tiene que salir con la lista VACÍA: sin él, «no salió
     * dinero de ninguna bolsa» y «no lo puedo ver» son la misma pantalla, y la
     * policy de `bolsas` devuelve cero filas sin ningún error. */
    const avisoDeBolsas = !puedeVerBolsas && (
        <Notice variant="info" icon={ShoppingBag}>
            Aquí ves lo que la caja anotó y los cobros de crédito. Las salidas pagadas con
            una bolsa de efectivo necesitan el permiso de Bolsas.
        </Notice>
    );

    if (!cargando && filtrados.length === 0) {
        return (
            <div className="space-y-5">
                {avisoDeBolsas}
                {busqueda ? (
                    <EmptyState
                        compact icon={Search} title="Sin resultados"
                        subtitle={`Ningún movimiento coincide con «${busqueda}».`}
                        action={<Button variant="secondary" onClick={onLimpiarBusqueda}>Limpiar la búsqueda</Button>}
                    />
                ) : (
                    <EmptyState
                        compact icon={Wallet} title="Sin movimientos"
                        subtitle="No se anotó ninguna entrada ni salida de efectivo en estas fechas, ni se cobró ningún crédito."
                    />
                )}
            </div>
        );
    }

    return (
        <div className="space-y-5">
            {avisoDeBolsas}

            {tardios > 0 && (
                <Notice variant="warning" icon={Scale}>
                    <span className="font-bold">
                        {tardios === 1
                            ? 'Un movimiento se vio después del corte de su día'
                            : `${tardios} movimientos se vieron después del corte de su día`}
                    </span>
                    <span className="block mt-0.5 font-normal text-content-2">
                        No significa que esté mal. Significa que no se distingue por el monto —hay que
                        mirar cuándo entró—, y por eso queda arriba de la línea del corte.
                    </span>
                </Notice>
            )}

            {dias.map((d) => (
                <section key={d.fecha} className="space-y-4">
                    <h3 className="text-label font-bold text-content capitalize px-1">{fechaLarga(d.fecha)}</h3>

                    {d.grupos.map((g) => (
                        <div key={g.branchId} className="space-y-2">
                            <div className="flex items-center justify-between gap-3 px-1">
                                <h4 className="text-caption font-black uppercase tracking-widest text-content-2">
                                    {g.nombre}
                                </h4>
                                <span className="flex items-center gap-2 text-caption text-content-3">
                                    <span className="tabular-nums">
                                        {g.cuantos} {g.cuantos === 1 ? 'movimiento' : 'movimientos'}
                                    </span>
                                    <span className={`tabular-nums font-bold rounded-full px-2 py-0.5 ${
                                        g.neto > 0 ? 'bg-success/10 text-success-text'
                                            : g.neto < 0 ? 'bg-warning/10 text-warning-text' : 'bg-content-3/10 text-content-2'
                                    }`}>
                                        neto {g.neto > 0 ? '+' : g.neto < 0 ? '−' : ''}{formatMoney(Math.abs(g.neto))}
                                    </span>
                                </span>
                            </div>

                            {/* UNA tarjeta por sala con los renglones adentro,
                                separados por una raya — y no una tarjeta por
                                renglón. Cinco cajas apiladas con su borde y su
                                sombra cada una se leían como cinco cosas
                                sueltas; acá se leen como lo que son, la serie de
                                un día de una caja. */}
                            <div data-surface="card" className="rounded-2xl overflow-hidden divide-y divide-border-card">
                                {g.filas.map((f) => {
                                    if (f.tipoFila === 'corte') {
                                        return <LineaDeCorte key={`x${f.corte.id}`} corte={f.corte} />;
                                    }
                                    const ficha = fichaDe(f.it, {
                                        personas: anotaron || cobraron, etiquetaDeSalida,
                                        minuto: f.minuto, editado: f.it.kind === 'mov' && fueEditado(f.it.mv),
                                        edicion: f.it.kind === 'mov' ? ultimaEdicion(f.it.mv) : null,
                                    });
                                    return (
                                        <FilaDeMovimiento key={f.it.clave} ficha={ficha}
                                            onAbrir={() => setAbierto(ficha)} />
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </section>
            ))}

            {!cargando && filtrados.length > pageSize && (
                <TablePagination
                    page={page}
                    totalPages={totalPages}
                    onPageChange={setPage}
                    pageSize={pageSize}
                    onPageSizeChange={setPageSize}
                    total={filtrados.length}
                    unit="movimientos"
                />
            )}

            <DetalleDelMovimiento
                ficha={abierto}
                historia={abierto?.mv ? historiaDe(abierto.mv) : []}
                sala={abierto ? salas?.get(abierto.branchId) : ''}
                onClose={() => setAbierto(null)}
            />
        </div>
    );
}

/* El ícono y el tono de cada clase. Lo que se lee antes de leer: verde entra,
 * ámbar sale, rojo ya no está, gris no toca el cajón. */
const TONOS = {
    entra:  'bg-success/12 text-success-text',
    sale:   'bg-warning/10 text-warning-text',
    ido:    'bg-danger/10 text-danger-text',
    neutro: 'bg-content-3/10 text-content-2',
    cobro:  'bg-brand/10 text-brand-text',
};
const COLOR_MONTO = {
    entra: 'text-success-text', sale: 'text-warning-text', ido: 'text-danger-text line-through',
    neutro: 'text-content-3', cobro: 'text-success-text',
};

/* Cómo se obtuvo el monto de un renglón anotado en el portal. */
const ORIGEN_DEL_MONTO = {
    FOTO_CONFIRMADA: 'Leído de la boleta y confirmado',
    FOTO_SIN_CONFIRMAR: 'Leído de la boleta, sin confirmar',
    A_MANO: 'Escrito a mano',
};

/* El concepto que la caja guarda de un renglón anotado en el portal empieza con
 * el número del portal («P3181 Aplicacion de…»): es la llave que usa la captura
 * y para quien lee es ruido. Con el registro del portal a mano, se usa su
 * concepto entero, que además no viene recortado a 50 caracteres. */
const sinFolioDelPortal = (t) => String(t || '').replace(/^P\d+\s+/, '');

/** «Qué · dato · dato» → el QUÉ en grande y el resto debajo. */
const partirConcepto = (t) => {
    const partes = String(t || '').split(' · ').map((x) => x.trim()).filter(Boolean);
    return { principal: partes[0] || 'Sin concepto', resto: partes.slice(1).join(' · ') };
};

const montoConSigno = (entra, monto) => `${entra ? '+' : '−'}${formatMoney(Math.abs(Number(monto) || 0))}`;

/**
 * Todo lo que se sabe de un renglón, armado UNA vez para la fila y para el
 * detalle. Son tres fuentes con forma distinta —el renglón de la caja (con o
 * sin su registro del portal y su cobro), el cobro suelto y la salida de
 * bolsa— y escribir la fila y el detalle por fuente eran seis componentes que
 * decían lo mismo de seis maneras.
 */
function fichaDe(it, { personas, etiquetaDeSalida, minuto, editado, edicion }) {
    if (it.kind === 'cobro') {
        const cb = it.cb;
        const anulado = Boolean(cb.anulado_at);
        const entra = Boolean(cb.entroAlCajon);
        return {
            clave: it.clave, branchId: cb.branch_id, fecha: it.fecha,
            Icono: HandCoins, tono: anulado ? 'ido' : entra ? 'cobro' : 'neutro',
            tipo: 'Cobro de crédito',
            principal: 'Cobro de crédito', resto: cb.cliente || 'Sin nombre',
            concepto: `Cobro de crédito · ${cb.cliente || 'Sin nombre'}`,
            hora: horaDe(cb.created_at), horaExacta: true,
            monto: cb.monto, entra: true, montoNota: Number(cb.saldo_despues) > 0.004
                ? `queda ${formatMoney(cb.saldo_despues)}` : 'saldado',
            quien: personas?.get(cb.abonado_por), rotuloQuien: 'Lo cobró',
            foto: cb.comprobante_url || null,
            marcas: [
                anulado && ['danger', 'Anulado'],
                !anulado && (entra ? ['warning', 'Todavía no aparece en la caja'] : ['neutral', 'No entra al cajón']),
            ].filter(Boolean),
            datos: datosDelCobro(cb),
        };
    }
    if (it.kind === 'bolsa') {
        const op = it.op;
        const anulada = Boolean(op.anulada_at);
        const parcial = op.cubiertoPorVales > 0.005;
        return {
            clave: it.clave, branchId: op.branch_id, fecha: it.fecha,
            Icono: ShoppingBag, tono: anulada ? 'ido' : 'neutro',
            tipo: 'Salida de una bolsa',
            principal: etiquetaDeSalida(op.tipo), resto: op.entidad || '',
            concepto: `${etiquetaDeSalida(op.tipo)}${op.entidad ? ` · ${op.entidad}` : ''}`,
            hora: horaDe(op.registrado_at), horaExacta: true,
            monto: op.montoSinVale, entra: false,
            montoNota: parcial ? `de ${formatMoney(op.monto)} · el resto, en el vale` : 'de una bolsa ya cerrada',
            quien: personas?.get(op.registrado_por), rotuloQuien: 'La hizo',
            foto: op.foto_url || null,
            marcas: [anulada && ['danger', 'Anulada'], ['neutral', 'Salió de una bolsa']].filter(Boolean),
            datos: [
                ['Motivo', etiquetaDeSalida(op.tipo)],
                ['A nombre de', op.entidad],
                ['Folio', op.folio],
                ['Boleta', op.numero_boleta],
                ['Monto de la operación', formatMoney(op.monto)],
                ['Fuera de un vale', formatMoney(op.montoSinVale)],
            ],
        };
    }

    const mv = it.mv;
    const an = it.anotado;
    const cb = it.cobro;
    const ido = Boolean(mv.desaparecido_at);
    const entra = mv.tipo === 'ENTRADA';
    const texto = cb ? `Cobro de crédito · ${cb.cliente || 'Sin nombre'}`
        : (an?.detalle || an?.concepto || sinFolioDelPortal(mv.concepto) || 'Sin concepto');
    const { principal, resto } = partirConcepto(texto);
    const montoAntes = edicion && Number(edicion.monto_antes) !== Number(edicion.monto_despues)
        ? edicion.monto_antes : null;
    /* La hora EXACTA cuando el portal la anotó; si no, la de la captura, que
     * es «cuándo se vio» y así se rotula (ver el ⚠️ del encabezado). */
    const real = an?.registrado_at || cb?.created_at || null;
    const horaExacta = Boolean(real);
    const hora = horaExacta ? horaDe(real) : (minuto != null ? horaDe(mv.created_at) : null);
    const quienCobro = cb && personas?.get(cb.abonado_por);
    const quienAnoto = an && personas?.get(an.registrado_por);
    const dudoso = an?.monto_origen && an.monto_origen !== 'FOTO_CONFIRMADA';

    return {
        clave: it.clave, branchId: mv.branch_id, fecha: it.fecha, mv,
        Icono: ido ? Trash2 : cb ? HandCoins : entra ? ArrowDownLeft : ArrowUpRight,
        tono: ido ? 'ido' : entra ? 'entra' : 'sale',
        tipo: cb ? 'Cobro de crédito' : entra ? 'Entrada de efectivo' : 'Salida de efectivo',
        principal, resto, concepto: texto,
        hora, horaExacta,
        monto: mv.monto, entra,
        montoNota: montoAntes != null ? `antes ${montoConSigno(entra, montoAntes)}` : null,
        montoNotaTachada: montoAntes != null,
        quien: quienCobro || quienAnoto, rotuloQuien: quienCobro ? 'Lo cobró' : 'Lo anotó',
        foto: an?.foto_url || cb?.comprobante_url || null,
        desglose: it.desglose?.map((d) => ({ ...d, etiqueta: etiquetaDeSalida(d.op.tipo) })) || null,
        marcas: [
            ido && ['danger', 'Ya no está'],
            !ido && editado && ['warning', 'Se modificó'],
            dudoso && ['warning', ORIGEN_DEL_MONTO[an.monto_origen]],
            it.desglose?.length > 0 && ['neutral', `${it.desglose.length} ${it.desglose.length === 1 ? 'salida' : 'salidas'} de bolsa`],
        ].filter(Boolean),
        datos: [
            ['Boleta', an?.numero_boleta],
            ['N.º en la caja', mv.erp_movimiento_id],
            ['Monto', an?.monto_origen ? ORIGEN_DEL_MONTO[an.monto_origen] : null],
            ['Se anotó', an ? 'desde el portal' : 'directo en la caja'],
            ...(cb ? datosDelCobro(cb) : []),
            ido && ['Dejó de estar', cuando(mv.desaparecido_at), true],
        ].filter(Boolean),
    };
}

function datosDelCobro(cb) {
    return [
        ['Cliente', cb.cliente],
        ['Crédito', cb.credito_erp ? `n.º ${cb.credito_erp}` : null],
        ['Factura', cb.factura_erp],
        ['Forma de pago', cb.forma ? String(cb.forma).charAt(0).toUpperCase() + String(cb.forma).slice(1).toLowerCase() : null],
        ['Documento', cb.documento],
        ['Debía', cb.saldo_antes != null ? formatMoney(cb.saldo_antes) : null],
        ['Queda debiendo', Number(cb.saldo_despues) > 0.004 ? formatMoney(cb.saldo_despues) : 'Nada · crédito saldado'],
    ];
}

/**
 * El corte, dibujado como una franja que cruza la serie.
 *
 * No es un separador decorativo: es el instante contra el que se mide todo lo
 * de arriba. Por eso lleva su cifra —el corte que cuadró justo después de un
 * ingreso es exactamente el caso que hay que poder ver— y no es pulsable: el
 * detalle de un corte vive en su pestaña.
 */
function LineaDeCorte({ corte }) {
    const dif = Number(corte.diferencia_erp);
    const cuadra = !Number.isFinite(dif) || Math.abs(dif) < 0.005;
    const tono = cuadra ? 'text-brand-text' : dif > 0 ? 'text-warning-text' : 'text-danger-text';
    return (
        <div className="flex items-center gap-3 px-4 py-2 bg-brand/5" role="separator"
            aria-label={`Corte de las ${horaReloj(corte.hora)}`}>
            <Scale size={14} className={`shrink-0 ${tono}`} aria-hidden="true" />
            <span className="text-caption font-bold text-content-2">
                Corte de las {horaReloj(corte.hora)}
            </span>
            <span className="h-px flex-1 bg-brand/20" aria-hidden="true" />
            <span className="text-caption tabular-nums text-content-2">{formatMoney(corte.total_declarado)}</span>
            <span className={`text-caption font-bold tabular-nums ${tono}`}>
                {cuadra ? 'cuadró' : `${dif > 0 ? '+' : '−'}${formatMoney(Math.abs(dif))}`}
            </span>
        </div>
    );
}

/** Una marca con el tono de `Badge`. */
const marcaDe = ([variant, texto]) => (
    <Badge key={texto} variant={variant} size="sm">{texto}</Badge>
);

/**
 * Un renglón de la serie. La forma dice el estado; las marcas sólo lo nombran.
 *
 * Arriba el QUÉ, debajo el dato que lo distingue (la factura, la cuenta, el
 * cliente), y en la tercera línea cuándo y quién — con su cara. A la derecha,
 * el monto con signo y, si cambió, el anterior tachado: es el dato, y no puede
 * estar detrás de un clic.
 */
function FilaDeMovimiento({ ficha: f, onAbrir }) {
    const ido = f.tono === 'ido';
    return (
        <button type="button" onClick={onAbrir} data-interactive
            className="w-full text-left flex items-center gap-3 px-4 py-3
                       min-h-[var(--tap-min)] transition-colors hover:bg-surface-input/40
                       active:scale-[0.995]"
            title="Ver el detalle">
            <span className={`shrink-0 w-10 h-10 rounded-full grid place-items-center ${TONOS[f.tono]}`} aria-hidden="true">
                <f.Icono size={18} strokeWidth={2} />
            </span>

            <span className="flex-1 min-w-0 space-y-0.5">
                <span className={`block text-body-sm font-semibold truncate ${
                    ido ? 'text-content-3 line-through' : 'text-content'}`}>
                    {f.principal}
                </span>
                {f.resto && (
                    <span className="block text-caption text-content-2 truncate">{f.resto}</span>
                )}
                <span className="flex items-center gap-x-2 gap-y-1 flex-wrap text-micro text-content-3">
                    <span className="tabular-nums">
                        {f.hora ? (f.horaExacta ? f.hora : `se vio ${f.hora}`) : 'sin hora comparable'}
                    </span>
                    {f.quien && (
                        <span className="flex items-center gap-1 min-w-0">
                            <AvatarConEstado emp={f.quien} px={16} radio="rounded-full" marco="" />
                            <span className="truncate">{shortEmployeeName(f.quien)}</span>
                        </span>
                    )}
                    {f.foto && (
                        <span className="flex items-center gap-0.5">
                            <Paperclip size={12} aria-hidden="true" /> boleta
                        </span>
                    )}
                    {f.marcas.map(marcaDe)}
                </span>
            </span>

            <span className="shrink-0 text-right">
                <span className={`block text-body font-black tabular-nums ${COLOR_MONTO[f.tono]}`}>
                    {montoConSigno(f.entra, f.monto)}
                </span>
                {f.montoNota && (
                    <span className={`block text-micro text-content-3 tabular-nums ${f.montoNotaTachada ? 'line-through' : ''}`}>
                        {f.montoNota}
                    </span>
                )}
            </span>
            <ChevronRight size={16} className="shrink-0 text-content-3" aria-hidden="true" />
        </button>
    );
}

/**
 * La ficha de un renglón: todo lo que se sabe de él y todo lo que se le vio
 * cambiar.
 *
 * Muestra «visto por última vez» incluso cuando no pasó nada: «se confirmó que
 * seguía ahí a tal hora» es información, y su ausencia es lo que haría dudar de
 * un «desapareció» — la marca sólo vale si se sabe cuándo fue la última vez que
 * se miró.
 */
function DetalleDelMovimiento({ ficha: f, historia, sala, onClose }) {
    /* La boleta se firma al abrir, no al cargar la lista: es un bucket privado
     * y pedir un enlace por renglón sería pedir cien que nadie mira. */
    const [foto, setFoto] = useState(null);       // { de, url } | { de, error }
    const [ampliada, setAmpliada] = useState(null);
    const clave = f?.clave;
    const ruta = f?.foto;
    useEffect(() => {
        if (!ruta) return undefined;
        let vivo = true;
        getSignedFileUrl(ruta)
            .then((url) => { if (vivo) setFoto(url ? { de: clave, url } : { de: clave, error: true }); })
            .catch(() => { if (vivo) setFoto({ de: clave, error: true }); });
        return () => { vivo = false; };
    }, [clave, ruta]);

    if (!f) return null;
    const ido = f.tono === 'ido';
    const fotoDeEsta = foto?.de === f.clave ? foto : null;
    const datos = [
        ['Sala', sala],
        ['Fecha', fechaLarga(f.fecha)],
        // Con la persona a la vista, la hora ya va en su renglón.
        ['Hora', f.hora && !(f.quien && f.horaExacta) ? (f.horaExacta ? f.hora : `se vio ${f.hora}`) : null],
        ...f.datos,
    ].filter(([, v]) => v != null && v !== '');

    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-lg" ariaLabel="Detalle del movimiento de caja">
            <LiquidModal.Header>
                <div className="flex items-start gap-3">
                    <span className={`shrink-0 w-12 h-12 rounded-2xl grid place-items-center ${TONOS[f.tono]}`} aria-hidden="true">
                        <f.Icono size={22} strokeWidth={2} />
                    </span>
                    <div className="min-w-0 flex-1">
                        <p className="text-caption font-black uppercase tracking-widest text-content-3">{f.tipo}</p>
                        <p className={`text-display font-black tabular-nums leading-tight ${COLOR_MONTO[f.tono]}`}>
                            {montoConSigno(f.entra, f.monto)}
                        </p>
                        {f.montoNota && (
                            <p className={`text-caption text-content-3 tabular-nums ${f.montoNotaTachada ? 'line-through' : ''}`}>
                                {f.montoNota}
                            </p>
                        )}
                    </div>
                </div>
                {f.marcas.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-3">{f.marcas.map(marcaDe)}</div>
                )}
            </LiquidModal.Header>

            <LiquidModal.Body className="space-y-5">
                <p className={`text-body font-semibold break-words ${ido ? 'text-content-3 line-through' : 'text-content'}`}>
                    {f.concepto}
                </p>

                {f.quien && (
                    <div className="flex items-center gap-3 rounded-xl bg-surface-input/40 px-3 py-2.5">
                        <AvatarConEstado emp={f.quien} px={36} radio="rounded-full" marco="" />
                        <div className="min-w-0">
                            <p className="text-micro font-bold uppercase tracking-wider text-content-3">{f.rotuloQuien}</p>
                            <p className="text-body-sm font-semibold text-content truncate">{shortEmployeeName(f.quien)}</p>
                        </div>
                        {f.hora && f.horaExacta && (
                            <span className="ml-auto text-caption tabular-nums text-content-3">{f.hora}</span>
                        )}
                    </div>
                )}

                <dl className="grid grid-cols-2 gap-2">
                    {datos.map(([rotulo, valor, alerta]) => (
                        <div key={rotulo} className="rounded-xl bg-surface-input/40 px-3 py-2 min-w-0">
                            <dt className="text-micro font-bold uppercase tracking-wider text-content-3">{rotulo}</dt>
                            <dd className={`text-body-sm font-semibold break-words ${alerta ? 'text-danger-text' : 'text-content'}`}>
                                {valor}
                            </dd>
                        </div>
                    ))}
                </dl>

                {/* La boleta, ahí mismo: quien la mira la está comparando contra
                    el monto de arriba. Ampliarla es un toque más. */}
                {f.foto && (
                    <div className="space-y-1.5">
                        <h4 className="text-caption font-black uppercase tracking-widest text-content-2">Boleta</h4>
                        {!fotoDeEsta ? (
                            <div className="h-40 rounded-xl bg-surface-input/40 animate-pulse" />
                        ) : fotoDeEsta.error ? (
                            <p className="text-caption text-danger-text">No se pudo abrir la boleta. Vuelve a intentarlo.</p>
                        ) : (
                            <button type="button" onClick={() => setAmpliada(fotoDeEsta.url)}
                                aria-label="Ampliar la boleta"
                                className="block w-full rounded-xl overflow-hidden min-h-[var(--tap-min)] active:scale-[0.99]">
                                <img src={fotoDeEsta.url} alt={`Boleta de ${f.principal}`}
                                    className="w-full max-h-72 object-contain bg-surface-input/40" />
                            </button>
                        )}
                    </div>
                )}

                {/* El vale, abierto: `VALE DE CAJA 8 (3 salidas)` es un TOTAL, y
                    las salidas que lo componen no estaban en ninguna pantalla.
                    Cada línea lleva lo que aportó a ESTE vale. */}
                {f.desglose?.length > 0 && (
                    <div className="space-y-1.5">
                        <h4 className="text-caption font-black uppercase tracking-widest text-content-2">Lo que suma el vale</h4>
                        <div className="rounded-xl bg-surface-input/40 px-3 py-2 divide-y divide-border-card">
                            {f.desglose.map(({ op, monto, etiqueta }) => (
                                <div key={op.id} className="flex items-baseline justify-between gap-3 py-1.5 text-caption">
                                    <span className="text-content-2 min-w-0 truncate">
                                        {op.folio}
                                        <span className="text-content-3">
                                            {' · '}{etiqueta || op.tipo}{op.entidad ? ` · ${op.entidad}` : ''}
                                        </span>
                                    </span>
                                    <span className="flex items-baseline gap-2 shrink-0 tabular-nums">
                                        <span className="text-content font-semibold">{formatMoney(monto)}</span>
                                        {Math.abs(Number(op.monto) - monto) > 0.005 && (
                                            <span className="text-content-3">de {formatMoney(op.monto)}</span>
                                        )}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Sólo los renglones de la caja tienen historia: un cobro o una
                    salida de bolsa no se editan ni desaparecen allá. */}
                {f.mv && (
                    <div className="space-y-2">
                        <div className="flex items-baseline justify-between gap-3 flex-wrap">
                            <h4 className="text-caption font-black uppercase tracking-widest text-content-2">
                                Qué se le vio cambiar
                            </h4>
                            <span className="text-micro text-content-3 tabular-nums">
                                visto {cuando(f.mv.created_at)} · última vez {cuando(f.mv.visto_at)}
                            </span>
                        </div>
                        {historia.length === 0 ? (
                            <p className="text-body-sm text-content-3">
                                Nada desde que se anotó. Los cambios se registran desde el 28 de agosto.
                            </p>
                        ) : (
                            <ol className="relative space-y-3 pl-6">
                                <span className="absolute left-[9px] top-1 bottom-1 w-px bg-border-card" aria-hidden="true" />
                                {historia.map((h) => {
                                    const c = CAMBIOS[h.cambio] || CAMBIOS.APARECIO;
                                    const Icono = c.icon;
                                    return (
                                        <li key={h.id} className="relative">
                                            <span className={`absolute -left-6 top-0 w-[19px] h-[19px] rounded-full grid place-items-center ${
                                                c.variant === 'danger' ? 'bg-danger/15 text-danger-text'
                                                    : c.variant === 'warning' ? 'bg-warning/15 text-warning-text'
                                                        : 'bg-brand/10 text-brand-text'}`} aria-hidden="true">
                                                <Icono size={11} strokeWidth={2.5} />
                                            </span>
                                            <p className="text-body-sm text-content">
                                                <span className="font-semibold">{c.texto}</span>
                                                <span className="text-content-3"> · {cuando(h.observado_at)}</span>
                                            </p>
                                            {h.cambio === 'EDITADO' && (
                                                <p className="text-caption text-content-2">
                                                    {Number(h.monto_antes) !== Number(h.monto_despues)
                                                        && `${formatMoney(h.monto_antes)} → ${formatMoney(h.monto_despues)}`}
                                                    {h.concepto_antes !== h.concepto_despues
                                                        && ` «${h.concepto_antes || '—'}» → «${h.concepto_despues || '—'}»`}
                                                    {h.tipo_antes !== h.tipo_despues
                                                        && ` ${h.tipo_antes} → ${h.tipo_despues}`}
                                                </p>
                                            )}
                                        </li>
                                    );
                                })}
                            </ol>
                        )}
                    </div>
                )}
            </LiquidModal.Body>

            <LiquidModal.Footer>
                <span />
                <Button variant="secondary" onClick={onClose}>Cerrar</Button>
            </LiquidModal.Footer>

            <PhotoLightbox src={ampliada} alt="Boleta del movimiento" onClose={() => setAmpliada(null)} />
        </LiquidModal>
    );
}
