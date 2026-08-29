import { useCallback, useState } from 'react';
import {
    cerrarBolsa, fetchChequesDeBolsa, fetchOperacionDeBolsa, fetchSalidasDeBolsa,
    marcarEtiquetaImpresa, marcarValeImpreso,
} from '../data/bolsas';
import { mensajeAmigable } from '../utils/errorMessages';
import { useAuth } from '../context/AuthContext';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useToastStore } from '../store/toastStore';

/**
 * Cerrar la bolsa de un corte e imprimir su etiqueta — la ÚNICA escritura, para
 * todas las pantallas que la ofrezcan.
 *
 * Existe desde el primer día y no después de la tercera copia, que es la lección
 * de `useResolverCorte`: allá la misma escritura terminó copiada en el módulo,
 * la baldosa y el detalle, y juntarlas fue un trabajo aparte.
 *
 * ── `cerrar` es hoy la EXCEPCIÓN, no la rutina ─────────────────────────────
 * Desde el 2026-08-15 la bolsa nace sola al confirmar el corte (decisión del
 * usuario; un disparador la crea). Esta función quedó para el caso que el
 * disparador no cubre: un corte confirmado antes de que existiera el circuito, o
 * uno cuya bolsa se anuló. La pantalla lo nombra así —«Sin bolsa», no «Guardar
 * en bolsa»— porque es un problema, no una tarea.
 *
 * ── El monto lo calcula el servidor ────────────────────────────────────────
 * `sugerida` es lo que la pantalla mostró; el servidor recalcula el suyo y
 * rechaza si no coinciden (por ejemplo si otra persona embolsó el corte anterior
 * mientras esta pantalla estaba abierta). Es la cifra que después se le reclama
 * a alguien: no la puede elegir el navegador.
 */
export default function useCerrarBolsa({ nombreSala = {}, origen = 'inicio' } = {}) {
    const { user } = useAuth();
    const appendAuditLog = useStaff((s) => s.appendAuditLog);
    const showToast = useToastStore((s) => s.showToast);
    const [ocupadoId, setOcupadoId] = useState(null);

    /** Lo que salió de la bolsa, en la forma que la etiqueta necesita. */
    const salidasDeLaEtiqueta = useCallback(async (bolsaId) => {
        const [filas, { salidasParaEtiqueta }] = await Promise.all([
            fetchSalidasDeBolsa(bolsaId),
            import('../utils/bolsaComprobante'),
        ]);
        return salidasParaEtiqueta(filas);
    }, []);

    /**
     * Imprime la etiqueta de una bolsa que ya existe.
     *
     * Primero sube el número y después imprime, no al revés: si el papel falla
     * se pierde un número, que es preferible a que salgan dos etiquetas con el
     * mismo — sobre la mesa se ven iguales y no habría forma de saber cuál vale.
     *
     * El motor de impresión se baja al apretar el botón (`await import`): son
     * ~13 kB que nadie tiene que descargar para entrar al Inicio.
     *
     * ── Las salidas las trae ESTA función, no cada botón ────────────────────
     * `construirEtiquetaDeBolsa` calcula el efectivo como `monto_inicial menos
     * lo que salió`: sin la lista, imprime el monto guardado sobre una bolsa
     * que ya no lo tiene. Era opcional y de los dos botones de reimprimir uno
     * la pasaba y el otro no, así que la pestaña de Cortes sacó el 17-ago una
     * etiqueta que decía $488.12 sobre una bolsa con $188.12 adentro — el
     * número que administración compara al contar. Un dato que la etiqueta
     * NECESITA no puede depender de que el llamador se acuerde: se pasa `[]`
     * explícito para decir «ya sé que no hay», y no pasar nada significa
     * «averigualo».
     */
    const imprimir = useCallback(async (bolsa, { salidas = null, cerradaPor = null } = {}) => {
        if (!bolsa) return false;

        // `bolsa.salidas` viene de `get_bolsas_saldos` y es cuántas tiene. Si
        // dice 0 no hay nada que traer; si no viene, se pregunta — la falla
        // segura es el viaje de más, nunca la etiqueta que miente.
        let lista = salidas;
        if (lista == null) {
            lista = Number(bolsa.salidas) === 0 && bolsa.salidas != null
                ? []
                : await salidasDeLaEtiqueta(bolsa.id);
        }

        // Los cheques se preguntan SIEMPRE y no se reciben como parámetro. No
        // hay ningún dato en la fila que permita descartarlos —al revés que las
        // salidas, que traen su cuenta— y una etiqueta que no nombra el cheque
        // que va adentro es exactamente el papel mudo que esto vino a arreglar.
        // Es un viaje de ~1 ms contra una bolsa que se imprime una vez.
        const cheques = await fetchChequesDeBolsa(bolsa.id);

        const { data: version, error } = await marcarEtiquetaImpresa(bolsa.id);
        if (error) {
            showToast?.('No se pudo imprimir', mensajeAmigable(error, 'Vuelve a intentar en un momento.'), 'error');
            return false;
        }

        const [{ imprimirDocumento }, { construirEtiquetaDeBolsa }] = await Promise.all([
            import('../utils/ticketPrint'),
            import('../utils/bolsaComprobante'),
        ]);

        const r = await imprimirDocumento(construirEtiquetaDeBolsa({
            bolsa,
            sala: nombreSala[bolsa.branch_id] || '',
            salidas: lista,
            cerradaPor: cerradaPor || user?.name || user?.nombre || '',
            version: version ?? (bolsa.etiqueta_version || 0) + 1,
            impresaAt: new Date().toISOString(),
            cheques,
        }), { sala: bolsa.branch_id });

        // `ok` significa RECIBIDO, nunca «salió papel»: la respuesta del programa
        // de la caja es opaca por construcción. Decir «impresa» sería prometer
        // algo que no se sabe.
        showToast?.(
            r.ok ? 'Etiqueta enviada' : 'No se pudo imprimir',
            r.ok ? `${bolsa.folio} · pegala en la bolsa` : r.detalle,
            r.ok ? 'success' : 'error',
        );
        return r.ok;
    }, [showToast, nombreSala, user, salidasDeLaEtiqueta]);

    /**
     * EL VALE de una salida — **uno por operación**, aunque el dinero haya
     * salido de cuatro bolsas.
     *
     * Se imprime junto con las etiquetas y no en lugar de ellas: son papeles con
     * trabajos distintos. El vale respalda la salida entera y lo firma quien se
     * llevó el efectivo; cada etiqueta va pegada afuera de SU bolsa y dice
     * cuánto le queda —y dejó de ser cierta en el momento en que salió la plata.
     *
     * ── Por qué UNO y no uno por bolsa (2026-08-28) ─────────────────────────
     * Corregido por el usuario mirando los cuatro que salieron de CMB-1032:
     * «los vales y demás se guardan aparte. así que puede ser solo 1. eso sí,
     * debe especificar de dónde y cuánto salió». Cuando el papel se archiva en
     * vez de viajar dentro de la bolsa, cuatro casi iguales son cuatro salidas
     * aparentes de una operación sola — y el faltante de cada bolsa ya lo
     * explica su etiqueta, que sigue siendo una por bolsa.
     *
     * Las líneas las trae el SERVIDOR (`get_operacion_de_bolsa`) y no la
     * pantalla: quien llama acaba de mover el saldo, así que su copia en memoria
     * es la de antes del cambio. Es el mismo motivo por el que
     * `reimprimirEtiqueta` vuelve a pedir las salidas.
     *
     * `salaId` viaja aparte y no dentro de la operación porque es para elegir la
     * TICKETERA, no para el papel: la caja a la que se manda el documento.
     */
    const imprimirValeDeOperacion = useCallback(async (operacionId, salaId) => {
        if (!operacionId) return false;
        const [oper, { imprimirDocumento }, { construirValeDeSalida }] = await Promise.all([
            fetchOperacionDeBolsa(operacionId),
            import('../utils/ticketPrint'),
            import('../utils/bolsaComprobante'),
        ]);
        // Sin la operación no hay con qué armar el papel. Se AVISA en vez de
        // seguir de largo: la salida ya está escrita, y callado nadie se entera
        // hasta que falte el comprobante en el archivo.
        if (!oper) {
            showToast?.('Falta el vale',
                'No se pudo traer esa salida. Reimprimilo desde el detalle de la bolsa.', 'error');
            return false;
        }

        const vivas = (oper.lineas || []).filter((l) => !l.anulado_at);

        const r = await imprimirDocumento(construirValeDeSalida({
            operacion: {
                folio: oper.folio,
                motivo: oper.etiqueta,
                entidad: oper.entidad,
                entidadEtiqueta: oper.etiqueta_entidad,
                numero_boleta: oper.numero_boleta,
                monto: oper.monto,
                nota: oper.nota,
                // Lo que hay que saber de ESE motivo. Sin esto, un vale de
                // $2,000 por cambio de monedas se lee como dinero que salió de
                // la empresa.
                leyenda: oper.leyenda,
            },
            lineas: vivas,
            sala: oper.sala || '',
            registradoPor: oper.registrado_nombre,
            recibidoPor: oper.recibido_nombre
                ? { nombre: oper.recibido_nombre, metodo: oper.recibido_metodo }
                : null,
            registradoAt: oper.registrado_at,
        }), { sala: salaId });

        // Constancia de que se mandó a imprimir. Como con la etiqueta, `ok`
        // significa RECIBIDO y no «salió papel», así que se puede reimprimir.
        // Se marcan TODAS las líneas: el papel que salió las cubre a las cuatro,
        // y dejar tres sin marcar diría que su vale nunca se imprimió.
        if (r.ok) await Promise.all(vivas.map((l) => marcarValeImpreso(l.movimiento_id)));

        showToast?.(
            r.ok ? 'Vale enviado' : 'No se pudo imprimir el vale',
            r.ok ? `${oper.folio} · archivalo con los comprobantes` : r.detalle,
            r.ok ? 'success' : 'error',
        );
        return r.ok;
    }, [showToast]);

    /**
     * La etiqueta al día, cuando el saldo de la bolsa cambió.
     *
     * Las salidas las vuelve a pedir al servidor SIEMPRE: quien la llama acaba
     * de mover el saldo, así que su copia en memoria es justamente la de antes
     * del cambio. Una etiqueta impresa con la lista vieja sale con el mismo
     * número equivocado que se estaba corrigiendo.
     *
     * Que no salga el papel no deshace lo que ya se escribió, así que avisa y
     * sigue. El aviso importa: sin él queda pegada afuera una etiqueta que dice
     * un efectivo que no es, y ese es el número contra el que administración
     * cuenta.
     */
    const reimprimirEtiqueta = useCallback(async (bolsa, cerradaPor = null) => {
        if (!bolsa) return false;
        try {
            return await imprimir(bolsa, {
                cerradaPor,
                salidas: await salidasDeLaEtiqueta(bolsa.id),
            });
        } catch (e) {
            console.error('bolsas: la etiqueta nueva no se pudo imprimir:', e?.message);
            showToast?.('Falta la etiqueta nueva',
                `${bolsa.folio} - la de afuera dice un monto que ya no es. Reimprimila.`, 'error');
            return false;
        }
    }, [imprimir, salidasDeLaEtiqueta, showToast]);

    /**
     * **Los papeles de una salida: UN vale y una etiqueta por bolsa.**
     *
     * Vive acá y no en cada pantalla porque estaba escrito dos veces —la
     * baldosa del Inicio y la pestaña de Cortes— y las dos hacían lo mismo con
     * diferencias de una línea. Es la lección de `useResolverCorte` otra vez:
     * dos copias de una regla son dos reglas, y la que se rompa lo va a hacer
     * en la sala, sobre una bolsa con el número equivocado pegado encima.
     *
     * ── La cuenta de papeles cambió el 2026-08-28 ───────────────────────────
     * Eran dos por bolsa: con cuatro bolsas salían ocho. Hoy es **uno más una
     * por bolsa** —cinco— porque el vale pasó a ser de la operación entera:
     * «los vales y demás se guardan aparte. así que puede ser solo 1. eso sí,
     * debe especificar de dónde y cuánto salió» (usuario). Las etiquetas siguen
     * siendo una por bolsa y ahí no había nada que juntar: cada una dice el
     * saldo de SU bolsa, que es un número distinto en cada papel.
     *
     * **Cada papel va en su propio intento.** Encadenados —que es como estaban—
     * un fallo del vale se llevaba la etiqueta con él: `onHecho` corre dentro
     * del `try` del modal, así que la excepción moría allá arriba mostrando
     * «no se pudo registrar» sobre una salida que SÍ se registró, y la etiqueta
     * nueva no se imprimía nunca. La bolsa quedaba con la etiqueta vieja, que
     * dice un monto que ya no tiene.
     *
     * El orden es el del mostrador: primero el vale —que alguien está
     * esperando para firmar— y después las etiquetas que se pegan afuera.
     *
     * @param operacion la fila que devolvió `registrarSalida` (trae `id`)
     * @param repartos  [{ bolsa_id, monto }] tal como los devuelve `registrarSalida`
     * @param bolsas    las filas que la pantalla ya tiene en memoria
     * @param nombrePersona  Map de empleado → nombre, para el «Guardo» de la etiqueta
     */
    const imprimirTrasLaSalida = useCallback(async (operacion, repartos, bolsas = [], nombrePersona) => {
        const filas = (repartos || [])
            .map((r) => ({ r, bolsa: bolsas.find((b) => b.id === r.bolsa_id) }));

        // Sin la fila no hay con qué armar la etiqueta. Se AVISA en vez de
        // seguir de largo: callado, la salida queda escrita, no sale nada y
        // nadie se entera hasta que administración cuenta la bolsa.
        if (filas.some(({ bolsa }) => !bolsa)) {
            showToast?.('Faltan los papeles',
                'El vale y la etiqueta se imprimen desde el detalle de la bolsa.', 'error');
        }

        // El fallo se DICE. Hasta el 21-ago-2026 esto era un `console.error` y
        // nada más: el vale no salía, la salida quedaba escrita y quien la
        // registró no tenía forma de enterarse hasta que faltara el comprobante.
        if (operacion?.id) {
            try {
                await imprimirValeDeOperacion(operacion.id, filas[0]?.bolsa?.branch_id);
            } catch (e) {
                console.error('bolsas: el vale no se pudo imprimir:', e?.message);
                showToast?.('Falta el vale',
                    `${operacion.folio || 'La salida'} - imprimilo desde el detalle de la bolsa.`,
                    'error');
            }
        }

        for (const { bolsa } of filas) {
            if (!bolsa) continue;
            await reimprimirEtiqueta(bolsa, nombrePersona?.get?.(bolsa.cerrada_por));
        }
    }, [imprimirValeDeOperacion, reimprimirEtiqueta, showToast]);

    /**
     * Cierra la bolsa del corte y manda la etiqueta a imprimir.
     *
     * @param corte  fila de `get_cortes_por_embolsar` (trae `corte_id` y `sugerida`)
     * @returns la bolsa creada, o null
     */
    const cerrar = useCallback(async (corte) => {
        if (!corte || ocupadoId) return null;
        setOcupadoId(corte.corte_id);
        const { data, error } = await cerrarBolsa(corte.corte_id, corte.sugerida);
        setOcupadoId(null);

        if (error) {
            showToast?.('No se pudo guardar', mensajeAmigable(error, 'Vuelve a intentar en un momento.'), 'error');
            return null;
        }

        const sala = nombreSala[data.branch_id] || '';
        appendAuditLog?.('BOLSA_CERRADA', user?.id, {
            bolsa_id: data.id,
            folio: data.folio,
            corte_id: corte.corte_id,
            sucursal: sala,
            monto: data.monto_inicial,
            origen,
        });

        await imprimir(data);
        return data;
    }, [ocupadoId, showToast, appendAuditLog, user, nombreSala, origen, imprimir]);

    return { cerrar, imprimir, imprimirValeDeOperacion, imprimirTrasLaSalida, reimprimirEtiqueta, ocupadoId };
}
