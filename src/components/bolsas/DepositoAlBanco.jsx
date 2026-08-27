import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Banknote, Building2, HandCoins, Landmark } from 'lucide-react';
import Button from '../common/Button';
import LiquidModal from '../common/LiquidModal';
import LiquidSelect from '../common/LiquidSelect';
import Notice from '../common/Notice';
import PortalInput from '../common/PortalInput';
import { fetchBancos, fetchPersonasDeAdministracion, registrarDeposito } from '../../data/bolsas';
import { formatMoney } from '../../utils/formatNumber';
import { mensajeAmigable } from '../../utils/errorMessages';
import { useToastStore } from '../../store/toastStore';
import { rotuloCampo } from '../../utils/rotuloDeCampo';

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
 *     4. lo que sobra queda fuera del portal (ver «el remanente sale del
 *        circuito», más abajo — el paso 4 del dictado original decía «se le
 *        entrega al gerente general» y el usuario lo cerró el 26-ago)
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
 * ── No elige un destino: REPARTE ──────────────────────────────────────────
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
 * La primera corrección fue un control de dos opciones EXCLUYENTES, y duró lo
 * que el usuario tardó en preguntar: «¿qué pasa si una parte va en efectivo y
 * otra en depósito?». Con el excluyente no se podía —salvo que la parte en mano
 * fuera al Gerente General, porque eso ya es el remanente—, o sea que el modelo
 * estaba mal desde el principio: **un cierre no elige un destino, reparte lo
 * contado en hasta tres partes**, y las tres pueden convivir el mismo día.
 *
 *     contado + lo que entró de afuera
 *       − al banco    (exige banco)
 *       − en mano     (exige a quién, y sólo administración)
 *       = remanente   (siempre del Gerente General)
 *
 * Por eso no hay control de «a dónde va»: hay DOS montos, y cada uno pide lo
 * suyo sólo si es mayor que cero. El destino lo deriva el servidor del reparto;
 * es un rótulo del archivo, no algo que alguien elija.
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
 * queda» (usuario, 2026-08-26). El aviso sigue; lo que cambió es que el
 * remanente se DICE y no se le asigna a nadie.
 *
 * No sale de acá a propósito: `registrar_deposito_bancario` lo emite dentro de
 * la misma transacción que guarda el depósito. Si lo mandara este archivo, un
 * aviso perdido sería indistinguible de un depósito que no se hizo — y el
 * monto del aviso podría no ser el que quedó guardado. Lo que sí es de acá es
 * el BANCO, que hasta hoy no existía como dato en ninguna parte.
 */
/* `roles` ya no se recibe: existía sólo para resolver al Gerente General y
 * decir a quién le quedaba el remanente. Desde el 2026-08-26 el remanente no
 * tiene dueño en el portal. */
export default function DepositoAlBanco({ abierto, bolsas, personas, onClose, onHecho }) {
    const showToast = useToastStore((s) => s.showToast);

    const [entregadoA, setEntregadoA] = useState('');
    const [admins, setAdmins] = useState([]);
    const [montoEfectivo, setMontoEfectivo] = useState('');
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
    const nEfectivo = Number(String(montoEfectivo).replace(',', '.')) || 0;
    const disponible = Math.round((contado + nAporte) * 100) / 100;
    const reparto = Math.round((nMonto + nEfectivo) * 100) / 100;
    const remanente = Math.round((disponible - reparto) * 100) / 100;
    const noAlcanza = remanente < 0;
    const faltaNota = nAporte > 0 && !aporteNota.trim();
    /* Cada parte pide lo suyo, y sólo si esa parte existe: un cierre entero al
     * banco no pregunta a quién, y uno entero en mano no pregunta banco. */
    const faltaBanco = nMonto > 0 && !banco;
    const faltaQuien = nEfectivo > 0 && !entregadoA;

    const cerrar = useCallback(async () => {
        setError(null);
        setGuardando(true);
        const { data, error: err } = await registrarDeposito({
            bolsaIds: bolsas.map((b) => b.id),
            monto: nMonto,
            montoEfectivo: nEfectivo,
            bancoId: banco ? Number(banco) : null,
            aporte: nAporte,
            aporteNota: aporteNota.trim() || null,
            nota: nota.trim() || null,
            llevadoPor: nMonto > 0 ? (llevadoPor || null) : null,
            entregadoA: entregadoA || null,
        });
        setGuardando(false);
        if (err) { setError(mensajeAmigable(err, 'No se pudo cerrar el efectivo.')); return; }
        /* El aviso dice el REPARTO, no una de sus mitades: con $10,000 al banco
         * y $6,000 en mano, decir sólo uno de los dos es decir la mitad. */
        showToast('Efectivo cerrado', [
            data?.folio,
            Number(data?.monto_deposito) > 0 ? `${formatMoney(data.monto_deposito)} al banco` : null,
            Number(data?.monto_efectivo) > 0 ? `${formatMoney(data.monto_efectivo)} en mano` : null,
        ].filter(Boolean).join(' · '), 'success');
        onHecho?.(data);
        onClose?.();
    }, [bolsas, nMonto, nEfectivo, banco, nAporte, aporteNota, llevadoPor, nota, entregadoA,
        showToast, onHecho, onClose]);

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

                {/* ── El reparto ─────────────────────────────────────────────
                    DOS renglones, no una elección. Cada uno pide lo suyo sólo si
                    lleva monto, así que un cierre entero al banco no pregunta a
                    quién y uno entero en mano no pregunta banco — pero uno
                    repartido pide las dos cosas, que es lo que el control
                    excluyente de la primera versión hacía imposible. */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                        <label htmlFor="dep-monto" className="text-caption font-bold text-content-2">
                            Al banco
                        </label>
                        <PortalInput
                            id="dep-monto" name="dep-monto"
                            inputMode="decimal" maskType="DECIMAL"
                            value={monto} onChange={(e) => setMonto(e.target.value)}
                            placeholder="0.00"
                            inputClassName="tabular-nums"
                        />
                    </div>
                    {/* A qué banco. Obligatorio en cuanto esa parte lleva monto,
                        y el servidor lo exige igual: un depósito sin banco no se
                        puede cuadrar contra ningún estado de cuenta, que es lo
                        único para lo que ese registro existe. */}
                    <div className="space-y-1.5">
                        <label className={rotuloCampo('text-content-2')}>
                            A qué banco
                        </label>
                        <LiquidSelect
                            value={banco} onChange={setBanco}
                            options={opcionesBanco} placeholder="Elige el banco…"
                            icon={Building2}
                            disabled={nMonto <= 0}
                        />
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                        <label htmlFor="dep-efectivo" className="text-caption font-bold text-content-2">
                            En efectivo
                        </label>
                        <PortalInput
                            id="dep-efectivo" name="dep-efectivo"
                            inputMode="decimal" maskType="DECIMAL"
                            value={montoEfectivo} onChange={(e) => setMontoEfectivo(e.target.value)}
                            placeholder="0.00"
                            inputClassName="tabular-nums"
                        />
                    </div>
                    {/* Sólo administración, y la lista la decide el servidor:
                        efectivo que cambia de manos sin decir a las de quién es
                        exactamente lo que este circuito existe para evitar.

                        Se puede elegir con el monto en CERO a propósito — es la
                        bolsa cuyo efectivo se retiró en la sala antes de llegar:
                        no hay nada que mover y sí hay a quién nombrar. */}
                    <div className="space-y-1.5">
                        <label className={rotuloCampo('text-content-2')}>
                            A quién se le entrega
                        </label>
                        <LiquidSelect
                            value={entregadoA} onChange={setEntregadoA}
                            options={opcionesAdmin} placeholder="Elige a quién…"
                            icon={HandCoins} clearable
                        />
                    </div>
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
                    {nMonto > 0 && (
                        <div className="flex items-baseline justify-between gap-3 text-caption text-content-2 tabular-nums">
                            <span>Al banco</span>
                            <span className="whitespace-nowrap">{`− ${formatMoney(nMonto)}`}</span>
                        </div>
                    )}
                    {nEfectivo > 0 && (
                        <div className="flex items-baseline justify-between gap-3 text-caption text-content-2 tabular-nums">
                            <span>En efectivo</span>
                            <span className="whitespace-nowrap">{`− ${formatMoney(nEfectivo)}`}</span>
                        </div>
                    )}
                    <div className="flex items-baseline justify-between gap-3 pt-1.5 border-t border-line">
                        <span className="text-subtitle font-bold text-content">Remanente</span>
                        <span className={`text-title-sm font-black tabular-nums ${noAlcanza ? 'text-danger-text' : 'text-content'}`}>
                            {formatMoney(remanente)}
                        </span>
                    </div>
                </div>

                {noAlcanza && (
                    <Notice variant="danger">
                        No alcanza: hay {formatMoney(disponible)} y se están repartiendo {formatMoney(reparto)}.
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
                {nMonto > 0 && (
                    <div className="space-y-1.5">
                        <label className={rotuloCampo('text-content-2')}>
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

                {/* ── El remanente sale del circuito ──────────────────────────
                    «el remanente ya no es responsabilidad ni control del portal.
                    es efectivo del dueño» (usuario, 2026-08-26).

                    Hasta hoy esta pantalla lo asignaba al Gerente General, decía
                    que quedabas registrado como quien se lo entregó, y —peor—
                    avisaba que sin un Gerente General activo no se podía cerrar.
                    Eso era el registro del efectivo cayéndose por una asignación
                    de cargo que ya no le incumbe.

                    El NÚMERO se queda porque cierra la cuenta: sin él, un cierre
                    parcial se lee como un hueco. Lo que se fue es el dueño. */}
                {remanente >= 0.01 && !noAlcanza && (
                    <Notice variant="info" icon={Banknote}>
                        Quedan <b className="font-bold">{formatMoney(remanente)}</b> sin salir por
                        {' '}el portal. Se anotan en el cierre para que la cuenta cuadre; de ahí en
                        {' '}adelante son efectivo del dueño y el portal no les sigue la pista.
                    </Notice>
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
                {/* Se puede cerrar con TODO en cero: es la bolsa cuyo efectivo
                    se retiró en la sala antes de llegar a administración, y hay
                    que poder cerrarla diciendo la verdad. Lo que no se puede es
                    repartir más de lo que hay, ni mover una parte sin decir a
                    dónde va. El servidor pone las mismas reglas. */}
                <Button variant="primary" loading={guardando}
                    icon={nEfectivo > 0 && nMonto <= 0 ? HandCoins : Landmark}
                    disabled={noAlcanza || faltaNota || faltaBanco || faltaQuien}
                    onClick={cerrar}>
                    Cerrar el efectivo
                </Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
