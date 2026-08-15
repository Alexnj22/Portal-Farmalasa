import { useCallback, useState } from 'react';
import { cerrarBolsa, marcarEtiquetaImpresa, marcarValeImpreso } from '../data/bolsas';
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

    /**
     * Imprime la etiqueta de una bolsa que ya existe.
     *
     * Primero sube el número y después imprime, no al revés: si el papel falla
     * se pierde un número, que es preferible a que salgan dos etiquetas con el
     * mismo — sobre la mesa se ven iguales y no habría forma de saber cuál vale.
     *
     * El motor de impresión se baja al apretar el botón (`await import`): son
     * ~13 kB que nadie tiene que descargar para entrar al Inicio.
     */
    const imprimir = useCallback(async (bolsa, { salidas = [], cerradaPor = null } = {}) => {
        if (!bolsa) return false;
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
            salidas,
            cerradaPor: cerradaPor || user?.name || user?.nombre || '',
            version: version ?? (bolsa.etiqueta_version || 0) + 1,
            impresaAt: new Date().toISOString(),
        }));

        // `ok` significa RECIBIDO, nunca «salió papel»: la respuesta del programa
        // de la caja es opaca por construcción. Decir «impresa» sería prometer
        // algo que no se sabe.
        showToast?.(
            r.ok ? 'Etiqueta enviada' : 'No se pudo imprimir',
            r.ok ? `${bolsa.folio} · pegala en la bolsa` : r.detalle,
            r.ok ? 'success' : 'error',
        );
        return r.ok;
    }, [showToast, nombreSala, user]);

    /**
     * El vale que queda DENTRO de la bolsa cuando sale dinero.
     *
     * Se imprime junto con la etiqueta nueva y no en lugar de ella: son dos
     * papeles con dos trabajos. El vale respalda la salida y lo firma quien se
     * llevó el efectivo; la etiqueta va pegada afuera y dice cuánto queda —y
     * dejó de ser cierta en el momento en que salió la plata.
     */
    const imprimirVale = useCallback(async (mov, bolsa, saldoDespues) => {
        if (!mov || !bolsa) return false;
        const [{ imprimirDocumento }, { construirValeDeSalida }] = await Promise.all([
            import('../utils/ticketPrint'),
            import('../utils/bolsaComprobante'),
        ]);

        const r = await imprimirDocumento(construirValeDeSalida({
            vale: { folio: mov.vale_folio, monto: mov.monto, saldo_despues: saldoDespues },
            operacion: {
                folio: mov.operacion_folio,
                motivo: mov.etiqueta,
                banco: mov.entidad,
                numero_boleta: mov.numero_boleta,
                monto: mov.monto_operacion,
                nota: mov.nota,
            },
            bolsa,
            sala: nombreSala[bolsa.branch_id] || '',
            registradoPor: mov.registrado_nombre,
            recibidoPor: mov.recibido_nombre
                ? { nombre: mov.recibido_nombre, metodo: mov.recibido_metodo }
                : null,
            registradoAt: mov.registrado_at,
        }));

        // Constancia de que se mandó a imprimir. Como con la etiqueta, `ok`
        // significa RECIBIDO y no «salió papel», así que se puede reimprimir.
        if (r.ok) await marcarValeImpreso(mov.movimiento_id);

        showToast?.(
            r.ok ? 'Vale enviado' : 'No se pudo imprimir el vale',
            r.ok ? `${mov.vale_folio} · dejalo dentro de la bolsa` : r.detalle,
            r.ok ? 'success' : 'error',
        );
        return r.ok;
    }, [showToast, nombreSala]);

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

    return { cerrar, imprimir, imprimirVale, ocupadoId };
}
