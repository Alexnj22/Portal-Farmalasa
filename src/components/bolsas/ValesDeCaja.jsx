import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Landmark } from 'lucide-react';
import Button from '../common/Button';
import LiquidModal from '../common/LiquidModal';
import Notice from '../common/Notice';
import { anotarValesEnCaja, fetchValesPendientes } from '../../data/bolsas';
import { formatMoney } from '../../utils/formatNumber';
import { mensajeAmigable } from '../../utils/errorMessages';
import { useAuth } from '../../context/AuthContext';
import { useToastStore } from '../../store/toastStore';

/**
 * Lo que falta anotarle a la caja, y el botón que lo anota.
 *
 * ── Por qué existe ─────────────────────────────────────────────────────────
 * La caja cuenta, por día, todo lo que entró desde su cierre anterior, y meter
 * el dinero en una bolsa no le avisa nada: la plata de las bolsas DE HOY sigue
 * siendo caja para ella. Cuando una remesa se paga con esa plata, la caja
 * queda esperando dinero que ya salió, y el corte siguiente marca un faltante
 * que no existe. Medido: cinco salidas quedaron así, $1,700 en total.
 *
 * ── Lo que NO aparece acá, y es la mitad de la regla ───────────────────────
 * Lo que salió de una bolsa de un día ya cerrado. Esa plata la caja no la
 * cuenta, así que anotarla inventaría un SOBRANTE — pasó el 22-ago: +$454.00
 * que taparon con un ingreso falso. La lista la arma la base
 * (`caja_vales_pendientes`), no esta pantalla.
 *
 * ── Se ve poco a propósito ─────────────────────────────────────────────────
 * El módulo `caja_vales` hoy lo tiene un solo cargo. Escribir en la caja corre
 * lo que el corte espera, así que no puede viajar de arrastre con el permiso de
 * guardar una bolsa. Y esconder el botón es comodidad, no candado: el permiso
 * lo vuelve a comprobar el servidor.
 */
export default function ValesDeCaja() {
    const { hasPermission } = useAuth();
    const showToast = useToastStore((s) => s.showToast);
    const puedeVer = hasPermission('caja_vales', 'can_view');
    const puedeAnotar = hasPermission('caja_vales', 'can_edit');

    const [pendientes, setPendientes] = useState([]);
    const [abierto, setAbierto] = useState(false);
    const [simulacion, setSimulacion] = useState(null);
    const [ocupado, setOcupado] = useState(false);

    const cargar = useCallback(async () => {
        if (!puedeVer) return;
        const { filas } = await fetchValesPendientes();
        setPendientes(filas);
    }, [puedeVer]);

    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial

    const total = useMemo(
        () => pendientes.reduce((s, p) => s + Number(p.monto || 0), 0),
        [pendientes],
    );

    /* ── El aviso tiene que decir DÓNDE ────────────────────────────────────
     *
     * Reportado por el usuario (2-sep): «Faltan anotarle a la caja 2 salidas
     * por $127.00 — ¿qué es eso? ¿de qué sucursal? no entiendo». Eran dos de
     * Salud 3, y ni el aviso ni la lista de «Ver cuáles» lo decían.
     *
     * No es un olvido de redacción: este aviso vive FUERA del filtro de
     * sucursal de la vista a propósito —es trabajo pendiente, y esconderlo
     * detrás de un recorte sería no anunciarlo—, así que la sala tampoco se
     * puede deducir de la pantalla. Sin el nombre, el aviso dice que hay algo
     * que hacer y no dónde, que es lo mismo que no decir nada.
     *
     * El nombre viene en la fila (`caja_vales_pendientes` lo trae de
     * `branches`) y no se cruza acá contra el store: el mismo dato lo usa la
     * simulación, que lo recibe de la edge function. Un solo origen. */
    const salas = useMemo(() => {
        const vistas = [];
        for (const p of pendientes) if (p.sala && !vistas.includes(p.sala)) vistas.push(p.sala);
        return vistas;
    }, [pendientes]);

    /* «Salud 3», «Salud 3 y La Popular», «Salud 3, La Popular y Salud 1». Se
     * nombran TODAS y no «3 salas»: son a lo sumo siete, y el número obliga a
     * abrir el diálogo para saber si a uno le toca.
     *
     * `null` cuando no se pudo resolver ninguna, y ahí el aviso sale sin el
     * rótulo en vez de con un hueco: un «de undefined» no es más informativo
     * que la frase vieja, y este aviso no puede dejar de salir. */
    const donde = salas.length
        ? salas.slice(0, -1).join(', ') + (salas.length > 1 ? ` y ${salas[salas.length - 1]}` : salas[0])
        : null;

    /* Agrupada por sala, para que la lista se lea como el aviso. Se recorren
     * las FILAS y no `salas`: agrupando por la lista de nombres, una fila sin
     * nombre desaparecería del diálogo mientras sigue sumando en el total del
     * aviso — un resumen que no cuenta todo dice «sin novedad» sobre algo que
     * sí está. Sin nombre va a su propio grupo, sin rótulo. */
    const porSala = useMemo(() => {
        const grupos = new Map();
        for (const p of pendientes) {
            const k = p.sala || '';
            if (!grupos.has(k)) grupos.set(k, []);
            grupos.get(k).push(p);
        }
        return [...grupos].map(([sala, filas]) => ({ sala, filas }));
    }, [pendientes]);

    if (!puedeVer || pendientes.length === 0) return null;

    const simular = async () => {
        setOcupado(true);
        const r = await anotarValesEnCaja({ simular: true });
        setOcupado(false);
        if (r.error) { showToast(mensajeAmigable(r.error), 'error'); return; }
        setSimulacion(r.resultados || []);
    };

    const anotar = async () => {
        setOcupado(true);
        const r = await anotarValesEnCaja({});
        setOcupado(false);
        if (r.error) { showToast(mensajeAmigable(r.error), 'error'); return; }
        const fallaron = (r.resultados || []).filter((x) => x.error);
        if (fallaron.length) {
            // Se dice cuántas entraron Y cuántas no: «se anotó» a secas sobre
            // una corrida a medias es el aviso que hace que nadie vuelva a
            // mirar. Lo que no entró sigue en la lista.
            showToast(
                `Se anotaron ${(r.resultados.length - fallaron.length)} de ${r.resultados.length}. `
                + `Revisa las que fallaron: ${fallaron[0].error}`,
                'warning',
            );
        } else {
            showToast('Anotado en la caja.', 'success');
        }
        setSimulacion(null);
        setAbierto(false);
        cargar();
    };

    return (
        <>
            <Notice variant="warning" icon={Landmark}>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                        {/* La sala PRIMERO. Es lo que se busca al leerlo —«¿me
                            toca a mí?»— y además evita el «de Salud 3 2
                            salidas», donde dos números pegados se leen como uno.
                            Es la misma forma que el aviso de un corte nuevo:
                            «<sala> — <lo que hay que hacer>». */}
                        <span className="font-bold">
                            {donde && <span>{donde} — </span>}
                            {pendientes.length === 1
                                ? `${donde ? 'falta' : 'Falta'} anotarle a la caja una salida de ${formatMoney(total)}`
                                : `${donde ? 'faltan' : 'Faltan'} anotarle a la caja ${pendientes.length} salidas por ${formatMoney(total)}`}
                        </span>
                        <span className="block mt-0.5 font-normal text-content-2">
                            Salió de una bolsa del día que la caja tiene abierto, así que sigue
                            esperando ese dinero. Sin anotarlo, el próximo corte marca un faltante
                            que no existe.
                        </span>
                    </div>
                    <Button variant="secondary" size="sm" onClick={() => setAbierto(true)}>
                        Ver cuáles
                    </Button>
                </div>
            </Notice>

            <LiquidModal open={abierto} onClose={() => { setAbierto(false); setSimulacion(null); }}
                maxWidth="max-w-lg" ariaLabel="Salidas por anotar en la caja">
                <div className="p-5 space-y-4">
                    <div>
                        <h3 className="text-h3 font-bold text-content">Falta anotarle a la caja</h3>
                        <p className="text-body-sm text-content-2 mt-1">
                            Un solo <b>vale de caja</b> por sala. El vale de papel y la etiqueta de
                            cada bolsa ya salieron al sacar el dinero: esto es el movimiento que
                            le falta al sistema.
                        </p>
                    </div>

                    {/* Agrupada por sala: el vale se escribe por sala, así que
                        la lista tiene que dejar ver de una qué le toca a cada
                        una. Con las salidas sueltas, «2 salidas por $127.00»
                        no decía si eran de la misma caja o de dos. */}
                    <div className="space-y-3">
                        {porSala.map(({ sala, filas }) => (
                            <div key={sala}>
                                <div className="flex items-baseline justify-between gap-3">
                                    <span className="text-caption font-black uppercase tracking-widest text-content-2">
                                        {sala}
                                    </span>
                                    <span className="tabular-nums text-caption font-bold text-content-2">
                                        {formatMoney(filas.reduce((s, f) => s + Number(f.monto || 0), 0))}
                                    </span>
                                </div>
                                <ul className="space-y-1.5 mt-1">
                                    {filas.map((p) => (
                                        <li key={p.movimiento_id}
                                            className="flex items-center justify-between gap-3 text-body-sm">
                                            <span className="text-content truncate">{p.folio}</span>
                                            <span className="tabular-nums font-bold text-content">
                                                {formatMoney(p.monto)}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>

                    {simulacion && (
                        <div className="space-y-1.5 rounded-xl p-3" data-surface="card">
                            <p className="text-caption font-black uppercase tracking-widest text-content-2">
                                Lo que se va a escribir
                            </p>
                            {/* El NOMBRE de la sala, no su número. Decía
                                «Sala 5», que es el identificador de la fila —
                                nadie en sala sabe qué sucursal es ésa. */}
                            {simulacion.map((s, i) => (
                                <p key={i} className="text-body-sm text-content-2">
                                    {s.error
                                        ? `${s.sala}: ${s.error}`
                                        : `${s.sala} · ${s.accion === 'crear' ? 'un vale de caja nuevo' : 'sumar al vale de caja abierto'} · ${formatMoney(s.monto_del_vale)}`}
                                </p>
                            ))}
                        </div>
                    )}

                    <div className="flex justify-end gap-2 flex-wrap">
                        <Button variant="ghost" onClick={() => { setAbierto(false); setSimulacion(null); }}>
                            Cerrar
                        </Button>
                        <Button variant="secondary" onClick={simular} disabled={ocupado}>
                            Ver qué haría
                        </Button>
                        {puedeAnotar && (
                            <Button variant="primary" onClick={anotar} disabled={ocupado}>
                                Anotar en la caja
                            </Button>
                        )}
                    </div>
                </div>
            </LiquidModal>
        </>
    );
}
