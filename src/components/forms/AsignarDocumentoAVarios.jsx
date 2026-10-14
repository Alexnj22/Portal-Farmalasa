/**
 * «Este documento nombra a más gente. ¿Se lo pongo a todos?»
 *
 * ── Por qué es una pregunta y no una acción automática ──────────────────────
 *
 * El acuse del Ministerio nombra a varias personas y el portal ya sabe leer esa
 * lista. Podría asignarlo solo — y sería un error. Un documento en el
 * expediente equivocado es una prueba en el expediente equivocado: no se
 * deshace con un botón, se explica en una inspección. Y la lista la leyó un
 * modelo sobre una foto, que es exactamente el tipo de dato que hay que
 * confirmar antes de escribir.
 *
 * Así que el portal propone y la persona decide, con todo a la vista: qué
 * nombre leyó, contra qué ficha lo cruzó, y qué va a pasar con los que no
 * tienen ficha todavía.
 *
 * ── Los tres estados de una fila ────────────────────────────────────────────
 *
 *  · **Ya lo tiene** — es la ficha que está abierta. Se muestra apagada: no
 *    hay nada que decidir y esconderla haría dudar de lo que se acaba de hacer.
 *  · **Tiene ficha** — se le escribe ahora.
 *  · **Sin ficha todavía** — el documento queda esperando por su nombre y se le
 *    pega solo el día que alguien la cree. Ésta es la mitad que el usuario pidió
 *    con «al crearlos lo asigne de un solo».
 *
 * ── Cuando el nombre del papel no es el de la ficha ─────────────────────────
 *
 * El 2026-10-14 el acuse nombró a «RONALDO JAVIER RECINOS LOPEZ», su ficha
 * dice «RONALDO RECINOS», y el documento quedó esperando a una ficha que nunca
 * iba a nacer porque ya existía. Ahora, en esa fila:
 *
 *  · si una ficha tiene todas sus palabras en el nombre del papel, se PROPONE
 *    («¿Es RONALDO RECINOS?») y hay que confirmarla — nunca se asigna sola;
 *  · si no se confirma (o no hubo propuesta), un selector ofrece las fichas a
 *    las que todavía les falta ese documento. Pedido del usuario: «si no
 *    confirma que salga un selector de los que tienen pendiente de ese
 *    documento».
 *
 * Sin elegir nada, la fila sigue siendo «en espera», como antes.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Users, UserCheck, UserPlus, Check, X, Loader2, AlertTriangle } from 'lucide-react';
import ModalShell from '../common/ModalShell';
import Button from '../common/Button';
import Notice from '../common/Notice';
import Badge from '../common/Badge';
import LiquidSelect from '../common/LiquidSelect';
import { cruzarConElPadron, asignarDocumentoA, dejarPendiente, fichasSinDocumento } from '@nucleo/data/documentosCompartidos';

/**
 * @param {string[]} nombres    los que leyó el documento
 * @param {object}   documento  la entrada de `employee_documents` ya subida
 * @param {string}   rotulo     cómo se llama el documento, para el texto
 * @param {Array}    empleados  el padrón cargado
 * @param {string}   [fichaAbierta] id de la ficha que se está editando
 * @param {Function} alCerrar
 * @param {Function} alTerminar recibe un resumen para el aviso
 */
export default function AsignarDocumentoAVarios({
    nombres, documento, rotulo, empleados, fichaAbierta, alCerrar, alTerminar,
}) {
    const filas = useMemo(
        () => cruzarConElPadron(nombres, empleados, fichaAbierta),
        [nombres, empleados, fichaAbierta]);

    /* Arrancan TODAS marcadas menos la que ya lo tiene: si el documento los
     * nombra, lo normal es que les corresponda. Desmarcar de a uno es menos
     * trabajo que marcar de a uno, y la decisión sigue siendo de quien mira. */
    const [marcados, setMarcados] = useState(
        () => new Set(filas.filter(f => !f.esLaAbierta).map(f => f.nombre)));
    const [guardando, setGuardando] = useState(false);
    const [fallo, setFallo] = useState(null);
    // nombre del papel → ficha que quien mira eligió (confirmando la propuesta
    // o en el selector). Lo que no está acá y no cruzó, queda en espera.
    const [elegidas, setElegidas] = useState(() => new Map());
    const [sinDocumento, setSinDocumento] = useState(null);   // null = cargando
    const [falloLista, setFalloLista] = useState(false);

    const hayQueElegir = filas.some(f => !f.empleado);
    useEffect(() => {
        if (!hayQueElegir || !documento?.category) return undefined;
        let vivo = true;
        fichasSinDocumento(documento.category)
            .then(lista => { if (vivo) setSinDocumento(lista); })
            .catch(() => { if (vivo) { setSinDocumento([]); setFalloLista(true); } });
        return () => { vivo = false; };
    }, [hayQueElegir, documento?.category]);

    const elegir = (nombre, ficha) => setElegidas(prev => {
        const m = new Map(prev);
        if (ficha) m.set(nombre, ficha); else m.delete(nombre);
        return m;
    });
    const fichaDe = (f) => f.empleado || elegidas.get(f.nombre) || null;

    const alternar = (nombre) => setMarcados(prev => {
        const s = new Set(prev);
        if (s.has(nombre)) s.delete(nombre); else s.add(nombre);
        return s;
    });

    const marcadas = filas.filter(f => marcados.has(f.nombre) && !f.esLaAbierta);
    const conFicha = marcadas.filter(f => fichaDe(f));
    const sinFicha = marcadas.filter(f => !fichaDe(f));

    const confirmar = async () => {
        setGuardando(true);
        setFallo(null);
        try {
            let asignados = 0;
            let omitidos = [];
            if (conFicha.length) {
                // Dos nombres del papel apuntando a la misma ficha se asignan una vez.
                const ids = [...new Set(conFicha.map(f => fichaDe(f).id))];
                const r = await asignarDocumentoA(ids, documento);
                if (r?.ok === false) throw new Error(r.motivo || 'No se pudo asignar.');
                asignados = (r?.asignados || []).length;
                omitidos = r?.omitidos || [];
            }
            let pendientes = 0;
            const sinDejar = [];
            for (const f of sinFicha) {
                const r = await dejarPendiente(f.nombre, documento);
                if (r?.ok) pendientes += 1; else sinDejar.push({ nombre: f.nombre, motivo: r?.motivo });
            }
            // Un pendiente que no se pudo dejar se DICE. Antes se descartaba y
            // el diálogo cerraba con «Documento repartido · Sin cambios» en
            // verde: así vivió roto el reparto desde el día uno (2026-10-13).
            // Reintentar es seguro: asignar no pisa y el pendiente no se duplica.
            if (sinDejar.length) {
                throw new Error(`No se pudo dejar en espera a ${sinDejar.map(x => x.nombre).join(', ')}`
                    + ` (${sinDejar[0].motivo || 'sin motivo'}).`);
            }
            alTerminar({ asignados, pendientes, omitidos });
        } catch (e) {
            // No se cierra: quien decidió tiene que poder reintentar sin volver
            // a subir el documento.
            const msg = e?.message || 'No se pudo asignar el documento.';
            setFallo(/FORBIDDEN/.test(msg)
                ? 'Hace falta permiso de edición en Personal para repartir el documento.'
                : msg);
        } finally {
            setGuardando(false);
        }
    };

    return (
        <ModalShell open onClose={guardando ? undefined : alCerrar} maxWidthClass="max-w-lg"
            ariaLabel="Asignar el documento a varias personas">
            <div className="flex flex-col max-h-[85dvh]">
                <div className="flex items-center gap-2 p-4 pb-3 border-b border-divider shrink-0">
                    <Users size={16} className="text-content-3 shrink-0" strokeWidth={2.5} />
                    <div className="min-w-0 flex-1">
                        <p className="text-body-sm font-bold text-content truncate">
                            El documento nombra a {filas.length} persona{filas.length === 1 ? '' : 's'}
                        </p>
                        <p className="text-micro text-content-3 font-medium truncate">{rotulo}</p>
                    </div>
                    <Button variant="ghost" size="sm" icon={X} iconOnly title="Cerrar"
                        onClick={alCerrar} disabled={guardando} />
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-2">
                    <p className="text-label text-content-2 font-medium leading-snug">
                        Es el mismo papel para todos. Marca a quiénes se les debe adjuntar —
                        el archivo no se duplica, las fichas comparten el mismo documento.
                    </p>

                    {filas.map((f) => {
                        const puesto = f.esLaAbierta;
                        const activo = marcados.has(f.nombre) && !puesto;
                        const elegida = elegidas.get(f.nombre) || null;
                        const ficha = f.empleado || elegida;
                        // Las fichas que otra fila ya eligió no se ofrecen otra vez.
                        const tomadas = new Set([...elegidas.entries()]
                            .filter(([n]) => n !== f.nombre).map(([, e]) => e.id));
                        const opciones = (sinDocumento || [])
                            .filter(e => e.id !== fichaAbierta && !tomadas.has(e.id))
                            .map(e => ({ value: e.id, label: e.name }));
                        const proponer = !f.empleado && !elegida && f.posible
                            && !tomadas.has(f.posible.id);
                        return (
                            <div key={f.nombre} data-surface="card"
                                className={`flex flex-col transition-all
                                            ${puesto ? 'opacity-60' : ''}
                                            ${activo ? 'ring-2 ring-brand/45' : ''}`}>
                                <button type="button"
                                    disabled={puesto || guardando}
                                    onClick={() => alternar(f.nombre)}
                                    className="p-3 flex items-center gap-3 text-left w-full
                                               min-h-[var(--tap-min)] active:scale-[0.99]">
                                    <span className={`w-9 h-9 rounded-btn shrink-0 flex items-center justify-center
                                                      ${ficha ? 'bg-success/12 border border-success/25'
                                                              : 'bg-warning/12 border border-warning/25'}`}>
                                        {ficha
                                            ? <UserCheck size={16} className="text-success" strokeWidth={2.5} />
                                            : <UserPlus size={16} className="text-warning" strokeWidth={2.5} />}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-label font-black text-content truncate">{f.nombre}</span>
                                        <span className="block text-micro text-content-3 font-medium truncate">
                                            {puesto ? 'Es la ficha que estás editando — ya lo tiene'
                                                : f.empleado ? `Tiene ficha: ${f.empleado.name}`
                                                    : elegida ? `Ficha elegida: ${elegida.name}`
                                                        : 'Sin ficha todavía — se le adjunta cuando la creen'}
                                        </span>
                                    </span>
                                    {/* La duda se dice, no se resuelve sola: dos fichas
                                        que se llaman igual no las distingue un nombre. */}
                                    {f.ambiguo && <Badge variant="warning" size="sm">Hay dos iguales</Badge>}
                                    {!puesto && (
                                        <span className={`w-5 h-5 rounded-md shrink-0 border-2 flex items-center justify-center
                                                          ${activo ? 'bg-brand border-brand' : 'border-border-card'}`}>
                                            {activo && <Check size={12} className="text-white" strokeWidth={3} />}
                                        </span>
                                    )}
                                </button>

                                {!puesto && !f.empleado && activo && (
                                    <div className="px-3 pb-3 flex flex-col gap-2">
                                        {proponer && (
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="flex-1 min-w-[8rem] text-micro text-content-2 font-semibold">
                                                    ¿Es {f.posible.name}?
                                                </span>
                                                <Badge variant="warning" size="sm">Posible</Badge>
                                                <Button variant="secondary" size="sm" icon={Check}
                                                    disabled={guardando}
                                                    onClick={() => elegir(f.nombre, f.posible)}>
                                                    Sí, es esa ficha
                                                </Button>
                                            </div>
                                        )}
                                        <LiquidSelect
                                            value={elegida?.id || ''}
                                            onChange={(id) => elegir(f.nombre,
                                                (sinDocumento || []).find(e => e.id === id) || null)}
                                            options={opciones}
                                            placeholder={sinDocumento === null ? 'Cargando fichas…'
                                                : proponer ? 'No es esa — elegir otra ficha'
                                                    : 'Elegir su ficha (si ya la tiene)'}
                                            clearLabel="Dejar en espera"
                                            disabled={guardando || sinDocumento === null}
                                            compact
                                        />
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {falloLista && (
                        <Notice variant="warning" compact>
                            No se pudo cargar la lista de fichas. Los que no tienen ficha quedan en espera.
                        </Notice>
                    )}
                    {filas.some(f => f.ambiguo) && (
                        <Notice variant="warning" compact>
                            Hay más de una ficha con el mismo nombre. Revisa esa persona en su
                            expediente antes de darlo por adjuntado.
                        </Notice>
                    )}
                    {fallo && (
                        <Notice variant="danger" compact>
                            <span className="flex items-center gap-1.5">
                                <AlertTriangle size={14} className="shrink-0" /> {fallo}
                            </span>
                        </Notice>
                    )}
                </div>

                <div className="shrink-0 p-4 pt-3 border-t border-divider flex flex-wrap items-center gap-2">
                    <p className="flex-1 min-w-[10rem] text-micro text-content-3 font-medium leading-snug">
                        {conFicha.length} con ficha
                        {sinFicha.length ? ` · ${sinFicha.length} en espera` : ''}
                    </p>
                    <Button variant="ghost" size="sm" onClick={alCerrar} disabled={guardando}>
                        Sólo a esta persona
                    </Button>
                    <Button variant="primary" size="sm"
                        icon={guardando ? Loader2 : Check}
                        onClick={confirmar}
                        disabled={guardando || marcadas.length === 0}
                        loading={guardando}>
                        {guardando ? 'Asignando…' : `Asignar a ${marcadas.length}`}
                    </Button>
                </div>
            </div>
        </ModalShell>
    );
}
