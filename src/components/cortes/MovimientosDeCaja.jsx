import React, { useCallback, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, HandCoins, History, Pencil, Scale, Search, ShoppingBag, Trash2, Wallet } from 'lucide-react';
import Badge from '../common/Badge';
import Button from '../common/Button';
import LiquidModal from '../common/LiquidModal';
import Notice from '../common/Notice';
import TablePagination from '../common/TablePagination';
import { EmptyState } from '../common/StateViews';
import AvatarConEstado from '../common/AvatarConEstado';
import { formatMoney } from '../../utils/formatNumber';
import { tokenMatch } from '../../utils/searchUtils';
import { usePaginaEnUrl } from '../../hooks/usePaginaEnUrl';
import { emparejarCobrosConMovimientos } from '../../utils/cortesDiagnostico';
import { cobroEnEfectivo } from '../../data/creditos';

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
    ? new Date(`${f}T12:00:00Z`).toLocaleDateString('es-SV', {
        weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
    })
    : '—');

const cuando = (iso) => (iso
    ? new Date(iso).toLocaleString('es-SV', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
        timeZone: 'America/El_Salvador',
    })
    : '—');

const horaDe = (iso) => (iso
    ? new Date(iso).toLocaleTimeString('es-SV', {
        hour: '2-digit', minute: '2-digit', timeZone: 'America/El_Salvador',
    })
    : null);

const hhmm = (t) => (t ? String(t).slice(0, 5) : '—');

/** El día de El Salvador de una marca de tiempo, para comparar contra `fecha`. */
const diaSV = (iso) => (iso
    ? new Date(new Date(iso).getTime() - 6 * 3600_000).toISOString().slice(0, 10)
    : null);

/* El último desempate del orden. Los renglones de la caja se desempatan por
 * `erp_movimiento_id`, que es un NÚMERO —comparado como texto, «9» quedaría
 * después de «43912»—, y una salida de bolsa por su id, que es un uuid. */
const desempatar = (a, b) => {
    const na = Number(a); const nb = Number(b);
    return (Number.isFinite(na) && Number.isFinite(nb))
        ? nb - na
        : String(b ?? '').localeCompare(String(a ?? ''));
};

/** Minutos desde medianoche, en hora de sala. Para ordenar y comparar. */
const minutosDeIso = (iso) => {
    if (!iso) return null;
    const d = new Date(new Date(iso).getTime() - 6 * 3600_000);
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
    const historiaPorMov = useMemo(() => {
        const m = new Map();
        for (const h of historial) {
            const clave = `${h.branch_id}:${h.erp_movimiento_id}`;
            if (!m.has(clave)) m.set(clave, []);
            m.get(clave).push(h);
        }
        return m;
    }, [historial]);

    const historiaDe = useCallback(
        (mov) => historiaPorMov.get(`${mov.branch_id}:${mov.erp_movimiento_id}`) || [],
        [historiaPorMov],
    );

    // «Editado» es haber cambiado DESPUÉS de anotarse: un `APARECIO` suelto es
    // la vida normal de cualquier movimiento, no un hallazgo.
    const fueEditado = useCallback(
        (mov) => historiaDe(mov).some((h) => h.cambio === 'EDITADO'),
        [historiaDe],
    );

    const ultimaEdicion = useCallback(
        (mov) => historiaDe(mov).filter((h) => h.cambio === 'EDITADO').pop() || null,
        [historiaDe],
    );

    /* Cada cobro del portal con el renglón que la caja anotó por él, y los que
     * no encontraron ninguno. La regla vive en `cortesDiagnostico` —el mismo
     * archivo que reparte los movimientos por corte— y no acá: es una decisión
     * sobre DINERO, y escrita dentro de un componente no se puede probar. */
    const { porMovimiento, sueltos } = useMemo(
        () => emparejarCobrosConMovimientos(movimientos, cobros, cobroEnEfectivo),
        [movimientos, cobros],
    );

    /* ── El renglón «VALE DE CAJA 8 (3 salidas)», abierto ──────────────────
     *
     * Ese renglón es un TOTAL: $180.00 que la caja descontó de una vez, y las
     * tres salidas que lo componen no estaban en ninguna pantalla de Efectivo.
     * Acá se ponen debajo, y no hay que adivinar cuál es cuál — la cadena
     * `bolsas_movimientos.caja_vale_id → caja_vales_portal.erp_movimiento_id`
     * es exacta (verificado sobre los 3 vales que existen: las sumas cierran al
     * centavo). Es lo contrario del cruce por monto que hay que hacer con los
     * cobros, y por eso acá no hay reparto que resolver.
     *
     * La clave lleva la SALA además del id del movimiento: `erp_movimiento_id`
     * es del sistema de origen y se repite entre salas. */
    const desglosePorVale = useMemo(() => {
        const m = new Map();
        for (const op of salidasDeBolsa) {
            for (const [erp, monto] of op.porVale || []) {
                const clave = `${op.branch_id}:${erp}`;
                if (!m.has(clave)) m.set(clave, []);
                m.get(clave).push({ op, monto });
            }
        }
        for (const lista of m.values()) lista.sort((a, b) => b.monto - a.monto);
        return m;
    }, [salidasDeBolsa]);

    /* Las salidas de bolsa que NINGÚN vale contó. Son las que hasta hoy no
     * aparecían en ninguna pantalla de Efectivo: 65 salidas y $15,072.74
     * medidos el 2026-09-03. Su dinero salió de la caja en un corte anterior
     * —cuando se embolsó, que es un vale que sí se ve—, así que la fila existe
     * para poder rastrearla y NO suma al neto. */
    const sueltasDeBolsa = useMemo(
        () => salidasDeBolsa.filter((op) => op.montoSinVale > 0.005),
        [salidasDeBolsa],
    );

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
    const items = useMemo(() => ([
        ...movimientos.map((mv) => ({
            kind: 'mov', clave: `m${mv.id}`, mv, cobro: porMovimiento.get(mv.id) || null,
            desglose: desglosePorVale.get(`${mv.branch_id}:${mv.erp_movimiento_id}`) || null,
            fecha: mv.fecha, branchId: mv.branch_id, orden: mv.created_at,
            desempate: mv.erp_movimiento_id,
        })),
        ...sueltos.map((cb) => ({
            kind: 'cobro', clave: `c${cb.id}`, cb,
            fecha: diaSV(cb.created_at), branchId: cb.branch_id, orden: cb.created_at,
            desempate: cb.id,
        })),
        ...sueltasDeBolsa.map((op) => ({
            kind: 'bolsa', clave: `b${op.id}`, op,
            fecha: diaSV(op.registrado_at), branchId: op.branch_id, orden: op.registrado_at,
            desempate: op.id,
        })),
    ]).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))
        || String(b.orden || '').localeCompare(String(a.orden || ''))
        || desempatar(a.desempate, b.desempate)),
    [movimientos, sueltos, porMovimiento, desglosePorVale, sueltasDeBolsa]);

    const filtrados = useMemo(() => items.filter((it) => {
        if (it.kind === 'cobro') {
            const c = it.cb;
            // Un cobro es siempre una ENTRADA de dinero; y de los tres estados
            // que recorta la ranura —vigente, editado, ya no está— sólo el
            // primero le cabe: los otros dos hablan de lo que pasó con un
            // renglón del sistema de la caja, y un cobro suelto no tiene.
            if (tipo === 'SALIDA') return false;
            if (estado === 'VIGENTES' && c.anulado_at) return false;
            if (estado === 'EDITADOS' || estado === 'DESAPARECIDOS') return false;
            return tokenMatch(busqueda, c.cliente, `crédito ${c.credito_erp}`, c.forma,
                c.documento, cobraron?.get(c.abonado_por)?.name,
                salas?.get(c.branch_id), String(c.monto), 'ENTRADA');
        }
        if (it.kind === 'bolsa') {
            const op = it.op;
            // Sacar dinero de una bolsa es siempre una SALIDA. Y de los tres
            // estados de la ranura sólo le cabe «vigente»: los otros dos hablan
            // de lo que pasó con un renglón del sistema de la caja, y esto no
            // tiene ninguno — ése es justamente el motivo de que exista la fila.
            if (tipo === 'ENTRADA') return false;
            if (estado === 'VIGENTES' && op.anulada_at) return false;
            if (estado === 'EDITADOS' || estado === 'DESAPARECIDOS') return false;
            return tokenMatch(busqueda, op.folio, etiquetaDeSalida(op.tipo), op.entidad,
                op.numero_boleta, sacaron?.get(op.registrado_por)?.name,
                salas?.get(op.branch_id), String(op.monto), 'SALIDA');
        }
        const m = it.mv;
        if (tipo !== 'TODOS' && m.tipo !== tipo) return false;
        if (estado === 'VIGENTES'      && m.desaparecido_at) return false;
        if (estado === 'DESAPARECIDOS' && !m.desaparecido_at) return false;
        if (estado === 'EDITADOS'      && !fueEditado(m)) return false;
        // El cobro emparejado también se busca: quien escribe el nombre de la
        // clienta tiene que encontrar el renglón que dice «POR ABONO A
        // CREDITO», que es donde ese nombre no está escrito.
        // El cobro emparejado y las salidas que un vale cubre también se buscan:
        // quien escribe el nombre de la clienta —o el folio de una remesa— tiene
        // que encontrar el renglón que las esconde detrás de un total.
        return tokenMatch(busqueda, m.concepto, salas?.get(m.branch_id), String(m.monto), m.tipo,
            it.cobro?.cliente, it.cobro && `crédito ${it.cobro.credito_erp}`,
            it.cobro && cobraron?.get(it.cobro.abonado_por)?.name,
            ...(it.desglose || []).flatMap((d) => [d.op.folio, d.op.entidad, etiquetaDeSalida(d.op.tipo)]));
    }), [items, tipo, estado, busqueda, salas, fueEditado, cobraron, sacaron, etiquetaDeSalida]);

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
                            return {
                                tipoFila: 'mov', it,
                                minuto: diaSV(it.mv.created_at) === it.mv.fecha
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
                <section key={d.fecha} className="space-y-3">
                    <h3 className="text-label font-bold text-content capitalize px-1">{fechaLarga(d.fecha)}</h3>

                    {d.grupos.map((g) => (
                        <div key={g.branchId} className="space-y-1.5">
                            <div className="flex items-baseline justify-between gap-3 px-1">
                                <h4 className="text-caption font-black uppercase tracking-widest text-content-2">
                                    {g.nombre}
                                </h4>
                                <span className="text-micro text-content-3">
                                    {g.cuantos} {g.cuantos === 1 ? 'movimiento' : 'movimientos'} · neto{' '}
                                    <span className={`tabular-nums font-bold ${
                                        g.neto > 0 ? 'text-success-text' : g.neto < 0 ? 'text-warning-text' : 'text-content-2'
                                    }`}>
                                        {g.neto > 0 ? '+' : g.neto < 0 ? '−' : ''}{formatMoney(Math.abs(g.neto))}
                                    </span>
                                </span>
                            </div>

                            <div className="space-y-1.5">
                                {g.filas.map((f) => {
                                    if (f.tipoFila === 'corte') {
                                        return <LineaDeCorte key={`x${f.corte.id}`} corte={f.corte} />;
                                    }
                                    if (f.tipoFila === 'cobro') {
                                        return (
                                            <RenglonDeCobro
                                                key={f.it.clave}
                                                cobro={f.it.cb}
                                                quien={cobraron?.get(f.it.cb.abonado_por)}
                                            />
                                        );
                                    }
                                    if (f.tipoFila === 'bolsa') {
                                        return (
                                            <RenglonDeBolsa
                                                key={f.it.clave}
                                                op={f.it.op}
                                                etiqueta={etiquetaDeSalida(f.it.op.tipo)}
                                                quien={sacaron?.get(f.it.op.registrado_por)}
                                            />
                                        );
                                    }
                                    return (
                                        <Renglon
                                            key={f.it.clave}
                                            mov={f.it.mv}
                                            cobro={f.it.cobro}
                                            quien={f.it.cobro && cobraron?.get(f.it.cobro.abonado_por)}
                                            desglose={f.it.desglose}
                                            etiquetaDeSalida={etiquetaDeSalida}
                                            minuto={f.minuto}
                                            editado={fueEditado(f.it.mv)}
                                            edicion={ultimaEdicion(f.it.mv)}
                                            onAbrir={() => setAbierto(f.it.mv)}
                                        />
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
                movimiento={abierto}
                historia={abierto ? historiaDe(abierto) : []}
                sala={abierto ? salas?.get(abierto.branch_id) : ''}
                onClose={() => setAbierto(null)}
            />
        </div>
    );
}

/**
 * El corte, dibujado como una línea que cruza la lista.
 *
 * No es un separador decorativo: es el instante contra el que se mide todo lo
 * de arriba. Por eso lleva su cifra —el corte que cuadró justo después de un
 * ingreso es exactamente el caso que hay que poder ver— y no es pulsable: el
 * detalle de un corte vive en su pestaña, y llevar de una lista a otra al tocar
 * una línea sería un destino que nadie pidió.
 */
function LineaDeCorte({ corte }) {
    const dif = Number(corte.diferencia_erp);
    const cuadra = !Number.isFinite(dif) || Math.abs(dif) < 0.005;
    return (
        <div className="flex items-center gap-2 py-1" role="separator"
            aria-label={`Corte de las ${hhmm(corte.hora)}`}>
            <span className="h-px flex-1 bg-brand/25" aria-hidden="true" />
            <span className="shrink-0">
                <Badge variant={cuadra ? 'info' : dif > 0 ? 'warning' : 'danger'} size="sm" icon={Scale}>
                    Corte {hhmm(corte.hora)} · {formatMoney(corte.total_declarado)}
                    {!cuadra && ` · ${dif > 0 ? '+' : '−'}${formatMoney(Math.abs(dif))}`}
                </Badge>
            </span>
            <span className="h-px flex-1 bg-brand/25" aria-hidden="true" />
        </div>
    );
}

/**
 * Un movimiento. La forma dice el estado; el badge sólo lo nombra.
 *
 * El carril de color de la izquierda y el glifo son lo que se ve antes de leer:
 * verde entra, ámbar sale, rojo ya no está. Un editado muestra el monto
 * anterior tachado AL LADO del nuevo — que es el dato, y estaba escondido
 * detrás de un clic.
 */
function Renglon({ mov, cobro, quien, desglose, etiquetaDeSalida, minuto, editado, edicion, onAbrir }) {
    const ido = Boolean(mov.desaparecido_at);
    const entra = mov.tipo === 'ENTRADA';
    const Glifo = ido ? Trash2 : entra ? ArrowDownLeft : ArrowUpRight;

    const carril = ido ? 'bg-danger' : entra ? 'bg-success' : 'bg-warning';
    const cajaGlifo = ido ? 'bg-danger/10 text-danger-text'
        : entra ? 'bg-success/10 text-success-text' : 'bg-warning/10 text-warning-text';
    const colorMonto = ido ? 'text-danger-text line-through'
        : entra ? 'text-success-text' : 'text-warning-text';

    const montoAntes = edicion && Number(edicion.monto_antes) !== Number(edicion.monto_despues)
        ? edicion.monto_antes : null;

    const hora = minuto != null ? horaDe(mov.created_at) : null;

    const fila = (
        <button type="button" onClick={onAbrir} data-interactive
            className="w-full text-left rounded-xl overflow-hidden flex items-stretch gap-0
                       min-h-[var(--tap-min)] active:scale-[0.99] transition-transform"
            data-surface="card"
            title="Ver todo lo que se le vio cambiar">
            <span className={`w-1 shrink-0 ${carril}`} aria-hidden="true" />
            <span className="flex items-center gap-3 flex-1 min-w-0 p-2.5">
                <span className={`shrink-0 w-8 h-8 rounded-lg grid place-items-center ${cajaGlifo}`} aria-hidden="true">
                    <Glifo className="w-4 h-4" />
                </span>

                <span className="flex-1 min-w-0">
                    {/* El nombre de quien pagó GANA al concepto cuando lo hay.
                        «POR ABONO A CREDITO» es la misma cadena en todos los
                        renglones de abono: como título no distingue uno de otro,
                        y el dato con el que alguien vuelve a encontrar un cobro
                        es el cliente. El concepto no se pierde — baja al
                        renglón de abajo, donde sigue diciendo de qué es. */}
                    <span className={`block text-body-sm font-semibold truncate ${
                        ido ? 'text-content-3 line-through' : 'text-content'}`}>
                        {cobro ? `Cobro de crédito · ${cobro.cliente || 'Sin nombre'}`
                            : (mov.concepto || 'Sin concepto')}
                    </span>
                    <span className="flex items-center gap-1.5 flex-wrap text-micro text-content-3">
                        {ido && <Badge variant="danger" size="sm">Ya no está</Badge>}
                        {!ido && editado && <Badge variant="warning" size="sm">Se modificó</Badge>}
                        {(cobro || mov.origen === 'PORTAL') && <Badge variant="info" size="sm">Del portal</Badge>}
                        {cobro && `crédito ${cobro.credito_erp} · `}
                        {hora ? `se vio ${hora}` : 'sin hora comparable'}
                        {ido && ` · dejó de estar ${cuando(mov.desaparecido_at)}`}
                    </span>
                    {/* Quién cobró. Es lo que el sistema de la caja no guarda de
                        ningún renglón, y lo primero que se pregunta cuando un
                        cobro no cuadra. */}
                    {cobro && quien && (
                        <span className="flex items-center gap-1.5 mt-1 min-w-0">
                            <AvatarConEstado emp={quien} px={18} radio="rounded-full" marco="" />
                            <span className="text-micro text-content-3 truncate">
                                Lo cobró {quien.name}
                            </span>
                        </span>
                    )}
                </span>

                <span className="shrink-0 text-right">
                    <span className={`block text-body font-black tabular-nums ${colorMonto}`}>
                        {entra ? '+' : '−'}{formatMoney(mov.monto)}
                    </span>
                    {montoAntes != null && (
                        <span className="block text-micro text-content-3 tabular-nums line-through">
                            antes {entra ? '+' : '−'}{formatMoney(montoAntes)}
                        </span>
                    )}
                </span>
            </span>
        </button>
    );

    if (!desglose?.length) return fila;

    /* ── El vale, abierto ──────────────────────────────────────────────────
     *
     * `VALE DE CAJA 8 (3 salidas) · $180.00` es un TOTAL, y las tres salidas
     * que lo componen no estaban en ninguna pantalla de Efectivo. Van DEBAJO y
     * fuera del botón: son datos, no un segundo destino — el detalle de cada
     * salida vive en Bolsas, y llevar de una lista a otra al tocar un renglón
     * sería un destino que nadie pidió.
     *
     * Cada línea lleva lo que aportó a ESTE vale y no el monto de la operación:
     * una salida grande se reparte entre las bolsas que alcancen, así que su
     * total puede ser mucho mayor que lo que este vale descontó. */
    return (
        <div className="space-y-1">
            {fila}
            <div className="ml-4 rounded-lg bg-surface-input/40 px-3 py-2 space-y-1">
                {desglose.map(({ op, monto }) => (
                    <div key={op.id} className="flex items-baseline justify-between gap-3 text-caption">
                        <span className="text-content-2 min-w-0 truncate">
                            {op.folio}
                            <span className="text-content-3">
                                {' · '}{etiquetaDeSalida ? etiquetaDeSalida(op.tipo) : op.tipo}
                                {op.entidad ? ` · ${op.entidad}` : ''}
                            </span>
                        </span>
                        <span className="flex items-baseline gap-2 shrink-0 tabular-nums">
                            <span className="text-content-2">{formatMoney(monto)}</span>
                            {Math.abs(Number(op.monto) - monto) > 0.005 && (
                                <span className="text-content-3">
                                    de {formatMoney(op.monto)}
                                </span>
                            )}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

/**
 * Un cobro de crédito que todavía no tiene renglón en el sistema de la caja.
 *
 * No es una fila de segunda: para los cobros que no son efectivo es la ÚNICA
 * que va a existir —allá no se anotan nunca porque no entran al cajón— y para
 * los de efectivo es la que llega primero, al minuto de cobrar, mientras la
 * captura pasa.
 *
 * Por eso el aviso de la derecha depende de la forma de pago y no de estar
 * suelto: «no entra al cajón» es una explicación y «todavía no aparece en la
 * caja» es algo que mirar. Escritos igual, el segundo se aprendería a ignorar
 * por culpa del primero, que sale todos los días.
 */
function RenglonDeCobro({ cobro, quien }) {
    const anulado = Boolean(cobro.anulado_at);
    const entra = Boolean(cobro.entroAlCajon);
    const hora = horaDe(cobro.created_at);

    const carril = anulado ? 'bg-danger' : entra ? 'bg-success' : 'bg-content-3/40';
    const cajaGlifo = anulado ? 'bg-danger/10 text-danger-text'
        : entra ? 'bg-success/10 text-success-text' : 'bg-surface-input text-content-3';

    return (
        <div data-surface="card"
            className="w-full rounded-xl overflow-hidden flex items-stretch gap-0 min-h-[var(--tap-min)]">
            <span className={`w-1 shrink-0 ${carril}`} aria-hidden="true" />
            <span className="flex items-center gap-3 flex-1 min-w-0 p-2.5">
                <span className={`shrink-0 w-8 h-8 rounded-lg grid place-items-center ${cajaGlifo}`} aria-hidden="true">
                    <HandCoins className="w-4 h-4" />
                </span>

                <span className="flex-1 min-w-0">
                    <span className={`block text-body-sm font-semibold truncate ${
                        anulado ? 'text-content-3 line-through' : 'text-content'}`}>
                        Cobro de crédito · {cobro.cliente || 'Sin nombre'}
                    </span>
                    <span className="flex items-center gap-1.5 flex-wrap text-micro text-content-3">
                        {anulado && <Badge variant="danger" size="sm">Anulado</Badge>}
                        <Badge variant="info" size="sm">Del portal</Badge>
                        {!anulado && (entra
                            ? <Badge variant="warning" size="sm">Todavía no aparece en la caja</Badge>
                            : <Badge variant="neutral" size="sm">No entra al cajón</Badge>)}
                        {`crédito ${cobro.credito_erp} · ${String(cobro.forma || 'sin forma').toLowerCase()}`}
                        {hora && ` · ${hora}`}
                    </span>
                    {quien && (
                        <span className="flex items-center gap-1.5 mt-1 min-w-0">
                            <AvatarConEstado emp={quien} px={18} radio="rounded-full" marco="" />
                            <span className="text-micro text-content-3 truncate">Lo cobró {quien.name}</span>
                        </span>
                    )}
                </span>

                <span className="shrink-0 text-right">
                    {/* Apagado cuando no toca el cajón: en verde y junto a las
                        entradas, una transferencia se lee como billetes que
                        tienen que estar en la caja al contar. */}
                    <span className={`block text-body font-black tabular-nums ${
                        anulado ? 'text-danger-text line-through'
                            : entra ? 'text-success-text' : 'text-content-3'}`}>
                        +{formatMoney(cobro.monto)}
                    </span>
                    <span className="block text-micro text-content-3">
                        {Number(cobro.saldo_despues) > 0.004
                            ? `queda ${formatMoney(cobro.saldo_despues)}`
                            : 'saldado'}
                    </span>
                </span>
            </span>
        </div>
    );
}

/**
 * Una salida pagada con una bolsa de efectivo que ningún vale contó.
 *
 * ── Por qué está en una lista de movimientos de CAJA ───────────────────────
 * Porque es dinero que salió de la sala y no aparecía en ninguna pantalla de
 * Efectivo: 65 salidas y $15,072.74 medidos el 2026-09-03. El sistema de la
 * caja no la anota, y con razón — ese dinero ya había salido de la caja en un
 * corte anterior, cuando se embolsó, y ESO sí se ve (es el vale de aquel día).
 *
 * Por eso la fila NO suma al neto y lo dice en su propio rótulo. Contarla sería
 * restar dos veces el mismo dinero; esconderla era no poder rastrearlo.
 */
function RenglonDeBolsa({ op, etiqueta, quien }) {
    const anulada = Boolean(op.anulada_at);
    const hora = horaDe(op.registrado_at);
    const parcial = op.cubiertoPorVales > 0.005;

    return (
        <div data-surface="card"
            className="w-full rounded-xl overflow-hidden flex items-stretch gap-0 min-h-[var(--tap-min)]">
            <span className={`w-1 shrink-0 ${anulada ? 'bg-danger' : 'bg-content-3/40'}`} aria-hidden="true" />
            <span className="flex items-center gap-3 flex-1 min-w-0 p-2.5">
                <span className={`shrink-0 w-8 h-8 rounded-lg grid place-items-center ${
                    anulada ? 'bg-danger/10 text-danger-text' : 'bg-surface-input text-content-3'}`}
                    aria-hidden="true">
                    <ShoppingBag className="w-4 h-4" />
                </span>

                <span className="flex-1 min-w-0">
                    <span className={`block text-body-sm font-semibold truncate ${
                        anulada ? 'text-content-3 line-through' : 'text-content'}`}>
                        {etiqueta}{op.entidad ? ` · ${op.entidad}` : ''}
                    </span>
                    <span className="flex items-center gap-1.5 flex-wrap text-micro text-content-3">
                        {anulada && <Badge variant="danger" size="sm">Anulada</Badge>}
                        <Badge variant="neutral" size="sm">Salió de una bolsa</Badge>
                        {op.folio}
                        {op.numero_boleta && ` · boleta ${op.numero_boleta}`}
                        {hora && ` · ${hora}`}
                    </span>
                    {quien && (
                        <span className="flex items-center gap-1.5 mt-1 min-w-0">
                            <AvatarConEstado emp={quien} px={18} radio="rounded-full" marco="" />
                            <span className="text-micro text-content-3 truncate">La hizo {quien.name}</span>
                        </span>
                    )}
                </span>

                <span className="shrink-0 text-right">
                    {/* Apagado, como los cobros que no tocan el cajón: en ámbar y
                        junto a las salidas de la caja, se leería como billetes
                        que el próximo corte va a echar de menos. */}
                    <span className={`block text-body font-black tabular-nums ${
                        anulada ? 'text-danger-text line-through' : 'text-content-3'}`}>
                        −{formatMoney(op.montoSinVale)}
                    </span>
                    <span className="block text-micro text-content-3">
                        {parcial
                            ? `de ${formatMoney(op.monto)} · el resto, en el vale`
                            : 'de una bolsa ya cerrada'}
                    </span>
                </span>
            </span>
        </div>
    );
}

/**
 * La ficha de un movimiento y todo lo que se le vio cambiar.
 *
 * Muestra `visto_at` incluso cuando no pasó nada: «se confirmó que seguía ahí a
 * tal hora» es información, y su ausencia es lo que haría dudar de un
 * «desapareció» — la marca sólo vale si se sabe cuándo fue la última vez que se
 * miró.
 */
function DetalleDelMovimiento({ movimiento, historia, sala, onClose }) {
    if (!movimiento) return null;
    const ido = Boolean(movimiento.desaparecido_at);

    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-md" ariaLabel="Detalle del movimiento de caja">
            <div className="p-5 space-y-4">
                <div className="space-y-1">
                    <div className="flex items-center gap-2">
                        {movimiento.tipo === 'ENTRADA'
                            ? <ArrowDownLeft size={16} className="text-success-text" />
                            : <ArrowUpRight size={16} className="text-warning-text" />}
                        <span className="text-caption font-black uppercase tracking-widest text-content-2">
                            {movimiento.tipo === 'ENTRADA' ? 'Entrada de efectivo' : 'Salida de efectivo'}
                        </span>
                        {ido && <Badge variant="danger" size="sm">Ya no está</Badge>}
                    </div>
                    <p className="text-h3 font-bold text-content">
                        {movimiento.tipo === 'SALIDA' ? '−' : ''}{formatMoney(movimiento.monto)}
                    </p>
                    <p className="text-body-sm text-content-2">{movimiento.concepto || 'Sin concepto'}</p>
                    <p className="text-caption text-content-3">
                        {sala || '—'} · {fechaLarga(movimiento.fecha)}
                        {movimiento.origen === 'PORTAL' && ' · anotado por el portal'}
                    </p>
                </div>

                <div className="text-caption text-content-3 space-y-0.5">
                    <p>Se vio por primera vez: {cuando(movimiento.created_at)}</p>
                    <p>Visto por última vez: {cuando(movimiento.visto_at)}</p>
                    {ido && <p className="text-danger-text font-semibold">Dejó de estar: {cuando(movimiento.desaparecido_at)}</p>}
                </div>

                <div className="space-y-2">
                    <h4 className="text-caption font-black uppercase tracking-widest text-content-2">
                        Qué se le vio cambiar
                    </h4>
                    {historia.length === 0 ? (
                        <p className="text-body-sm text-content-3">
                            Nada desde que se anotó. Los cambios se registran desde el 28 de agosto.
                        </p>
                    ) : (
                        <ul className="space-y-2">
                            {historia.map((h) => {
                                const c = CAMBIOS[h.cambio] || CAMBIOS.APARECIO;
                                const Icono = c.icon;
                                return (
                                    <li key={h.id} className="flex gap-2.5">
                                        <Icono size={14} className="mt-0.5 shrink-0 text-content-3" />
                                        <div className="min-w-0">
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
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>

                <div className="flex justify-end">
                    <Button variant="secondary" onClick={onClose}>Cerrar</Button>
                </div>
            </div>
        </LiquidModal>
    );
}
