import React, { useMemo, useState } from 'react';
import { Ban, HandCoins, Printer, Wallet } from 'lucide-react';
import Badge from '../common/Badge';
import Button from '../common/Button';
import Notice from '../common/Notice';
import PortalInput from '../common/PortalInput';
import PortalTextarea from '../common/PortalTextarea';
import useResolverDiferencia from '../../hooks/useResolverDiferencia';
import { formatMoney } from '../../utils/formatNumber';
import { fechaHora12 } from '../../utils/hora';
import { shortEmployeeName } from '../../utils/nameUtils';

/**
 * Quién responde por un faltante sin causa, cuánto lleva abonado y cómo se
 * abona lo que queda.
 *
 * Lo pidió el usuario el 2026-09-25: «que pueda seleccionar los responsables y
 * que se pueda abonar, sea individual o total». Y decidió que los abonos
 * pueden ser PARCIALES y en días distintos: cada persona tiene su saldo, y el
 * faltante queda saldado cuando el de todas llega a cero.
 *
 * ── Individual y total son la misma operación ──────────────────────────────
 * Un abono individual es una fila; «cobrar todo» son todas las filas con su
 * saldo. El servidor recibe siempre la lista y rechaza que alguien abone más
 * de lo que le queda — el saldo lo calcula él con la resolución bloqueada, así
 * que dos pantallas abiertas no cobran dos veces la misma parte.
 *
 * ── Por qué el monto arranca en el saldo ───────────────────────────────────
 * Es lo que se abona casi siempre. Pero se puede bajar: abonar menos es
 * exactamente el caso que el usuario pidió («$2 hoy y $2.05 la otra semana»).
 *
 * Es una reposición VOLUNTARIA: nunca un descuento de planilla (CT Arts. 132 y
 * 134). La pantalla lo dice porque es la línea que no se puede cruzar.
 */

const centavos = (n) => Math.round(Number(n || 0) * 100);

export default function AbonosDeDiferencia({
    corte,
    diferencia,
    nombreSala = {},
    puedeResolver = false,
    origen = 'modulo',
    onCambio,
}) {
    const { abonar, anularAbono, imprimirAbonos, hacerIngreso, ocupado } = useResolverDiferencia({ nombreSala, origen });

    const personas = useMemo(() => diferencia?.personas || [], [diferencia]);
    const abonos = useMemo(() => diferencia?.abonos || [], [diferencia]);
    const vivos = useMemo(() => abonos.filter((a) => !a.anulada_at), [abonos]);

    const asignado = personas.reduce((t, p) => t + Number(p.monto || 0), 0);
    const abonado = vivos.reduce((t, a) => t + Number(a.monto || 0), 0);
    const saldo = Math.max(0, Math.round((asignado - abonado) * 100) / 100);
    const pct = asignado > 0 ? Math.min(100, Math.round((abonado / asignado) * 100)) : 0;

    // Lo que se va a abonar por persona. Vacío = su saldo.
    const [montos, setMontos] = useState(() => new Map());
    const [anulando, setAnulando] = useState(null);
    const [motivo, setMotivo] = useState('');

    const montoDe = (p) => {
        const v = montos.get(p.persona_id);
        return v === undefined ? Number(p.saldo || 0) : v;
    };

    const abonarA = async (lista) => {
        const filas = lista
            .map((p) => ({
                persona_id: p.persona_id,
                monto: Number(montos.get(p.persona_id) ?? p.saldo),
                nombre: shortEmployeeName(p.nombre),
                saldoAntes: Number(p.saldo || 0),
            }))
            .filter((f) => centavos(f.monto) > 0);
        if (!filas.length) return;
        const r = await abonar(corte, diferencia, filas);
        if (r) { setMontos(new Map()); onCambio?.(); }
    };

    const cobrarTodo = async () => {
        const filas = personas
            .filter((p) => centavos(p.saldo) > 0)
            .map((p) => ({
                persona_id: p.persona_id,
                monto: Number(p.saldo),
                nombre: shortEmployeeName(p.nombre),
                saldoAntes: Number(p.saldo),
            }));
        if (!filas.length) return;
        const r = await abonar(corte, diferencia, filas);
        if (r) { setMontos(new Map()); onCambio?.(); }
    };

    const reimprimir = (a) => {
        const p = personas.find((x) => String(x.persona_id) === String(a.persona_id));
        // El saldo que el papel imprime es el de HOY, no el de cuando se hizo el
        // abono: se reimprime para anexar, y lo que se firma es el estado vivo.
        imprimirAbonos(corte, [{
            id: a.id, nombre: shortEmployeeName(a.nombre), monto: Number(a.monto),
            saldo: Number(p?.saldo || 0),
        }], a.registrado_at);
    };

    const confirmarAnular = async (a) => {
        const ok = await anularAbono(corte, a, motivo);
        if (ok) { setAnulando(null); setMotivo(''); onCambio?.(); }
    };

    if (!diferencia || diferencia.via !== 'REPONE') return null;

    return (
        <div data-surface="card" className="p-3 space-y-3">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <span className="text-caption font-black uppercase tracking-widest text-content-3">
                    Responsables
                </span>
                <span className="text-caption tabular-nums text-content-2">
                    Abonado {formatMoney(abonado)} de {formatMoney(asignado)}
                </span>
            </div>
            <div className="h-1.5 rounded-full bg-border-card overflow-hidden" data-medida="dato">
                <div className="h-full bg-success" style={{ width: `${pct}%` }} />
            </div>

            <div className="space-y-2">
                {personas.map((p) => {
                    const queda = Number(p.saldo || 0);
                    const pagado = centavos(queda) <= 0;
                    const monto = montoDe(p);
                    const malMonto = centavos(monto) <= 0 || centavos(monto) > centavos(queda);
                    return (
                        <div key={p.persona_id} className="flex items-center gap-2 flex-wrap">
                            <div className="min-w-0 flex-1">
                                <div className="text-label font-bold text-content truncate">
                                    {shortEmployeeName(p.nombre)}
                                </div>
                                <div className="text-caption text-content-3 tabular-nums">
                                    Le toca {formatMoney(p.monto)}
                                    {Number(p.abonado) > 0 && ` · abonó ${formatMoney(p.abonado)}`}
                                </div>
                            </div>
                            {pagado ? (
                                <Badge variant="success" size="sm">Pagado</Badge>
                            ) : (
                                <>
                                    <span className="text-label font-bold tabular-nums text-danger-text">
                                        Debe {formatMoney(queda)}
                                    </span>
                                    {puedeResolver && (
                                        <div className="flex items-center gap-1.5">
                                            <div className="w-28">
                                                <PortalInput
                                                    name={`abono-${p.persona_id}`}
                                                    inputMode="decimal"
                                                    maskType="DECIMAL"
                                                    prefix="$"
                                                    aria-label={`Cuánto abona ${shortEmployeeName(p.nombre)}`}
                                                    value={monto}
                                                    onChange={(e) => {
                                                        const v = e.target.value;
                                                        setMontos((prev) => new Map(prev).set(p.persona_id, v === '' ? '' : Number(v)));
                                                    }}
                                                />
                                            </div>
                                            <Button
                                                variant="secondary" size="sm" icon={HandCoins}
                                                loading={ocupado} disabled={malMonto}
                                                onClick={() => abonarA([p])}
                                            >
                                                Abonar
                                            </Button>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    );
                })}
            </div>

            {puedeResolver && centavos(saldo) > 0 && personas.filter((p) => centavos(p.saldo) > 0).length > 1 && (
                <Button variant="primary" icon={Wallet} className="w-full" loading={ocupado} onClick={cobrarTodo}>
                    Cobrar todo lo que queda · {formatMoney(saldo)}
                </Button>
            )}

            {centavos(saldo) === 0 && (
                <Notice variant="success">El faltante quedó saldado.</Notice>
            )}

            {abonos.length > 0 && (
                <div className="space-y-1.5 pt-1">
                    <span className="text-caption font-black uppercase tracking-widest text-content-3">
                        Abonos
                    </span>
                    {abonos.map((a) => (
                        <div key={a.id} className="space-y-2">
                            <div className="flex items-center gap-2 flex-wrap">
                                <div className="min-w-0 flex-1">
                                    <span className={`text-label font-bold tabular-nums ${a.anulada_at ? 'text-content-3 line-through' : 'text-content'}`}>
                                        {formatMoney(a.monto)}
                                    </span>
                                    <span className="text-caption text-content-2"> · {shortEmployeeName(a.nombre)}</span>
                                    <span className="block text-caption text-content-3">
                                        {fechaHora12(a.registrado_at)}
                                        {/* Quién hizo cada paso (usuario: «todo movimiento
                                            debe decir quién lo hizo»). */}
                                        {a.registrado_nombre && ` · recibió ${shortEmployeeName(a.registrado_nombre)}`}
                                        {a.asentado_at && ` · anotó ${a.asentado_nombre ? shortEmployeeName(a.asentado_nombre) : 'sin nombre'}`}
                                        {a.anulada_at && ` · anuló ${a.anulada_nombre ? shortEmployeeName(a.anulada_nombre) : 'sin nombre'}: ${a.anulada_motivo}`}
                                    </span>
                                </div>
                                {/* El portal hace el ingreso al abonar. Si la caja no lo
                                    aceptó, el abono quedó guardado sin entrar: acá
                                    se reintenta, con la misma clave, sin duplicar. */}
                                {!a.anulada_at && (a.asentado_at
                                    ? <Badge variant="info" size="sm">En caja · {a.asentado_ref}</Badge>
                                    : puedeResolver
                                        ? <Button variant="secondary" size="sm" loading={ocupado}
                                            onClick={async () => { if (await hacerIngreso(corte, a)) onCambio?.(); }}>
                                            Hacer el ingreso
                                        </Button>
                                        : <Badge variant="warning" size="sm" dot>No entró a la caja</Badge>)}
                                {!a.anulada_at && puedeResolver && anulando !== a.id && (
                                    <div className="flex items-center gap-1">
                                        <Button variant="ghost" size="sm" icon={Printer} iconOnly
                                            title="Imprimir comprobante" disabled={ocupado}
                                            onClick={() => reimprimir(a)} />
                                        {!a.asentado_at && (
                                            <Button variant="ghost" size="sm" icon={Ban} iconOnly
                                                title="Anular abono" disabled={ocupado}
                                                onClick={() => { setAnulando(a.id); setMotivo(''); }} />
                                        )}
                                    </div>
                                )}
                            </div>
                            {anulando === a.id && (
                                <div className="space-y-2">
                                    <PortalTextarea
                                        label="Por qué se anula"
                                        name={`motivo-anular-abono-${a.id}`}
                                        value={motivo}
                                        onChange={(e) => setMotivo(e.target.value)}
                                        rows={2}
                                        placeholder="Qué estaba mal en este abono"
                                    />
                                    <div className="flex items-center justify-end gap-1.5">
                                        <Button variant="ghost" size="sm" disabled={ocupado} onClick={() => setAnulando(null)}>
                                            Volver
                                        </Button>
                                        <Button variant="destructive" size="sm" loading={ocupado}
                                            disabled={!motivo.trim()} onClick={() => confirmarAnular(a)}>
                                            Anular abono
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            <p className="text-caption text-content-3">
                Al abonar, el portal hace el ingreso en la caja de la sala: el siguiente corte ya lo
                cuenta. Con la caja cerrada no se puede abonar. Es una reposición voluntaria y nunca
                se descuenta del salario.
            </p>
        </div>
    );
}
