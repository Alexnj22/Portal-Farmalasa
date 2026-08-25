import { useCallback, useEffect, useState } from 'react';
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

    // ── El motor de impresión se baja ANTES de escribir ─────────────────────
    //
    // Los dos módulos que arman la etiqueta viajan en su propio chunk, y eso los
    // ata al despliegue que tenía la pestaña cuando se abrió. Tras publicar una
    // versión, el archivo con el hash viejo ya no existe: el `import()` devuelve
    // el `index.html` del portal, tira, y el bloque de impresión de abajo muere
    // en su `catch` — el corte queda confirmado, la bolsa creada y la etiqueta
    // nunca sale.
    //
    // No es hipotético. Los TRES cortes que se confirmaron sin etiqueta cayeron
    // dentro de los tres minutos siguientes a un despliegue: S3-1126 (24-ago
    // 21:17, despliegues 21:15 y 21:20), S5-1113 (24-ago 12:26, despliegues
    // 12:24 y 12:29) y S2-1065 (20-ago 12:00, despliegue 11:57). En los tres la
    // etiqueta la terminó mandando otra persona minutos después, a mano.
    //
    // Bajarlo al montar no evita el chunk muerto —eso no se puede desde acá—:
    // lo adelanta a un momento en que recargar no cuesta nada, y deja el módulo
    // en memoria para cuando se apriete confirmar. Va ACÁ y no en las cuatro
    // pantallas que confirman por la misma razón que la escritura: una quinta
    // pantalla nueva se olvidaría de pedirlo, y el modo de falla es mudo.
    useEffect(() => {
        import('../utils/ticketPrint').catch(() => {});
        import('../utils/bolsaComprobante').catch(() => {});
    }, []);

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
            // Que no salga el papel no puede deshacer una confirmación ya
            // guardada —el dinero es lo que importa— pero SÍ tiene que decirlo.
            // Hasta hoy los tres caminos de fallo eran mudos: la bolsa que no se
            // pudo leer, el `catch`, y un `r.ok` sin `else`. Una etiqueta que no
            // sale y no avisa es una bolsa que llega a administración sin nada
            // escrito encima, que es el problema entero que esto vino a
            // resolver. El aviso dura más que los otros a propósito: quien
            // confirma ya está mirando otra cosa.
            const avisar = (detalle, folio = '') => showToast?.(
                'La etiqueta no salió',
                `${folio ? `${folio} · ` : ''}${detalle} Imprímela desde Bolsas.`,
                'error', 9000,
            );
            try {
                const { bolsa, error: errorBolsa } = await fetchBolsaDeCorte(corte.id);
                if (errorBolsa) {
                    avisar('No se pudo leer la bolsa de este corte.');
                } else if (bolsa) {
                    const [{ imprimirDocumento }, { construirEtiquetaDeBolsa }, { marcarEtiquetaImpresa }] =
                        await Promise.all([
                            import('../utils/ticketPrint'),
                            import('../utils/bolsaComprobante'),
                            import('../data/bolsas'),
                        ]);
                    const r = await imprimirDocumento(construirEtiquetaDeBolsa({
                        bolsa,
                        sala,
                        salidas: [],
                        cerradaPor: user?.name || '',
                        // El número que va impreso se calcula acá y la constancia
                        // se escribe DESPUÉS de mandarlo, no antes. Al revés
                        // —como estaba— un envío que fallaba dejaba la bolsa con
                        // `etiqueta_impresa_at` puesto: el papel no existía y la
                        // pantalla ya no mostraba «Sin etiqueta», que es la única
                        // señal que sobrevive al toast. Marcar primero borraba
                        // justo la evidencia del fallo.
                        version: (bolsa.etiqueta_version || 0) + 1,
                        impresaAt: new Date().toISOString(),
                    }), { soloDirecta: true, sala: corte.branch_id });
                    if (r.ok) {
                        await marcarEtiquetaImpresa(bolsa.id);
                        showToast?.('Etiqueta enviada', `${bolsa.folio} · pégala en la bolsa`, 'success');
                    } else {
                        console.error('cortes: la etiqueta no se pudo mandar:', r.detalle);
                        avisar('La caja no la recibió.', bolsa.folio);
                    }
                }
            } catch (err) {
                console.error('cortes: no se pudo imprimir la etiqueta de la bolsa:', err?.message);
                avisar('No se pudo preparar el papel.');
            }
        }
        return true;
    }, [ocupadoId, showToast, appendAuditLog, user, nombreSala, origen]);

    return { resolver, ocupadoId };
}
