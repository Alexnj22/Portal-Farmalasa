import React, { useEffect, useState } from 'react';
import { AlertTriangle, Lock, FlaskConical, TrendingUp } from 'lucide-react';
import LiquidSelect from '../../components/common/LiquidSelect';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import { LoadingState, EmptyState } from '../../components/common/StateViews';
import { fetchPromocionLaboratorio } from '../../data/promociones';
import { mensajeAmigable } from '../../utils/errorMessages';
import { fmtMoneda, fmtUnidades, mesesRecientes, rotuloMes } from './promocionesUtils';

/**
 * La matriz de una promoción de laboratorio: qué vendió cada sala en el mes,
 * qué nivel alcanzó, cuánto le falta para el siguiente y cuánto cuesta.
 *
 * Es un PANEL y no un modal para que las dos pantallas que la necesitan usen la
 * misma: la tarjeta la abre en un diálogo y Seguimiento la muestra en la página.
 * Escrita dos veces, es cuestión de tiempo que una diga un número y la otra
 * otro — es la lección de `turnoDelDia`.
 *
 * ── Por qué son bloques y no una tabla ──────────────────────────────────────
 * Seis salas × cinco datos no entra en un teléfono sin desbordarse, y una tabla
 * cortada no da error: se ven tres columnas y nadie sabe que hay dos más. Con
 * un bloque por sala el mismo contenido se lee igual en los dos anchos.
 *
 * ── El selector de mes es el SIMULADOR ──────────────────────────────────────
 * Mide el MISMO programa contra otro mes: «si hubiera corrido en julio, habría
 * costado $X», con las ventas reales de julio. No escribe nada. Un mes ya
 * cerrado devuelve siempre lo congelado, se pida como se pida — cambiarle el
 * número a un mes que ya se pagó no es una corrección, es reescribir el pasado.
 */
export default function MatrizLaboratorio({ promocionId, onCabecera }) {
    const [mes, setMes] = useState('');
    const [datos, setDatos] = useState(null);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState(null);

    // ⚠️ Quien lo use pasa `key={promocionId}`: el mes elegido es de ESTA
    // promoción, y sin remontar, la siguiente abriría simulando un mes que
    // nadie pidió. Se resuelve con la clave y no con un efecto que lo limpie,
    // que sería una segunda verdad sobre el mismo estado.

    useEffect(() => {
        if (!promocionId) return undefined;
        let vivo = true;
        setCargando(true);
        setError(null);
        fetchPromocionLaboratorio(promocionId, mes || null)
            .then((d) => { if (vivo) { setDatos(d); onCabecera?.(d); } })
            .catch((e) => { if (vivo) setError(e); })
            .finally(() => { if (vivo) setCargando(false); });
        return () => { vivo = false; };
    }, [promocionId, mes, onCabecera]);

    const salas = Array.isArray(datos?.salas) ? datos.salas : [];

    if (cargando) return <LoadingState label="Calculando el avance…" />;

    if (error) {
        return (
            <Notice variant="danger" icon={AlertTriangle}>
                {mensajeAmigable(error, 'No se pudo calcular el avance.')}
            </Notice>
        );
    }

    if (!datos) {
        return (
            <EmptyState
                icon={FlaskConical}
                title="Sin promoción"
                subtitle="Ya no está en el portal. Puede que la hayan borrado mientras mirabas la lista."
            />
        );
    }

    return (
        <div className="space-y-4">
            {datos.congelado && (
                <Notice variant="info" icon={Lock}>
                    <span className="font-semibold">Mes cerrado.</span>{' '}
                    Estos números quedaron congelados al terminar {rotuloMes(datos.year_month)} —
                    son los que se pagaron, no un recálculo de hoy.
                </Notice>
            )}
            {datos.simulacion && (
                <Notice variant="warning" icon={TrendingUp}>
                    <span className="font-semibold">Estás simulando.</span>{' '}
                    Así habría quedado este programa si hubiera corrido
                    en {rotuloMes(datos.mes_medido)}. La promoción es
                    de {rotuloMes(datos.year_month)} y no cambió.
                </Notice>
            )}

            <div className="flex flex-wrap items-end gap-3">
                /* `space-y-1` en BLOQUE y no `flex flex-col`: `LiquidDatePicker`
           declara `basis-[140px]` —su ANCHO cuando vive en una fila— y en un
           contenedor `flex-col` ese basis manda sobre el eje VERTICAL, así que
           su ancho se convertía en 140px de ALTO. Medido el 2026-09-05: el
           control declara `h-[max(40px,var(--tap-min))]` y computaba 140px.
           En un contenedor `block`, `flex-basis` no aplica. */
        <div className="space-y-1 min-w-0">
                    <span className="text-label uppercase tracking-wide font-semibold text-content-2">
                        Medir contra el mes
                    </span>
                    <LiquidSelect
                        value={mes || datos.year_month}
                        onChange={setMes}
                        options={mesesRecientes()}
                        clearable={false}
                        ariaLabel="Mes contra el que se mide"
                    />
                </div>
                {datos.simulacion && (
                    <Button variant="secondary" size="sm" onClick={() => setMes('')}>
                        Volver a {rotuloMes(datos.year_month)}
                    </Button>
                )}
                {Array.isArray(datos.laboratorios) && datos.laboratorios.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 items-center">
                        {datos.laboratorios.map((l) => (
                            <Badge key={l.id} variant="neutral" size="sm">{l.nombre}</Badge>
                        ))}
                    </div>
                )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 rounded-card border border-border-card p-3">
                <Total rotulo="Venta del mes" valor={fmtMoneda(datos.venta_total)} />
                <Total rotulo="Costo del bono" valor={fmtMoneda(datos.costo_total)} destacado />
                {/* «Personas» a secas se leía como el padrón: decía 0 mientras la
                    fila de abajo decía «6 personas», que es la contradicción que
                    hace desconfiar de toda la pantalla. Cuenta a quien COBRA —
                    una sala sin nivel no le paga a nadie. */}
                <Total rotulo="Cobran bono" valor={fmtUnidades(datos.personas_pagadas)} />
            </div>

            {salas.length === 0 ? (
                <EmptyState
                    icon={FlaskConical}
                    title="Todavía no hay umbrales"
                    subtitle="Ninguna sala tiene cuánto vender, así que nadie puede alcanzar un nivel. Se escriben al editar la promoción."
                />
            ) : (
                <div className="space-y-2">
                    {salas.map((s) => <FilaSala key={s.branch_id} s={s} />)}
                </div>
            )}
        </div>
    );
}

function FilaSala({ s }) {
    const alcanzo = s.nivel != null;
    return (
        <div data-surface="card" className="rounded-card border border-border-card bg-surface-card p-3">
            <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                    <h4 className="text-body font-semibold text-content truncate">{s.sala}</h4>
                    <p className="text-caption text-content-3 tabular-nums mt-0.5">
                        Vendió {fmtMoneda(s.venta)} · {fmtUnidades(s.personas)}{' '}
                        {Number(s.personas) === 1 ? 'persona' : 'personas'}
                    </p>
                </div>
                <Badge variant={alcanzo ? 'success' : 'neutral'}>
                    {alcanzo ? `Nivel ${s.nivel}` : 'Sin nivel'}
                </Badge>
            </div>

            <div className="grid grid-cols-2 gap-2 mt-2.5">
                <Dato rotulo="Cada persona" valor={fmtMoneda(s.monto_por_persona)} />
                <Dato rotulo="Le cuesta" valor={fmtMoneda(s.costo)} />
            </div>

            {/* Lo que la sala puede HACER con este número. Sin esto la pantalla
                dice cuánto va y deja a la persona sin nada que perseguir. */}
            {s.siguiente_nivel != null && (
                <p className="text-caption text-content-2 mt-2 tabular-nums">
                    Le faltan <span className="font-semibold text-brand">{fmtMoneda(s.falta)}</span>{' '}
                    para el nivel {s.siguiente_nivel}
                    {s.siguiente_monto != null && <> ({fmtMoneda(s.siguiente_monto)} cada uno)</>}.
                </p>
            )}
        </div>
    );
}

function Total({ rotulo, valor, destacado = false }) {
    return (
        <div className="min-w-0">
            <span className="block text-micro uppercase tracking-wide text-content-3 font-semibold">
                {rotulo}
            </span>
            <span className={`text-subtitle font-semibold tabular-nums ${destacado ? 'text-brand' : 'text-content'}`}>
                {valor}
            </span>
        </div>
    );
}

function Dato({ rotulo, valor }) {
    return (
        <div className="min-w-0">
            <span className="block text-micro uppercase tracking-wide text-content-3 font-semibold">
                {rotulo}
            </span>
            <span className="text-body font-semibold text-content tabular-nums">{valor}</span>
        </div>
    );
}
