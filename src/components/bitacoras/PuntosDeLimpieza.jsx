import React from 'react';
import { Minus, Plus, Sparkles } from 'lucide-react';
import Button from '../common/Button';
import Checkbox from '../common/Checkbox';
import { ajustarPuntos } from '@nucleo/data/bitacoras';
import { puntosDelArea } from '@nucleo/utils/configuracionDeBitacoras';
import { alternarGrupoDePuntos, alternarPunto, gruposDePuntos, rotuloCortoDePunto } from '@nucleo/utils/rondaDeBitacora';

// ═══════════════════════════════════════════════════════════════════════════
// Los muebles que se limpian dentro de un área.
//
// ── Qué pidió el usuario ───────────────────────────────────────────────────
// «en configuración se debe poder configurar cuántas vitrinas tiene la
// sucursal y cuántos estantes. así al desplegar la limpieza se marcan las que
// se limpiaron. o una marca para marcar todas como limpiadas».
//
// ── Se pide un NÚMERO y se guarda una LISTA ────────────────────────────────
// El contador es como se piensa el mobiliario de una sala; la lista con clave
// estable es lo que hace que el registro de ayer siga hablando del mismo
// mueble cuando alguien baja el contador. Ver `ajustarPuntos`.
//
// ── Sólo la CANTIDAD, no el nombre (2026-08-25) ────────────────────────────
// Primera versión: cada mueble con su campo de texto para llamarlo «Vitrina de
// refrigerados». El usuario lo sacó — «solo que se asigne la cantidad de
// vitrinas / estantes y no se nombren»— y tiene razón: escribir cuatro veces
// «Vitrina N» es trabajo que no agrega nada, y la sala las cuenta de izquierda
// a derecha igual. El portal las numera solo.
// ═══════════════════════════════════════════════════════════════════════════

function Contador({ label, singular, valor, minimo = 0, onCambiar }) {
    return (
        <div className="flex items-center gap-2">
            <span className="text-body-sm font-bold text-content-2 flex-1 min-w-0 truncate">{label}</span>
            <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" iconOnly icon={Minus}
                    title={`Quitar una ${singular.toLowerCase()}`}
                    onClick={() => onCambiar(Math.max(minimo, valor - 1))} />
                <span className="w-8 text-center text-body font-black tabular-nums">{valor}</span>
                <Button variant="ghost" size="sm" iconOnly icon={Plus}
                    title={`Agregar una ${singular.toLowerCase()}`}
                    onClick={() => onCambiar(valor + 1)} />
            </div>
        </div>
    );
}

/**
 * El editor: cuántas vitrinas y cuántos estantes tiene el área.
 *
 * Sólo la CANTIDAD, por pedido del usuario: «solo que se asigne la cantidad de
 * vitrinas / estantes y no se nombren». El nombre lo pone el portal —«Vitrina
 * 1», «Estante 3»— y con eso alcanza para marcar, contar e imprimir. Cuatro
 * campos de texto para escribir cuatro veces «Vitrina N» era trabajo que no
 * agregaba nada: la sala igual las cuenta de izquierda a derecha.
 */
export default function PuntosDeLimpieza({ tipoDeArea, puntos, onCambiar }) {
    const lista = puntos || [];
    // Qué tipos lleva el área y cuántos de cada uno —con el mínimo del área: el
    // servicio sanitario arranca en 1, mostrar 0 sería decir que la sala no
    // tiene baño—: núcleo (`puntosDelArea`), igual que la app.
    const receta = puntosDelArea(tipoDeArea, lista);
    if (!receta) return null;
    const { tipos, total } = receta;
    const cuenta = (tipo) => tipos.find(t => t.tipo === tipo)?.cuenta ?? 0;

    return (
        <div className="space-y-2">
            <p className="text-label font-black uppercase tracking-widest text-content-3 flex items-center gap-1.5">
                <Sparkles size={12} /> Cuántos hay
            </p>

            {/* Una sola columna en el teléfono: a 390px las dos entraban pero
                el rótulo se cortaba en «V» y «E», que no es un rótulo. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {tipos.map(t => (
                    <div key={t.tipo} data-surface="card" className="px-3 py-2">
                        <Contador label={t.label} singular={t.singular} valor={cuenta(t.tipo)}
                            minimo={receta.minimo}
                            onCambiar={(n) => onCambiar(ajustarPuntos(lista, t.tipo, n))} />
                    </div>
                ))}
            </div>

            {/* Con uno solo no hay nada que elegir: la limpieza se anota con su
                casilla, como siempre. La lista aparece cuando hay dos o más, que
                es cuando «se limpiaron todas» deja de ser evidente. */}
            <p className="text-label text-content-3">
                {total > 1
                    ? `Al anotar la limpieza se marca cuáles de los ${total} se limpiaron.`
                    : 'Con uno solo, la limpieza se anota con una sola casilla.'}
            </p>
        </div>
    );
}

/**
 * La captura: la lista con su «marcar todas».
 *
 * `marcadas` es un Set de claves. El registro que se guarda lo arma la base
 * contra la configuración del área —un renglón por punto, con `hecho` en
 * verdadero o falso—, así que lo que NO se marca queda escrito como no hecho y
 * no como ausente. Es la diferencia que busca un inspector.
 */
export function ListaDePuntos({ puntos, marcadas, onCambiar, compacta = false }) {
    // Con uno solo no hay nada que elegir: marcar el turno ya lo dice todo, y
    // una lista de un renglón al lado de su propia casilla es la misma pregunta
    // dos veces. La captura lo manda igual como hecho.
    const grupos = gruposDePuntos(puntos);
    if (!grupos.length) return null;

    const alternar = (clave) => onCambiar(alternarPunto(marcadas, clave));
    const alternarGrupo = (delGrupo) => onCambiar(alternarGrupoDePuntos(marcadas, delGrupo));
    const corto = rotuloCortoDePunto;

    return (
        <div className={compacta ? 'space-y-3 pl-7' : 'space-y-3'}>
            {grupos.map(g => {
                const marcadasDelGrupo = g.items.filter(p => marcadas.has(p.clave)).length;
                const completo = marcadasDelGrupo === g.items.length;
                return (
                    <div key={g.tipo} className="space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-label font-black uppercase tracking-widest text-content-3">
                                {g.label}
                            </span>
                            <span className="flex items-center gap-2">
                                <span className={`text-label font-black tabular-nums ${completo ? 'text-success-text' : 'text-content-2'}`}>
                                    {marcadasDelGrupo} de {g.items.length}
                                </span>
                                <Button variant="ghost" size="sm" onClick={() => alternarGrupo(g.items)}>
                                    {completo ? 'Ninguna' : 'Todas'}
                                </Button>
                            </span>
                        </div>

                        {/* Una rejilla de celdas: cada casilla vive en su caja,
                            así no hay duda de a qué nombre pertenece. */}
                        <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                            {g.items.map(p => (
                                <div key={p.clave} data-surface="card"
                                    data-tono={marcadas.has(p.clave) ? 'success' : undefined}
                                    className="px-2 py-1.5">
                                    <Checkbox size="sm" name={`punto-${p.clave}`}
                                        checked={marcadas.has(p.clave)}
                                        onChange={() => alternar(p.clave)}
                                        label={<span className="tabular-nums">{corto(p, g.singular)}</span>}
                                        aria-label={p.label || 'Sin nombre'} />
                                </div>
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

/**
 * Cuántos muebles se limpiaron de los que lleva el área.
 *
 * En NEUTRO, nunca en rojo: «11 de 26» no es un incumplimiento. Corregido por
 * el usuario — «no debe mostrar como malo que no se limpie todo»— y tiene
 * respaldo en la norma: lo que el RTS exige es que exista el procedimiento
 * (6.1.11), su registro (5.5.5) y que el local se vea limpio (guía 2.11). En
 * ningún lado dice que cada turno tenga que pasar por los veintiséis muebles.
 * Pintarlo de rojo convertía un dato en una acusación, y una alarma que se
 * dispara por lo normal se aprende a ignorar.
 *
 * El check verde del registro ya está afuera, en la celda: acá va sólo el
 * número.
 */
export function ResumenDePuntos({ registro }) {
    const total = registro?.puntos_total ?? 0;
    if (!total) return null;
    return (
        <span className="text-label font-bold text-content-3 tabular-nums shrink-0">
            {registro?.puntos_hechos ?? 0} de {total}
        </span>
    );
}
