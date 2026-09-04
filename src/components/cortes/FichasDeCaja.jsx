import React, { useEffect, useMemo, useState } from 'react';
import { Clock, DoorOpen, UserX } from 'lucide-react';
import Badge from '../common/Badge';
import AvatarConEstado from '../common/AvatarConEstado';
import Notice from '../common/Notice';
import { formatMoney } from '../../utils/formatNumber';
import { fetchMetaSala } from '../../data/metas';
import { useAuth } from '../../context/AuthContext';

/**
 * Quién abrió cada caja, desde cuándo y con cuánto — arriba de los cortes.
 *
 * ── Por qué dejó de ser una pestaña (v2.914.0) ─────────────────────────────
 * Era «Aperturas», una tabla en su propia sección. Pero nadie entra al portal a
 * mirar aperturas: se mira **al leer un corte**, para saber a quién pertenece.
 * Tenerla en otra pestaña obligaba a salir de la lista, buscar la sala y volver
 * — con los mismos datos que ahora están tres centímetros más arriba.
 *
 * Y como ficha dice de un vistazo lo que la tabla obligaba a leer columna por
 * columna: la banda de color es el estado, el avatar es la persona, y una
 * apertura sin persona se ve porque **no tiene cara**.
 *
 * ── Lo que la tabla contestaba y esto conserva ─────────────────────────────
 * Medido el 28-ago-2026: TRES de las seis salas abren y cortan bajo una cuenta
 * compartida —«MI CAJA LA POPULAR», «MI CAJA LA SALUD 2», «MI CAJA LA SALUD 5»—,
 * o sea 185 de los 452 cortes desde el 14-ago. «¿Quién cortó?» no tenía
 * respuesta, y esa es la pregunta que estas fichas existen para contestar.
 *
 * Desde el 3-sep la respuesta existe **cuando se abre desde el portal**, y sale
 * de ahí y de ningún otro lado: `caja_aperturas_del_portal` anota quién apretó
 * el botón. El nombre que da el sistema de la caja NO es una alternativa peor,
 * es una respuesta FALSA — en las otras tres salas es el de una persona que
 * tampoco abrió, porque el portal reusa el empleado del origen que la sala ya
 * venía usando. Sin fila del portal, la ficha se queda sin cara: eso significa
 * «se abrió desde la caja», que es la verdad y además es accionable.
 *
 * ── El cruce con la marcación NO acusa a nadie ─────────────────────────────
 * La regla del usuario (2026-08-28) es que por ahora **cualquiera de la sala
 * puede abrir la caja**: el cruce contra la marcación es un HALLAZGO, no un
 * candado. Y una consulta vacía tiene tres causas que se ven iguales —nadie
 * marcó, no hay permiso para leer la asistencia, o el kiosco todavía no
 * arrancó—, así que la ficha sólo dice «no marcó» cuando el período tiene
 * alguna marcación; si no, calla y el aviso de arriba explica cuál de las tres
 * es. Es la misma regla del gate que no pudo medir: un cero de un instrumento
 * apagado no es un cero.
 */

const hhmm = (t) => (t ? String(t).slice(0, 5) : '—');

const horaDe = (iso) => (iso
    ? new Date(iso).toLocaleTimeString('es-SV', {
        hour: '2-digit', minute: '2-digit', timeZone: 'America/El_Salvador',
    })
    : '—');

/** «06:55:49» y una marcación → cuántos minutos antes (o después) se marcó. */
function minutosAntes(abiertaA, marcaIso) {
    if (!abiertaA || !marcaIso) return null;
    const marca = new Date(marcaIso);
    const [h, m] = String(abiertaA).split(':').map(Number);
    // La marcación se compara en hora de sala, que es la del `abierta_a`.
    const enSala = new Date(marca.getTime() - 6 * 3600_000);
    const minutosMarca = enSala.getUTCHours() * 60 + enSala.getUTCMinutes();
    return (h * 60 + m) - minutosMarca;
}

function Ficha({ apertura, sala, marca, hayConQueCruzar, avance = null, ancha = false }) {
    const abierta = !apertura.cerrada_at;
    /* QUIÉN abrió, y sólo desde el portal.
     *
     * `empleado_texto` NO es una alternativa: es el nombre de la cuenta con la
     * que la sala abre siempre. En tres salas no es una persona («MI CAJA LA
     * POPULAR») y en las otras tres es una persona que tampoco abrió, porque
     * el portal reusa a propósito el empleado del origen que la sala ya venía
     * usando. Poner ese nombre acá es firmar el acto con quien no lo hizo —
     * exactamente el defecto que la tarjeta mostraba como «Mi La». */
    const quien = apertura.abrio?.name || null;
    const dif = minutosAntes(apertura.abierta_a, marca);

    /* Tres colores y tres significados, no decoración:
     *  · verde   — la caja está abierta ahora.
     *  · ámbar   — abrió alguien que el portal no puede nombrar.
     *  · apagado — ya cerró; es historia. */
    const banda = !quien ? 'bg-warning' : abierta ? 'bg-success' : 'bg-content-3/40';

    return (
        <div data-surface="card"
            className={`rounded-2xl overflow-hidden flex flex-col${ancha ? ' col-span-full' : ''}`}>
            <div className={`h-[3px] ${banda}`} aria-hidden="true" />
            <div className="p-3 flex flex-col gap-2.5 min-w-0">
                <div className="flex items-center justify-between gap-2">
                    <span className="text-body-sm font-bold text-content truncate">{sala}</span>
                    <Badge variant={abierta ? 'success' : 'neutral'} size="sm"
                        icon={abierta ? Clock : DoorOpen}>
                        {abierta ? `abierta · ${hhmm(apertura.abierta_a)}` : `cerró · ${horaDe(apertura.cerrada_at)}`}
                    </Badge>
                </div>

                <div className="flex items-center gap-2 min-w-0">
                    {/* La CARA de quien abrió, con el canónico y no con un círculo
                        de iniciales a mano. El de acá pintaba siempre las letras:
                        nunca miró una foto, así que una sala entera de gente
                        retratada salía como un tablero de siglas — y eso no se lee
                        como un defecto, se lee como que nadie tiene foto.

                        `AvatarConEstado` resuelve la foto por `id` contra el store
                        (ahí `photo` es la URL FIRMADA), así que no hace falta traer
                        `photo_url` en la consulta — que además vendría cruda. Si la
                        persona no está en la lista del store —acotada por permisos—
                        cae a la inicial, que es el comportamiento de siempre.

                        Sin persona NO se dibuja un avatar vacío: el disco ámbar con
                        la silueta tachada es el dato. Una apertura sin cara es lo
                        que hay que ver. */}
                    {quien ? (
                        <AvatarConEstado emp={{ id: apertura.employee_id, name: quien }}
                            px={32} radio="rounded-full" marco="" />
                    ) : (
                        <span className="shrink-0 w-8 h-8 rounded-full grid place-items-center bg-warning/10 text-warning-text"
                            aria-hidden="true">
                            <UserX className="w-4 h-4" />
                        </span>
                    )}
                    <span className="min-w-0">
                        <span className="block text-body-sm font-semibold text-content truncate">
                            {quien || 'Sin identificar'}
                        </span>
                        <span className="block text-micro text-content-3">
                            {!quien
                                ? 'se abrió desde la caja · no se sabe quién'
                                : !hayConQueCruzar
                                    ? `turno ${apertura.turno ?? '—'} · caja ${apertura.caja_erp ?? '—'}`
                                    : dif == null
                                        ? 'no marcó entrada'
                                        : dif >= 0
                                            ? `marcó entrada ${dif} min antes`
                                            : `marcó entrada ${Math.abs(dif)} min después`}
                        </span>
                    </span>
                </div>

                <div className="flex items-end justify-between gap-3 pt-2 border-t border-border/60">
                    <span className="min-w-0">
                        <span className="block text-micro font-black uppercase tracking-widest text-content-3">Apertura</span>
                        <span className="block text-body-sm font-black tabular-nums text-content">
                            {formatMoney(apertura.monto_apertura)}
                        </span>
                    </span>
                    <span className="min-w-0 text-right">
                        <span className="block text-micro font-black uppercase tracking-widest text-content-3">
                            {abierta ? 'Esperado ahora' : 'Cerró con'}
                        </span>
                        <span className="block text-body-sm font-black tabular-nums text-content">
                            {formatMoney(apertura.monto_registrado)}
                        </span>
                    </span>
                </div>

                {/* Cómo va el día contra la meta. Sólo cuando la ficha está sola
                    —o sea, la sala mirándose a sí misma en el día de hoy—: la
                    meta del día no dice nada al lado de las fichas de otro día,
                    y con seis salas en pantalla serían seis lecturas.

                    La barra NO se pinta de rojo cuando va baja. A las 9 de la
                    mañana el 20% es lo normal, así que un tono de alarma sería
                    una mentira que se repite todos los días hasta que nadie la
                    mira. Verde cuando ya llegó, azul mientras avanza. */}
                {avance && (
                    <div className="pt-2 border-t border-border/60">
                        <div className="flex items-baseline justify-between gap-2">
                            <span className="text-micro font-black uppercase tracking-widest text-content-3">
                                Meta de hoy
                            </span>
                            <span className={`text-body-sm font-black tabular-nums ${avance.pct >= 100 ? 'text-success-text' : 'text-content'}`}>
                                {avance.pct}%
                            </span>
                        </div>
                        <div className="mt-1.5 h-1.5 rounded-full bg-content-3/20 overflow-hidden"
                            role="progressbar" aria-valuenow={avance.pct} aria-valuemin={0} aria-valuemax={100}
                            aria-label="Avance de la meta de hoy">
                            <div className={`h-full rounded-full ${avance.pct >= 100 ? 'bg-success' : 'bg-brand'}`}
                                style={{ width: `${Math.min(100, avance.pct)}%` }} />
                        </div>
                        {/* Los montos sólo con el permiso completo. Sin él queda
                            el porcentaje, que es la misma regla que ya aplica el
                            widget del Inicio: el widget no desaparece, cambia de
                            idioma. */}
                        {avance.montos && (
                            <span className="mt-1 block text-micro text-content-3">
                                {formatMoney(avance.vendido)} de {formatMoney(avance.meta)}
                            </span>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

export default function FichasDeCaja({
    aperturas = [],
    entradas = [],
    pudeLeerAsistencia = true,
    salas,
    cargando = false,
    esHoy = false,
}) {
    const { hasPermission } = useAuth();
    // La PRIMERA marcación de entrada de cada persona en cada día. La primera y
    // no la última: quien marca, sale a almorzar y vuelve tiene varias, y la que
    // se compara contra la apertura es con la que llegó.
    const porPersona = useMemo(() => {
        const pp = new Map();
        for (const e of entradas) {
            const dia = new Date(new Date(e.timestamp).getTime() - 6 * 3600_000)
                .toISOString().slice(0, 10);
            const clave = `${e.employee_id}:${dia}`;
            if (!pp.has(clave)) pp.set(clave, e.timestamp);
        }
        return pp;
    }, [entradas]);

    const hayConQueCruzar = pudeLeerAsistencia && entradas.length > 0;

    /* Las abiertas primero y, dentro de cada bloque, por sala.
     *
     * Ese orden no es alfabético por gusto: lo que se mira en esta fila es
     * «¿cuáles están abiertas AHORA?», y una caja cerrada arriba obliga a
     * recorrer la lista para contestarlo. Con período largo son muchas, así que
     * la fila se corta en 12 y el resto vive en la lista de cortes de abajo,
     * que ya trae su sala en cada tarjeta. */
    const ordenadas = useMemo(() => [...aperturas]
        .sort((a, b) => (Number(!!a.cerrada_at) - Number(!!b.cerrada_at))
            || String(b.abierta_el).localeCompare(String(a.abierta_el))
            || String(salas?.get(a.branch_id) || '').localeCompare(String(salas?.get(b.branch_id) || ''), 'es'))
        .slice(0, 12), [aperturas, salas]);

    /* ── El avance del día, y por qué sólo con UNA ficha ────────────────────
     *
     * La RLS de `cortes_caja_aperturas` acota por sala salvo con scope ALL, así
     * que una sala mirando su propio período ve exactamente una ficha. Ése es
     * el caso en que la meta del día tiene sentido y en que además hay ancho
     * para dibujarla: la ficha pasa a ocupar la fila entera.
     *
     * Y se pide con el período en HOY. `get_meta_sala` sólo sabe contestar por
     * el día de hoy —lo calcula adentro, en hora de El Salvador—, así que al
     * lado de las fichas del martes pasado estaría diciendo lo de hoy sin que
     * nada avise. Es la misma trampa de un total que no dice de qué período es.
     *
     * El permiso no se chequea acá para decidir si se muestra: lo decide el
     * RPC, que devuelve CERO filas sin `dash_meta_sala`. Se chequea antes para
     * no gastar la llamada. */
    const salaUnica = ordenadas.length === 1 ? ordenadas[0].branch_id : null;
    const puedeVerMeta = hasPermission('dash_meta_sala');
    const conMontos = hasPermission('dash_meta_sala_vista_completa');
    const [meta, setMeta] = useState(null);

    useEffect(() => {
        if (!esHoy || salaUnica == null || !puedeVerMeta) return undefined;
        let vivo = true;
        // Una meta que no se pudo leer NO es una meta en cero: se queda en null
        // y el bloque no se dibuja. Un 0% inventado sobre una sala que vendió
        // toda la mañana es peor que no decir nada.
        //
        // Se guarda CON la sala a la que pertenece. Al cambiar de sala en el
        // filtro, la respuesta vieja sigue en el estado hasta que llega la
        // nueva: sin el amarre, esa ficha mostraría el avance de la otra sala
        // durante un instante, y ahí no hay nada que delate el cambiazo.
        fetchMetaSala(salaUnica)
            .then((row) => { if (vivo) setMeta({ branchId: salaUnica, row }); })
            .catch(() => { if (vivo) setMeta({ branchId: salaUnica, row: null }); });
        return () => { vivo = false; };
    }, [esHoy, salaUnica, puedeVerMeta]);

    /* La meta del DÍA es la del mes repartida entre sus días — la misma
     * definición que usa el aviso de cierre del día, no una nueva: dos sitios
     * que reparten la meta con reglas distintas terminan diciendo dos
     * porcentajes del mismo día. */
    const avance = useMemo(() => {
        if (!esHoy || salaUnica == null || meta?.branchId !== salaUnica) return null;
        const metaMes = Number(meta?.row?.monto_meta);
        const dias    = Number(meta?.row?.dias_mes);
        const vendido = Number(meta?.row?.venta_hoy);
        if (!Number.isFinite(metaMes) || !Number.isFinite(dias) || dias <= 0 || metaMes <= 0) return null;
        if (!Number.isFinite(vendido)) return null;
        const metaDia = metaMes / dias;
        return {
            meta: metaDia,
            vendido,
            pct: Math.round(vendido / metaDia * 100),
            montos: conMontos,
        };
    }, [meta, conMontos, esHoy, salaUnica]);

    // Sin aperturas no se dibuja NADA, ni un vacío: esta fila es el encabezado
    // de los cortes, no una sección con su propia promesa. Un «sin aperturas»
    // acá le robaría el sitio al vacío de los cortes, que es el que importa.
    if (cargando || ordenadas.length === 0) return null;

    const sinPersona = aperturas.filter((a) => !a.employee_id).length;

    return (
        <section className="space-y-2" aria-label="Las cajas del período">
            <div className="flex items-baseline justify-between gap-3 px-1">
                <h3 className="text-caption font-black uppercase tracking-widest text-content-2">
                    Las cajas
                </h3>
                <span className="text-micro text-content-3">
                    {aperturas.filter((a) => !a.cerrada_at).length} abierta
                    {aperturas.filter((a) => !a.cerrada_at).length === 1 ? '' : 's'}
                    {aperturas.length > ordenadas.length && ` · se muestran ${ordenadas.length} de ${aperturas.length}`}
                </span>
            </div>

            {/* Tope de 3 columnas: son 6 salas. Con 4 la última fila queda con
             * dos huecos y la fila se lee como si faltaran cajas. */}
            <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
                {ordenadas.map((a) => (
                    <Ficha
                        key={`${a.branch_id}:${a.erp_apertura_id}`}
                        apertura={a}
                        sala={salas?.get(a.branch_id) || `Sucursal ${a.branch_id}`}
                        marca={porPersona.get(`${a.employee_id}:${a.abierta_el}`) || null}
                        hayConQueCruzar={hayConQueCruzar}
                        avance={avance}
                        ancha={ordenadas.length === 1}
                    />
                ))}
            </div>

            {!pudeLeerAsistencia && (
                <Notice variant="info" icon={UserX}>
                    No se puede leer la asistencia con este permiso, así que las fichas no dicen
                    quién marcó entrada. No significa que nadie haya marcado.
                </Notice>
            )}

            {sinPersona > 0 && (
                <Notice variant="warning" icon={UserX}>
                    <span className="font-bold">
                        {sinPersona === 1
                            ? 'Una caja abrió con una cuenta compartida'
                            : `${sinPersona} cajas abrieron con una cuenta compartida`}
                    </span>
                    <span className="block mt-0.5 font-normal text-content-2">
                        Sus cortes no quedan a nombre de nadie. Se arregla dándole a cada persona
                        su propio usuario en la caja.
                    </span>
                </Notice>
            )}
        </section>
    );
}
