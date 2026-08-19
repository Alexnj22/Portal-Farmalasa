import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Ban, HandCoins, Printer, ShieldCheck } from 'lucide-react';
import Badge from '../common/Badge';
import Button from '../common/Button';
import Checkbox from '../common/Checkbox';
import Notice from '../common/Notice';
import PortalInput from '../common/PortalInput';
import PortalTextarea from '../common/PortalTextarea';
import SegmentedControl from '../common/SegmentedControl';
import { fetchTurnoDelCorte } from '../../data/cortes';
import { repartirEnPartes, severidad } from '../../utils/cortesDiagnostico';
import { formatMoney } from '../../utils/formatNumber';
import { useAuth } from '../../context/AuthContext';
import useResolverDiferencia from '../../hooks/useResolverDiferencia';

/**
 * Qué se hizo con el faltante o el sobrante de un corte.
 *
 * Lo pidió el usuario (2026-08-14): «si un corte tiene sobrante / faltante, se
 * debe poder editar... si se abre para agregar faltante, debe decir confirmar
 * faltante para reponer el dinero, al darle, imprime un ticket como ingreso de
 * dinero por faltante del día tal».
 *
 * ── Tres caminos, y el signo decide cuáles se ofrecen ──────────────────────
 * Un faltante se REPONE (entra dinero) y un sobrante se RETIRA (sale). Ofrecer
 * los dos siempre sería dejar que alguien «retire» un faltante, que no quiere
 * decir nada; el servidor además lo rechaza. El tercero —JUSTIFICA— existe
 * porque a veces la causa apareció y ya está corregida en el sistema, y forzar
 * un movimiento de dinero ahí inventaría un descuadre nuevo.
 *
 * ── Por qué el reparto se muestra y no sólo se calcula ─────────────────────
 * «Quedarán registrados los del turno, ahí se puede seleccionar o quitar si uno
 * no aportó» (usuario). O sea que la lista es una propuesta, no un hecho: se
 * reparte en partes iguales al marcar y desmarcar, pero cada monto es editable
 * y lo que falta o sobra para llegar al total se ve mientras se escribe. Un
 * reparto que no suma exacto deja a alguien debiendo un centavo que no está en
 * ningún lado, y el servidor lo rechaza — mejor verlo antes de apretar.
 */

const VIA_LARGO = {
    REPONE: 'Se repuso el dinero',
    RETIRA: 'Se retiró el sobrante',
    JUSTIFICA: 'Se encontró la causa',
};

const centavos = (n) => Math.round(Number(n || 0) * 100);
const aMonto = (c) => Math.round(c) / 100;

const selloDeTiempo = (iso) => (iso
    ? new Date(iso).toLocaleString('es-SV', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
        hour12: true, timeZone: 'America/El_Salvador',
    })
    : '');

export default function ResolverDiferencia({
    corte,
    nombreSala = {},
    diferencia = null,     // la resolución que ya tiene, si la tiene
    personasResueltas = [],
    puedeResolver = false,
    origen = 'modulo',
    onCambio,              // se llama tras guardar o anular, para recargar
}) {
    const { user } = useAuth();
    const { resolver, anular, imprimir, ocupado } = useResolverDiferencia({ nombreSala, origen });

    const tramo = Number(corte?.tramo ?? 0);
    const sev = severidad(tramo);
    const falta = tramo < 0;

    const [via, setVia] = useState(falta ? 'REPONE' : 'RETIRA');
    const [causa, setCausa] = useState('');
    const [candidatos, setCandidatos] = useState([]);
    const [marcadas, setMarcadas] = useState(() => new Set());
    const [montos, setMontos] = useState(() => new Map());
    const [abriendo, setAbriendo] = useState(false);
    const [motivoAnular, setMotivoAnular] = useState('');
    const [anulando, setAnulando] = useState(false);

    const corteId = corte?.id ?? null;
    const yaResuelta = !!diferencia && !diferencia.anulada_at;

    // Los candidatos a aportar. Se piden al abrir el formulario y no con el
    // corte: sólo hacen falta si alguien va a reponer.
    useEffect(() => {
        if (!abriendo || !corteId || via !== 'REPONE') return;
        let vivo = true;
        fetchTurnoDelCorte(corteId).then((filas) => {
            if (!vivo) return;
            setCandidatos(filas);
            // Preselección: los del turno, y siempre quien tiene la sesión —es
            // la persona responsable (regla del usuario). Hoy el módulo de
            // turnos no está encendido, así que en la práctica arranca con una
            // sola marcada, que es lo honesto: proponer a toda la sala como
            // aportante sería inventar un turno que nadie registró.
            const previa = filas.filter((f) => f.del_turno || f.id === user?.id).map((f) => f.id);
            setMarcadas(new Set(previa.length ? previa : filas.slice(0, 1).map((f) => f.id)));
        });
        return () => { vivo = false; };
    }, [abriendo, corteId, via, user]);

    // El reparto se rehace al cambiar quiénes aportan. Va en render y no en un
    // efecto —el proyecto prohíbe `setState` dentro de `useEffect`— usando el
    // patrón de «reaccionar a un cambio»: se compara con la clave anterior.
    const clave = [...marcadas].sort().join('|');
    const [clavePrevia, setClavePrevia] = useState(clave);
    if (clave !== clavePrevia) {
        setClavePrevia(clave);
        const ids = [...marcadas];
        const partes = repartirEnPartes(tramo, ids.length);
        setMontos(new Map(ids.map((id, i) => [id, partes[i]])));
    }

    const sumaAportes = useMemo(
        () => [...marcadas].reduce((a, id) => a + centavos(montos.get(id) ?? 0), 0),
        [marcadas, montos],
    );
    const objetivo = Math.abs(centavos(tramo));
    const restan = objetivo - sumaAportes;

    const alternar = useCallback((id) => {
        setMarcadas((prev) => {
            const s = new Set(prev);
            if (s.has(id)) s.delete(id); else s.add(id);
            return s;
        });
    }, []);

    const cambiarMonto = useCallback((id, valor) => {
        setMontos((prev) => new Map(prev).set(id, valor === '' ? '' : Number(valor)));
    }, []);

    const guardar = useCallback(async () => {
        const ids = [...marcadas];
        const personas = via === 'REPONE'
            ? ids.map((id) => ({
                employee_id: id,
                monto: Number(montos.get(id) ?? 0),
                del_turno: !!candidatos.find((c) => c.id === id)?.del_turno,
            }))
            : [];
        const nombres = personas.map((p) => ({
            nombre: candidatos.find((c) => c.id === p.employee_id)?.name || '',
            monto: p.monto,
        }));
        const r = await resolver(corte, { via, causa, montoVisto: tramo, personas, nombres });
        if (r) { setAbriendo(false); setCausa(''); onCambio?.(); }
    }, [marcadas, via, montos, candidatos, resolver, corte, causa, tramo, onCambio]);

    const confirmarAnular = useCallback(async () => {
        const ok = await anular(corte, diferencia, motivoAnular);
        if (ok) { setAnulando(false); setMotivoAnular(''); onCambio?.(); }
    }, [anular, corte, diferencia, motivoAnular, onCambio]);

    const reimprimir = useCallback(() => {
        imprimir(corte, diferencia, (personasResueltas || []).map((p) => ({
            nombre: p.nombre, monto: p.monto,
        })));
    }, [imprimir, corte, diferencia, personasResueltas]);

    // ── Ya resuelta: se muestra, se reimprime, se anula ─────────────────────
    if (yaResuelta) {
        return (
            <div data-surface="card" className="p-3 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="success" size="sm" icon={ShieldCheck}>
                        {VIA_LARGO[diferencia.via] || 'Resuelta'}
                    </Badge>
                    <span className="text-label font-bold text-content tabular-nums">
                        {formatMoney(Math.abs(Number(diferencia.monto)))}
                    </span>
                    {diferencia.asentado_at && (
                        <Badge variant="info" size="sm">Registrado {diferencia.asentado_ref}</Badge>
                    )}
                    {!diferencia.asentado_at && diferencia.via !== 'JUSTIFICA' && (
                        <Badge variant="warning" size="sm" dot>Falta registrarlo en el sistema</Badge>
                    )}
                </div>

                <div className="text-caption text-content-2">{diferencia.causa}</div>

                {(personasResueltas || []).length > 0 && (
                    <div className="text-caption text-content-3">
                        {personasResueltas.map((p) => `${p.nombre} ${formatMoney(Math.abs(Number(p.monto)))}`).join(' · ')}
                    </div>
                )}

                <div className="text-caption text-content-3">
                    {diferencia.registrado_nombre || 'Sin registrar quién'} · {selloDeTiempo(diferencia.registrado_at)}
                    {diferencia.impreso_at ? ' · comprobante impreso' : ' · sin imprimir'}
                </div>

                {anulando ? (
                    <div className="space-y-2">
                        <PortalTextarea
                            label="Por qué se anula"
                            name="motivo-anular"
                            value={motivoAnular}
                            onChange={(e) => setMotivoAnular(e.target.value)}
                            rows={2}
                            placeholder="Qué estaba mal en esta resolución"
                        />
                        <div className="flex items-center justify-end gap-1.5">
                            <Button variant="ghost" size="sm" onClick={() => setAnulando(false)} disabled={ocupado}>
                                Volver
                            </Button>
                            <Button variant="destructive" size="sm" loading={ocupado}
                                disabled={!motivoAnular.trim()} onClick={confirmarAnular}>
                                Anular
                            </Button>
                        </div>
                    </div>
                ) : puedeResolver && (
                    <div className="flex items-center justify-end gap-1.5">
                        {diferencia.via !== 'JUSTIFICA' && (
                            <Button variant="secondary" size="sm" icon={Printer} onClick={reimprimir} loading={ocupado}>
                                Imprimir comprobante
                            </Button>
                        )}
                        {/* Ya registrada en el sistema significa que el dinero se
                            movió allá: anularla acá dejaría las dos cuentas
                            distintas, y el servidor la rechaza. */}
                        {!diferencia.asentado_at && (
                            <Button variant="ghost" size="sm" icon={Ban} onClick={() => setAnulando(true)}>
                                Anular
                            </Button>
                        )}
                    </div>
                )}
            </div>
        );
    }

    if (sev === 'ok' || !puedeResolver || corte?.estado === 'DESCARTADO') return null;

    // ── Todavía sin resolver ────────────────────────────────────────────────
    if (!abriendo) {
        return (
            <Button variant="secondary" icon={HandCoins} onClick={() => setAbriendo(true)} className="w-full">
                {falta
                    ? `Confirmar faltante de ${formatMoney(Math.abs(tramo))} para reponer el dinero`
                    : `Resolver el sobrante de ${formatMoney(Math.abs(tramo))}`}
            </Button>
        );
    }

    const opciones = falta
        ? [{ value: 'REPONE', label: 'Se repone el dinero' }, { value: 'JUSTIFICA', label: 'Ya se encontró la causa' }]
        : [{ value: 'RETIRA', label: 'Se retira el sobrante' }, { value: 'JUSTIFICA', label: 'Ya se encontró la causa' }];

    return (
        <div data-surface="card" className="p-3 space-y-3">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <span className="text-caption font-black uppercase tracking-widest text-content-3">
                    {falta ? 'Reponer el faltante' : 'Resolver el sobrante'}
                </span>
                <span className="text-body font-bold tabular-nums text-content">
                    {formatMoney(Math.abs(tramo))}
                </span>
            </div>

            <SegmentedControl
                label="Qué se hizo"
                value={via}
                onChange={setVia}
                options={opciones}
            />

            <PortalTextarea
                label="Causa"
                name="causa"
                value={causa}
                onChange={(e) => setCausa(e.target.value)}
                rows={2}
                placeholder={falta
                    ? 'Qué pasó con el dinero que faltó'
                    : 'De dónde salió el dinero de más'}
            />

            {via === 'REPONE' && (
                <div className="space-y-2">
                    <div className="flex items-baseline justify-between gap-2">
                        <span className="text-caption font-black uppercase tracking-widest text-content-3">
                            Quién repone
                        </span>
                        <span className={`text-caption tabular-nums ${restan === 0 ? 'text-success-text' : 'text-danger-text'}`}>
                            {restan === 0
                                ? 'Suma exacto'
                                : restan > 0
                                    ? `Faltan ${formatMoney(aMonto(restan))}`
                                    : `Sobran ${formatMoney(aMonto(-restan))}`}
                        </span>
                    </div>

                    {!candidatos.length && (
                        <div className="text-caption text-content-3">Cargando la sala…</div>
                    )}

                    {candidatos.map((c) => {
                        const marcada = marcadas.has(c.id);
                        return (
                            <div key={c.id} className="flex items-center gap-2">
                                <div className="min-w-0 flex-1">
                                    <Checkbox
                                        name={`aporta-${c.id}`}
                                        checked={marcada}
                                        onChange={() => alternar(c.id)}
                                        label={c.name}
                                        description={c.del_turno ? 'Del turno' : undefined}
                                    />
                                </div>
                                {marcada && (
                                    <div className="w-28 shrink-0">
                                        <PortalInput
                                            name={`monto-${c.id}`}
                                            inputMode="decimal"
                                            maskType="DECIMAL"
                                            prefix="$"
                                            aria-label={`Cuánto repone ${c.name}`}
                                            value={montos.get(c.id) ?? ''}
                                            onChange={(e) => cambiarMonto(c.id, e.target.value)}
                                        />
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {/* El turno no está encendido todavía: decirlo es más honesto
                        que presentar la lista de la sala como si fuera el turno. */}
                    {candidatos.length > 0 && !candidatos.some((c) => c.del_turno) && (
                        <Notice variant="info">
                            Todavía no se registra quién estuvo en cada turno, así que acá aparece
                            la sala completa. Marca sólo a quienes aportan.
                        </Notice>
                    )}
                </div>
            )}

            {via !== 'JUSTIFICA' && (
                <Notice variant="info">
                    <span className="font-bold">Al guardar sale el comprobante para firmar</span>
                    <span className="block mt-0.5 font-normal text-content-2">
                        Anexalo al corte. Después hay que registrar {falta ? 'el ingreso' : 'el vale'} en
                        el sistema — se puede hacer uno solo por varias diferencias.
                    </span>
                </Notice>
            )}

            <div className="flex items-center justify-end gap-1.5">
                <Button variant="ghost" size="sm" onClick={() => setAbriendo(false)} disabled={ocupado}>
                    Volver
                </Button>
                <Button
                    variant="primary"
                    size="sm"
                    loading={ocupado}
                    disabled={!causa.trim() || (via === 'REPONE' && (restan !== 0 || !marcadas.size))}
                    onClick={guardar}
                >
                    {via === 'JUSTIFICA' ? 'Guardar' : 'Guardar e imprimir'}
                </Button>
            </div>
        </div>
    );
}
