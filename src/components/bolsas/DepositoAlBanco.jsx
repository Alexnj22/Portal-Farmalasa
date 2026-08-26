import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Banknote, Building2, HandCoins, Landmark } from 'lucide-react';
import Button from '../common/Button';
import LiquidModal from '../common/LiquidModal';
import LiquidSelect from '../common/LiquidSelect';
import Notice from '../common/Notice';
import PortalInput from '../common/PortalInput';
import SegmentedControl from '../common/SegmentedControl';
import { fetchBancos, fetchPersonasDeAdministracion, registrarDeposito } from '../../data/bolsas';
import { formatMoney } from '../../utils/formatNumber';
import { mensajeAmigable } from '../../utils/errorMessages';
import { useToastStore } from '../../store/toastStore';

/**
 * Lo que sigue después de confirmar el conteo: cuánto se lleva al banco.
 *
 * El proceso, dictado por el usuario el 2026-08-24 con su propio ejemplo:
 *
 *     contado          $22,350.35   (de eso, $300 en moneda)
 *     se quiere llevar $22,400.00
 *     1. la moneda se cambia por billete
 *     2. los ~$50 que faltan salen por un vale en Salud 3
 *     3. se confirman los $22,400 para el banco
 *     4. el remanente se le entrega al gerente general
 *
 * ── Se llama DEPÓSITO y no remesa ──────────────────────────────────────────
 * El usuario dice «remesar», y en su idioma está bien. Pero en esta misma
 * pantalla «Remesa» ya es otra cosa: el motivo con el que una sala le paga una
 * transferencia de MoneyGram o RIA a un cliente. Dos cosas distintas con el
 * mismo nombre, a un clic de distancia, garantizan que alguien elija la
 * equivocada.
 *
 * ── El total no se escribe: se muestra ─────────────────────────────────────
 * Sale de las bolsas confirmadas y lo vuelve a sumar el servidor al cerrar. Lo
 * único que se escribe es cuánto se lleva — y el remanente es una resta, nunca
 * un número tecleado. Un remanente escrito a mano es un número que nadie puede
 * verificar contra nada.
 *
 * ── El cambio de moneda no se pide ─────────────────────────────────────────
 * Cambiar $300 de moneda por $300 en billete no mueve ningún total. Preguntarlo
 * sería un campo que no cambia ninguna cuenta.
 *
 * ── Tiene DOS salidas, y por eso se llama «Finalizar» ─────────────────────
 * «esa bolsa que está pendiente de depósito, fue un dinero que se agarró. que
 * en vez de que sí o sí sea depósito, diga finalizar o algo, y pregunte si es
 * depósito, o entrega en efectivo y a quién (que sólo salga admin)» (usuario,
 * 2026-08-26).
 *
 * El circuito tenía UNA salida —el banco— y por eso una bolsa cuyo efectivo se
 * entregó en mano se quedaba para siempre en «pendiente de depósito»: la única
 * forma de sacarla de ahí era registrar un depósito que nunca ocurrió. Un
 * pendiente que no se puede cerrar con la verdad enseña a cerrarlo con mentira.
 *
 * La lista de a quién se le entrega sale del SERVIDOR
 * (`get_personas_de_administracion`) y no de un filtro escrito acá: «admin» no
 * es el rol `Administrador` sino un área de cuatro cargos, y escribir esa lista
 * dos veces es cómo el selector termina ofreciendo a alguien que el servidor
 * rechaza.
 *
 * ── El aviso al Gerente General lo manda la BASE ───────────────────────────
 * «al darle en depositar al banco, que llegue una notificación al gerente
 * general con: el monto a depositar, quien y a que banco. el remanente que le
 * queda» (usuario, 2026-08-26).
 *
 * No sale de acá a propósito: `registrar_deposito_bancario` lo emite dentro de
 * la misma transacción que guarda el depósito. Si lo mandara este archivo, un
 * aviso perdido sería indistinguible de un depósito que no se hizo — y el
 * monto del aviso podría no ser el que quedó guardado. Lo que sí es de acá es
 * el BANCO, que hasta hoy no existía como dato en ninguna parte.
 */
export default function DepositoAlBanco({ abierto, bolsas, personas, roles, onClose, onHecho }) {
    const showToast = useToastStore((s) => s.showToast);

    /* Arranca en BANCO porque es el caso normal: la entrega en mano es la
     * excepción del día que alguien retiró el efectivo antes de que llegara. */
    const [destino, setDestino] = useState('BANCO');
    const alBanco = destino === 'BANCO';
    const [entregadoA, setEntregadoA] = useState('');
    const [admins, setAdmins] = useState([]);
    const [monto, setMonto] = useState('');
    const [banco, setBanco] = useState('');
    const [bancos, setBancos] = useState([]);
    const [aporte, setAporte] = useState('');
    const [aporteNota, setAporteNota] = useState('');
    const [llevadoPor, setLlevadoPor] = useState('');
    const [nota, setNota] = useState('');
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState(null);

    /* El catálogo se pide al ABRIR y no al montar la vista: son tres filas y
     * sólo hacen falta cuando alguien va a cerrar un depósito. */
    useEffect(() => {
        if (!abierto) return;
        let vivo = true;
        fetchBancos().then((filas) => { if (vivo) setBancos(filas); });
        fetchPersonasDeAdministracion().then((filas) => { if (vivo) setAdmins(filas); });
        return () => { vivo = false; };
    }, [abierto]);

    const contado = useMemo(
        () => bolsas.reduce((a, b) => a + Number(b.contado || 0), 0),
        [bolsas],
    );

    const nAporte = Number(String(aporte).replace(',', '.')) || 0;
    const nMonto = Number(String(monto).replace(',', '.')) || 0;
    const disponible = Math.round((contado + nAporte) * 100) / 100;
    const remanente = Math.round((disponible - nMonto) * 100) / 100;
    const noAlcanza = nMonto > 0 && remanente < 0;
    const faltaNota = nAporte > 0 && !aporteNota.trim();

    const cerrar = useCallback(async () => {
        setError(null);
        setGuardando(true);
        const { data, error: err } = await registrarDeposito({
            bolsaIds: bolsas.map((b) => b.id),
            monto: nMonto,
            bancoId: Number(banco),
            aporte: nAporte,
            aporteNota: aporteNota.trim() || null,
            nota: nota.trim() || null,
            llevadoPor: alBanco ? (llevadoPor || null) : null,
            destino,
            entregadoA: alBanco ? null : (entregadoA || null),
        });
        setGuardando(false);
        if (err) { setError(mensajeAmigable(err, 'No se pudo cerrar el efectivo.')); return; }
        showToast(alBanco ? 'Depósito cerrado' : 'Efectivo entregado',
            `${data?.folio} · ${formatMoney(data?.monto_deposito)} ${alBanco ? 'al banco' : 'en mano'}`,
            'success');
        onHecho?.(data);
        onClose?.();
    }, [bolsas, nMonto, banco, nAporte, aporteNota, llevadoPor, nota, destino, entregadoA,
        alBanco, showToast, onHecho, onClose]);

    /* El rótulo que se muestra ES el de la fila, y lo que se guarda es su id.
     * Así el banco elegido coincide con la base por construcción — la regla
     * «un rótulo no es una clave» de CLAUDE.md. */
    const opcionesBanco = useMemo(
        () => bancos.map((b) => ({ value: String(b.id), label: b.nombre })),
        [bancos],
    );

    /* La lista de quién LLEVA el efectivo al banco sale del maestro de personal,
     * no de un texto escrito acá — un rótulo escrito a mano se desincroniza del
     * registro en cuanto alguien cambia de nombre. */
    /* A quién se le entrega el efectivo en mano. Sale del servidor ya filtrado
     * por los cuatro cargos de administración, así que acá no hay ninguna regla
     * que pueda quedar desincronizada con la que valida el cierre. El cargo va
     * de subtexto: con cuatro nombres, saber cuál es el Gerente General es
     * justamente lo que se está por decidir. */
    const opcionesAdmin = useMemo(() => (admins || []).map((p) => ({
        value: String(p.id), label: p.name, sublabel: p.cargo,
    })), [admins]);

    const gente = useMemo(() => [...(personas || [])]
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'))
        .map((p) => ({ value: String(p.id), label: p.name })), [personas]);

    /* El Gerente General, para DECIRLO — no para elegirlo.
     *
     * «el remanente siempre es a Gerente General. así que no debe haber opción»
     * (usuario, 2026-08-26). Quien decide es el servidor: acá sólo se muestra a
     * quién le va a quedar, porque una cifra de efectivo que cambia de manos sin
     * decir a las de quién es exactamente lo que este circuito existe para
     * evitar.
     *
     * Si no se encuentra, la pantalla lo DICE en vez de callarse: el servidor
     * va a rechazar el cierre por lo mismo, y enterarse antes de escribir el
     * monto es mejor que después. */
    /* Se resuelve por `role_id` contra la tabla de cargos, NUNCA cruzando el
     * texto del cargo contra un rótulo escrito acá: es la regla «un rótulo no
     * es una clave» de CLAUDE.md. El único cruce por texto es el que ubica el
     * cargo dentro de `roles` —y ahí el nombre SÍ es la clave, porque esa tabla
     * no tiene columna de código—, exactamente el mismo cruce que hace el
     * servidor. */
    const gerente = useMemo(() => {
        const cargo = (roles || []).find((r) => r.name === 'Gerente General');
        if (!cargo) return null;
        const suyos = (personas || []).filter((p) => String(p.role_id) === String(cargo.id));
        return suyos.find((p) => p.status === 'ACTIVO') || suyos[0] || null;
    }, [roles, personas]);

    return (
        <LiquidModal open={!!abierto} onClose={guardando ? undefined : onClose}
            maxWidth="max-w-lg" className="h-fit" ariaLabel="Depósito al banco">
            <LiquidModal.Header>
                <div className="min-w-0">
                    <h3 className="text-body font-bold text-content">Finalizar el efectivo</h3>
                    <p className="text-caption text-content-3">
                        {bolsas.length} {bolsas.length === 1 ? 'bolsa contada' : 'bolsas contadas'} · lo que no salga queda como remanente
                    </p>
                </div>
            </LiquidModal.Header>

            <LiquidModal.Body className="space-y-4">
                {error && <Notice variant="danger">{error}</Notice>}

                {/* El total es un hecho, no un campo: sale de las bolsas que se
                    confirmaron y el servidor lo vuelve a sumar al cerrar. */}
                <div data-surface="card" className="px-4 py-3">
                    <div className="text-display font-black tabular-nums text-content leading-none">
                        {formatMoney(contado)}
                    </div>
                    <div className="text-caption text-content-2 mt-1.5">
                        contado en {bolsas.length} {bolsas.length === 1 ? 'bolsa' : 'bolsas'}
                    </div>
                </div>

                {/* La PRIMERA pregunta, porque cambia todas las de abajo: un
                    depósito pide banco y quién lo lleva; una entrega en mano
                    pide a quién. Preguntarlo después obligaría a volver a
                    revisar lo ya escrito. */}
                <div className="space-y-1.5">
                    <label className="text-caption font-bold text-content-2">A dónde va</label>
                    <SegmentedControl
                        size="sm"
                        value={destino}
                        onChange={setDestino}
                        label="A dónde va el efectivo"
                        options={[
                            { value: 'BANCO', label: 'Al banco', icon: Landmark },
                            { value: 'EFECTIVO', label: 'En efectivo', icon: HandCoins },
                        ]}
                    />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                        <label htmlFor="dep-monto" className="text-caption font-bold text-content-2">
                            {alBanco ? 'Cuánto va al banco' : 'Cuánto se entrega'}
                        </label>
                        <PortalInput
                            id="dep-monto" name="dep-monto"
                            inputMode="decimal" maskType="DECIMAL"
                            value={monto} onChange={(e) => setMonto(e.target.value)}
                            placeholder={String(contado.toFixed(2))}
                            inputClassName="tabular-nums"
                        />
                    </div>

                    {/* A qué banco. Es obligatorio y el servidor también lo
                        exige: un depósito sin banco no se puede cuadrar contra
                        ningún estado de cuenta, que es lo único para lo que
                        este registro existe. Y es el dato que le falta al
                        aviso que sale hacia el Gerente General al cerrar. */}
                    {alBanco ? (
                        <div className="space-y-1.5">
                            <label className="text-caption font-bold text-content-2">
                                A qué banco
                            </label>
                            <LiquidSelect
                                value={banco} onChange={setBanco}
                                options={opcionesBanco} placeholder="Elige el banco…"
                                icon={Building2}
                            />
                        </div>
                    ) : (
                        /* Sólo administración, y la lista la decide el servidor.
                           Efectivo que cambia de manos sin decir a las de quién
                           es exactamente lo que este circuito existe para
                           evitar. */
                        <div className="space-y-1.5">
                            <label className="text-caption font-bold text-content-2">
                                A quién se le entrega
                            </label>
                            <LiquidSelect
                                value={entregadoA} onChange={setEntregadoA}
                                options={opcionesAdmin} placeholder="Elige a quién…"
                                icon={HandCoins}
                            />
                        </div>
                    )}
                </div>

                {/* El aporte es la excepción: sólo aparece si hace falta llevar
                    MÁS de lo que se contó. Su nota es obligatoria — dinero que
                    entra sin decir de dónde es dinero que aparece de la nada, y
                    el servidor también lo rechaza. */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                        <label htmlFor="dep-aporte" className="text-caption font-bold text-content-2">
                            Entra de afuera <span className="font-normal text-content-3">(opcional)</span>
                        </label>
                        <PortalInput
                            id="dep-aporte" name="dep-aporte"
                            inputMode="decimal" maskType="DECIMAL"
                            value={aporte} onChange={(e) => setAporte(e.target.value)}
                            placeholder="0.00"
                            inputClassName="tabular-nums"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label htmlFor="dep-aporte-nota" className="text-caption font-bold text-content-2">
                            De dónde salió
                        </label>
                        <PortalInput
                            id="dep-aporte-nota" name="dep-aporte-nota"
                            value={aporteNota} onChange={(e) => setAporteNota(e.target.value)}
                            placeholder="Vale de $50 en Salud 3"
                            disabled={nAporte <= 0}
                        />
                    </div>
                </div>

                {/* La cuenta, siempre a la vista. El remanente es una RESTA: no
                    hay campo donde escribirlo, así que no puede decir otra cosa
                    que lo que dan los números de arriba. */}
                <div data-surface="card" className="px-4 py-3 space-y-1.5">
                    <div className="flex items-baseline justify-between gap-3 text-caption text-content-2 tabular-nums">
                        <span>Contado</span><span>{formatMoney(contado)}</span>
                    </div>
                    {nAporte > 0 && (
                        <div className="flex items-baseline justify-between gap-3 text-caption text-content-2 tabular-nums">
                            <span>Entra de afuera</span><span>+ {formatMoney(nAporte)}</span>
                        </div>
                    )}
                    <div className="flex items-baseline justify-between gap-3 text-caption text-content-2 tabular-nums">
                        <span>{alBanco ? 'Al banco' : 'En efectivo'}</span>
                        <span className="whitespace-nowrap">{`− ${formatMoney(nMonto)}`}</span>
                    </div>
                    <div className="flex items-baseline justify-between gap-3 pt-1.5 border-t border-line">
                        <span className="text-subtitle font-bold text-content">Remanente</span>
                        <span className={`text-title-sm font-black tabular-nums ${noAlcanza ? 'text-danger-text' : 'text-content'}`}>
                            {formatMoney(remanente)}
                        </span>
                    </div>
                </div>

                {noAlcanza && (
                    <Notice variant="danger">
                        No alcanza: hay {formatMoney(disponible)} y se quieren llevar {formatMoney(nMonto)}.
                    </Notice>
                )}

                {/* Quién LLEVA el efectivo al banco. No es quien cierra: quien
                    cierra está sentado en administración, y quien lleva es la
                    persona que agarra el dinero y sale a la calle. Ese tramo no
                    lo cubría ningún registro, y es el único en que el efectivo
                    está fuera de las dos puntas. */}
                {/* Sólo tiene sentido yendo al banco: es el tramo en que el
                    efectivo está en la calle, fuera de las dos puntas. En una
                    entrega en mano quien lo recibe YA es el destino. */}
                {alBanco && (
                    <div className="space-y-1.5">
                        <label className="text-caption font-bold text-content-2">
                            Quién lo lleva al banco
                            <span className="font-normal text-content-3"> (opcional)</span>
                        </label>
                        <LiquidSelect
                            value={llevadoPor} onChange={setLlevadoPor}
                            options={gente} placeholder="Elige a quién…"
                            icon={Landmark} clearable
                        />
                    </div>
                )}

                {/* El remanente NO se elige: siempre es del Gerente General
                    («el remanente siempre es a Gerente General. así que no debe
                    haber opción», usuario 2026-08-26). Acá se DICE a quién le
                    queda, que no es lo mismo que preguntarlo — una cifra de
                    efectivo que cambia de manos sin decir a las de quién es
                    justo lo que este circuito existe para evitar.

                    Lo decide el servidor, así que esto es un espejo. Si no hay
                    Gerente General la pantalla lo avisa acá y no al fallar el
                    cierre: enterarse antes de escribir el monto es mejor. */}
                {remanente >= 0.01 && !noAlcanza && (
                    gerente ? (
                        <Notice variant="info" icon={Banknote}>
                            El remanente de <b className="font-bold">{formatMoney(remanente)}</b>
                            {' '}se le entrega a <b className="font-bold">{gerente.name}</b>, Gerente General.
                            {' '}Quedas registrado como quien lo entregó, y al cerrar se le avisa
                            {' '}con el monto, el banco y quién lo lleva.
                        </Notice>
                    ) : (
                        <Notice variant="warning" icon={AlertTriangle}>
                            <span className="font-bold">No hay ningún Gerente General activo</span>
                            <span className="block mt-0.5 font-normal text-content-2">
                                El remanente se le entrega a ese cargo, así que hay que asignarlo
                                antes de cerrar el depósito.
                            </span>
                        </Notice>
                    )
                )}

                <div className="space-y-1.5">
                    <label htmlFor="dep-nota" className="text-caption font-bold text-content-2">
                        Nota <span className="font-normal text-content-3">(opcional)</span>
                    </label>
                    <PortalInput
                        id="dep-nota" name="dep-nota"
                        value={nota} onChange={(e) => setNota(e.target.value)}
                        placeholder="Lo que haga falta recordar de este depósito"
                    />
                </div>
            </LiquidModal.Body>

            <LiquidModal.Footer>
                <Button variant="ghost" onClick={onClose} disabled={guardando}>Cancelar</Button>
                {/* El monto CERO se acepta en una entrega en mano y no en un
                    depósito: es el caso de la bolsa cuyo efectivo se retiró
                    antes de llegar a administración, que hay que poder cerrar
                    diciendo la verdad. Un depósito de $0 al banco no es ningún
                    hecho. El servidor pone la misma regla. */}
                <Button variant="primary" icon={alBanco ? Landmark : HandCoins} loading={guardando}
                    disabled={noAlcanza || faltaNota || nMonto < 0
                        || (alBanco ? (nMonto <= 0 || !banco) : !entregadoA)}
                    onClick={cerrar}>
                    {alBanco ? 'Cerrar el depósito' : 'Registrar la entrega'}
                </Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
