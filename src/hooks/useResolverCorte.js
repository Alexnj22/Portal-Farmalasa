import { useCallback, useState } from 'react';
import { resolverCorte } from '../data/cortes';
import { fetchBolsaDeCorte } from '../data/bolsas';
import { mensajeAmigable } from '../utils/errorMessages';
import { useAuth } from '../context/AuthContext';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useToastStore } from '../store/toastStore';

/**
 * Confirmar o descartar un corte — la ÚNICA escritura, para las cuatro
 * pantallas que la ofrecen: el módulo, la baldosa del Inicio, el detalle y la
 * campana.
 *
 * Existe por la misma razón que `useDecidirSolicitud`: el módulo y la baldosa
 * ya tenían **la misma función copiada** —`confirmarRapido`, idéntica salvo el
 * `origen` y a quién avisarle que recargue— y el detalle una tercera versión
 * con motivo y observación. Agregarle el cuarto camino desde la campana sin
 * juntarlas primero era garantizar que alguna se quedara atrás: el día que
 * cambie qué se escribe en la bitácora, o qué dice el aviso de error, hay que
 * poder cambiarlo en un solo sitio.
 *
 * Lo que NO decide es CUÁNDO se confirma de un clic y cuándo hay que abrir el
 * detalle — eso vive en `TarjetaCorte` (`seConfirmaDeUnClic`), que es la regla
 * de pantalla. Acá sólo se escribe.
 *
 * Devuelve `true` si quedó guardado, para que el llamador decida qué hacer
 * después (recargar su lista, cerrar su diálogo, apagar su aviso).
 */
export default function useResolverCorte({ nombreSala = {}, origen = 'modulo' } = {}) {
    const { user } = useAuth();
    const appendAuditLog = useStaff((s) => s.appendAuditLog);
    const showToast = useToastStore((s) => s.showToast);
    const [ocupadoId, setOcupadoId] = useState(null);

    const resolver = useCallback(async (corte, estado, { motivo = null, observaciones = null } = {}) => {
        if (!corte || ocupadoId) return false;
        setOcupadoId(corte.id);
        const { error } = await resolverCorte(corte.id, estado, { motivo, observaciones });
        setOcupadoId(null);
        if (error) {
            showToast?.('No se pudo guardar', mensajeAmigable(error, 'Vuelve a intentar en un momento.'), 'error');
            return false;
        }
        const sala = nombreSala[corte.branch_id] || '';
        appendAuditLog?.(estado === 'CONFIRMADO' ? 'CORTE_CAJA_CONFIRMADO' : 'CORTE_CAJA_DESCARTADO', user?.id, {
            corte_id: corte.id,
            sucursal: sala,
            fecha: corte.fecha,
            hora: corte.hora,
            diferencia: corte.tramo,
            motivo: motivo || undefined,
            origen,
        });
        showToast?.(
            estado === 'CONFIRMADO' ? 'Corte confirmado' : 'Corte descartado',
            `${sala} · ${String(corte.hora || '').slice(0, 5)}`.trim(), 'success',
        );

        // ── La etiqueta de la bolsa sale acá, no en otra pantalla ───────────
        //
        // Al confirmar, un disparador crea la bolsa con el efectivo del tramo.
        // Hasta ahora nadie mandaba su etiqueta al rollo: había que ir a la
        // pestaña de bolsas y apretar imprimir, y la bolsa que se quedaba sin
        // etiqueta llegaba a administración sin nada que la identificara.
        //
        // Los dos parámetros dicen lo mismo desde dos lados: este papel sale
        // SOLO y tiene que salir DONDE ESTÁ LA BOLSA. Con `sala`, lo que no se
        // pueda imprimir en esta computadora se deja en la cola de esa
        // sucursal y lo saca el agente de su caja — que es lo único que
        // funciona cuando quien confirma lo hace desde el teléfono. Y
        // `soloDirecta` evita el último recurso: un diálogo de impresión que
        // nadie pidió, en una máquina que no es la caja.
        if (estado === 'CONFIRMADO') {
            try {
                const bolsa = await fetchBolsaDeCorte(corte.id);
                if (bolsa) {
                    const [{ imprimirDocumento }, { construirEtiquetaDeBolsa }, { marcarEtiquetaImpresa }] =
                        await Promise.all([
                            import('../utils/ticketPrint'),
                            import('../utils/bolsaComprobante'),
                            import('../data/bolsas'),
                        ]);
                    const { data: version } = await marcarEtiquetaImpresa(bolsa.id);
                    const r = await imprimirDocumento(construirEtiquetaDeBolsa({
                        bolsa,
                        sala,
                        salidas: [],
                        cerradaPor: user?.name || '',
                        version: version ?? (bolsa.etiqueta_version || 0) + 1,
                        impresaAt: new Date().toISOString(),
                    }), { soloDirecta: true, sala: corte.branch_id });
                    if (r.ok) {
                        showToast?.('Etiqueta enviada', `${bolsa.folio} · pégala en la bolsa`, 'success');
                    }
                }
            } catch (err) {
                // Que no salga el papel no puede deshacer una confirmación ya
                // guardada: el dinero es lo que importa y la etiqueta se
                // reimprime desde la sala.
                console.error('cortes: no se pudo imprimir la etiqueta de la bolsa:', err?.message);
            }
        }
        return true;
    }, [ocupadoId, showToast, appendAuditLog, user, nombreSala, origen]);

    return { resolver, ocupadoId };
}
