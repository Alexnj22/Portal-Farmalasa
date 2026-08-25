import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, Check, ClipboardCheck, Clock, Sparkles, Thermometer } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import { EmptyState, LoadingState } from '../../components/common/StateViews';
import useMediaQuery from '../../hooks/useMediaQuery';
import { CORTE_TELEFONO } from '../../components/common/usarExpediente';
import AnotarLectura from '../../components/bitacoras/AnotarLectura';
import AnotarLimpieza from '../../components/bitacoras/AnotarLimpieza';
import MatrizDelDia from '../../components/bitacoras/MatrizDelDia';
import PasarLaRonda from '../../components/bitacoras/PasarLaRonda';
import { bloquesDeLaRonda } from '../../data/bitacoras';

// ═══════════════════════════════════════════════════════════════════════════
// La captura del día.
//
// ── En escritorio, una MATRIZ; en el teléfono, la vuelta ───────────────────
// Son dos públicos. En la computadora manda la matriz —áreas en las filas,
// momentos en las columnas—: es la forma del libro de papel que el inspector
// reconoce y la única que contesta de un vistazo «¿nos falta alguna?». En el
// teléfono manda lo que toca AHORA, porque quien lo tiene en la mano está
// parado frente al termómetro y no va a leer una tabla.
//
// La versión anterior era una tarjeta por casilla: **18 tarjetas para 13
// registros**, nueve de ellas sin decir nada («Sin lectura», «Sin registrar») y
// siete diciendo «Todavía no», que era la respuesta más repetida de la
// pantalla.
//
// ── Se pinta la GRILLA COMPLETA, no las lecturas que existen ───────────────
// Cada momento de cada área tiene su celda, tenga lectura o no. Una bitácora
// que sólo lista lo anotado no puede contestar la pregunta del inspector — y es
// la misma lección que dejaron los cortes de caja: vacío y completo se ven
// idénticos cuando sólo se muestran los registros que hay.
//
// ── El estado lo decide la BASE ────────────────────────────────────────────
// `abierta`, `proxima`, `vencida` y `hecha` vienen calculados contra la hora de
// El Salvador. Con el reloj del navegador, un equipo con la hora corrida vería
// abierta una franja vencida y anotaría «a tiempo» algo que no lo está — y el
// ítem 6.1.14 del RTS pide que el registro sea CONTEMPORÁNEO.
// ═══════════════════════════════════════════════════════════════════════════

const hhmm = (t) => String(t || '').slice(0, 5);

/** Una banda por momento, para el teléfono: qué falta y qué ya está. */
function BandaDelMomento({ momento, areas, onRonda, puedeAnotar, cerrado }) {
    const bloques = [];
    for (const a of areas) {
        const f = (a.franjas || []).find(x => x.clave === momento.clave);
        if (f) bloques.push({ area: a, bloque: f, tipo: 'lectura' });
        for (const t of a.limpiezas || []) {
            if (t.desde === momento.desde) bloques.push({ area: a, bloque: t, tipo: 'limpieza' });
        }
    }
    if (!bloques.length) return null;

    const hechos = bloques.filter(b => b.bloque.lectura || b.bloque.registro).length;
    const vencidos = bloques.filter(b => b.bloque.estado === 'vencida' && !b.bloque.lectura && !b.bloque.registro).length;
    const abiertos = bloques.filter(b => b.bloque.estado === 'abierta' && !b.bloque.lectura && !b.bloque.registro).length;
    const completo = hechos === bloques.length;

    return (
        <section data-surface="card"
            data-tono={completo ? 'success' : (abiertos ? 'warning' : (vencidos ? 'danger' : undefined))}
            className="p-3 space-y-2">
            <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h3 className="text-body-sm font-black text-content">{momento.label}</h3>
                <span className="text-label text-content-3 tabular-nums">
                    {hhmm(momento.desde)}–{hhmm(momento.hasta)}
                </span>
                <span className="flex-1" />
                <Badge size="sm" uppercase={false}
                    icon={completo ? Check : Clock}
                    variant={completo ? 'success' : (abiertos ? 'warning' : (vencidos ? 'danger' : 'neutral'))}>
                    {hechos} de {bloques.length}
                </Badge>
            </header>

            {/* Lo hecho, apagado. Lo que falta, con nombre: es lo único que se
                puede accionar. */}
            <ul className="space-y-1">
                {bloques.map(({ area, bloque, tipo }) => {
                    const listo = bloque.lectura || bloque.registro;
                    return (
                        <li key={`${area.id}-${tipo}-${bloque.clave}`}
                            className="flex items-center gap-2 text-body-sm">
                            {listo
                                ? <Check size={14} className="text-success-text shrink-0" />
                                : <span className="size-3.5 rounded-full border-2 border-border-card shrink-0" />}
                            <span className={`min-w-0 truncate ${listo ? 'text-content-3' : 'font-bold text-content-1'}`}>
                                {area.nombre}
                                {tipo === 'limpieza' && <span className="text-content-3"> · limpieza</span>}
                            </span>
                            {bloque.lectura && (
                                <span className={`ml-auto text-body-sm font-black tabular-nums shrink-0 ${bloque.lectura.fuera_de_rango ? 'text-danger-text' : 'text-content-2'}`}>
                                    {Number(bloque.lectura.temperatura)} °C
                                </span>
                            )}
                        </li>
                    );
                })}
            </ul>

            {puedeAnotar && !cerrado && !completo && (abiertos > 0 || vencidos > 0) && (
                <Button variant={abiertos ? 'primary' : 'secondary'} size="sm" icon={ClipboardCheck}
                    className="w-full" onClick={onRonda}>
                    Anotar {bloques.length - hechos}
                </Button>
            )}
        </section>
    );
}

export default function TabHoy({ dia, cargando, error, puedeAnotar, onRecargar }) {
    const enTelefono = useMediaQuery(CORTE_TELEFONO);
    const [anotando, setAnotando]   = useState(null);   // { area, franja, lectura?, valores? }
    const [limpiando, setLimpiando] = useState(null);   // { area, turno }
    const [enRonda, setEnRonda]     = useState(false);

    const cerrado = Boolean(dia?.cerrado);

    const abrirCorregir = useCallback((area, franja) =>
        setAnotando({ area, franja, lectura: franja.lectura }), []);
    const abrirFueraDeRango = useCallback((area, franja, valores) =>
        setAnotando({ area, franja, lectura: null, valores }), []);
    // Registrar, corregir o quitar: el mismo diálogo con tres modos. El
    // registro llega cuando hay algo que corregir o que quitar.
    const abrirLimpieza = useCallback((area, turno, registro) =>
        setLimpiando({ area, turno, registro, modo: registro ? 'corregir' : 'registrar' }), []);
    const abrirQuitarLimpieza = useCallback((area, turno, registro) =>
        setLimpiando({ area, turno, registro, modo: 'quitar' }), []);

    const cerrar = useCallback((huboCambio) => {
        setAnotando(null);
        setLimpiando(null);
        setEnRonda(false);
        if (huboCambio) onRecargar?.();
    }, [onRecargar]);

    const areas = useMemo(() => dia?.areas || [], [dia]);
    const activas = useMemo(() => areas.filter(a => a.aplica_hoy !== false), [areas]);
    const enPausa = useMemo(() => areas.filter(a => a.aplica_hoy === false), [areas]);

    const ronda = useMemo(() => bloquesDeLaRonda(dia), [dia]);

    // Los momentos del día: la unión de las franjas de todas las áreas, por
    // horario. Desde que el reloj es de la sucursal son los mismos para todas,
    // pero se unen igual — la bodega central tiene los suyos y una sucursal
    // puede quedar a medio configurar.
    const momentos = useMemo(() => {
        const mapa = new Map();
        for (const a of activas) {
            for (const f of a.franjas || []) {
                if (!mapa.has(f.clave)) {
                    mapa.set(f.clave, {
                        clave: f.clave, label: f.label, desde: f.desde, hasta: f.hasta,
                        ahora: f.estado === 'abierta',
                    });
                } else if (f.estado === 'abierta') {
                    mapa.get(f.clave).ahora = true;
                }
            }
        }
        return [...mapa.values()].sort((a, b) => String(a.desde).localeCompare(String(b.desde)));
    }, [activas]);

    // ── `?ronda=1` abre la vuelta sin pasar por la grilla ───────────────────
    // Lo usan el atajo del Inicio y el aviso de franja por vencerse. El
    // parámetro se CONSUME: si se quedara, cerrar el diálogo lo volvería a
    // abrir en el render siguiente.
    const [params, setParams] = useSearchParams();
    const pidenRonda = params.get('ronda') === '1';
    useEffect(() => {
        if (!pidenRonda || cargando) return;
        setParams(p => { p.delete('ronda'); return p; }, { replace: true });
        // eslint-disable-next-line react-hooks/set-state-in-effect -- lo pide la dirección, no un render
        if (puedeAnotar && !cerrado && ronda.length > 0) setEnRonda(true);
    }, [pidenRonda, cargando, puedeAnotar, cerrado, ronda.length, setParams]);

    if (cargando) return <LoadingState label="Cargando la bitácora del día…" />;

    // Un rechazo de permiso NO se puede ver como una lista vacía: quien lo sufre
    // sólo puede reportar «me sale vacía». El 42501 tiene arreglo concreto y por
    // eso se nombra.
    if (error) {
        return (
            <Notice variant="danger" icon={AlertTriangle}>
                {error.code === '42501'
                    ? 'Tu cargo no tiene el módulo de bitácoras. Hay que otorgarlo en Permisos.'
                    : (error.message || 'No se pudo cargar la bitácora.')}
            </Notice>
        );
    }

    if (!areas.length) {
        return (
            <EmptyState icon={Thermometer}
                title="Sin áreas configuradas"
                subtitle="Esta sucursal todavía no tiene áreas. Se definen en la pestaña Configuración." />
        );
    }

    return (
        <div className="space-y-4">
            {enTelefono ? (
                <>
                    {momentos.map(m => (
                        <BandaDelMomento key={m.clave} momento={m} areas={activas}
                            puedeAnotar={puedeAnotar} cerrado={cerrado}
                            onRonda={() => setEnRonda(true)} />
                    ))}
                    {/* Las áreas de sólo limpieza cuyos turnos no caen en ningún
                        momento de temperatura quedarían invisibles: su vuelta es
                        la ronda, y este botón la abre igual. */}
                    {puedeAnotar && !cerrado && ronda.length > 0 && (
                        <Button variant="primary" icon={ClipboardCheck} className="w-full"
                            onClick={() => setEnRonda(true)}>
                            Pasar la ronda · {ronda.length}
                        </Button>
                    )}
                </>
            ) : (
                <MatrizDelDia
                    dia={dia} areas={activas} momentos={momentos}
                    puedeAnotar={puedeAnotar} cerrado={cerrado}
                    pendientes={ronda.length}
                    onRecargar={onRecargar}
                    onCorregir={abrirCorregir}
                    onFueraDeRango={abrirFueraDeRango}
                    onDetalleLimpieza={abrirLimpieza}
                    onQuitarLimpieza={abrirQuitarLimpieza}
                    onRonda={() => setEnRonda(true)}
                />
            )}

            {enPausa.length > 0 && (
                <p className="text-label text-content-3 flex items-center gap-1.5">
                    <Sparkles size={12} />
                    Hoy no se lleva bitácora en {enPausa.map(a => a.nombre).join(', ')} — así está
                    configurada el área. No cuentan como faltantes al cerrar el mes.
                </p>
            )}

            {enRonda && (
                <PasarLaRonda fecha={dia.fecha} bloques={ronda} onCerrar={cerrar} />
            )}
            {anotando && (
                <AnotarLectura
                    area={anotando.area}
                    franja={anotando.franja}
                    lectura={anotando.lectura}
                    valores={anotando.valores}
                    fecha={dia.fecha}
                    onCerrar={cerrar}
                />
            )}
            {limpiando && (
                <AnotarLimpieza
                    area={limpiando.area}
                    turno={limpiando.turno}
                    registro={limpiando.registro}
                    modo={limpiando.modo}
                    fecha={dia.fecha}
                    onCerrar={cerrar}
                />
            )}
        </div>
    );
}
