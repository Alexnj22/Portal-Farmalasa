import React, { useMemo } from 'react';
import { Clock, DoorOpen, UserX } from 'lucide-react';
import Badge from '../common/Badge';
import Notice from '../common/Notice';
import { formatMoney } from '../../utils/formatNumber';

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

/**
 * Las iniciales de un nombre, para el avatar.
 *
 * Devuelve `null` —y no una inicial cualquiera— cuando el texto no es el nombre
 * de una persona: «MI CAJA LA SALUD 5» daría «ML», que se lee como si alguien
 * se llamara así. Sin iniciales, la ficha pinta el avatar de «nadie», que es
 * exactamente lo que hay que ver.
 */
function iniciales(texto, esPersona) {
    if (!esPersona || !texto) return null;
    const partes = String(texto).trim().split(/\s+/).filter(Boolean);
    if (!partes.length) return null;
    const primera = partes[0][0];
    const segunda = partes.length > 1 ? partes[partes.length - 1][0] : '';
    return (primera + segunda).toUpperCase();
}

function Ficha({ apertura, sala, marca, hayConQueCruzar }) {
    const abierta = !apertura.cerrada_at;
    const esPersona = !!apertura.employee_id;
    const ini = iniciales(apertura.empleado_texto, esPersona);
    const dif = minutosAntes(apertura.abierta_a, marca);

    /* Tres colores y tres significados, no decoración:
     *  · verde   — la caja está abierta ahora.
     *  · ámbar   — abrió alguien que el portal no puede nombrar.
     *  · apagado — ya cerró; es historia. */
    const banda = !esPersona ? 'bg-warning' : abierta ? 'bg-success' : 'bg-content-3/40';

    return (
        <div data-surface="card" className="rounded-2xl overflow-hidden flex flex-col">
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
                    <span className={`shrink-0 w-8 h-8 rounded-full grid place-items-center text-caption font-black ${
                        esPersona ? 'bg-brand/10 text-brand-text' : 'bg-warning/10 text-warning-text'
                    }`} aria-hidden="true">
                        {ini || <UserX className="w-4 h-4" />}
                    </span>
                    <span className="min-w-0">
                        <span className="block text-body-sm font-semibold text-content truncate">
                            {apertura.empleado_texto || 'Sin nombre'}
                        </span>
                        <span className="block text-micro text-content-3">
                            {!esPersona
                                ? 'cuenta compartida · no se sabe quién'
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
}) {
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

            <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {ordenadas.map((a) => (
                    <Ficha
                        key={`${a.branch_id}:${a.erp_apertura_id}`}
                        apertura={a}
                        sala={salas?.get(a.branch_id) || `Sucursal ${a.branch_id}`}
                        marca={porPersona.get(`${a.employee_id}:${a.abierta_el}`) || null}
                        hayConQueCruzar={hayConQueCruzar}
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
