import React from 'react';
import { Check, Minus, Plus, Sparkles } from 'lucide-react';
import Button from '../common/Button';
import Checkbox from '../common/Checkbox';
import { TIPOS_DE_PUNTO, ajustarPuntos, contarPuntos } from '../../data/bitacoras';

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

function Contador({ label, singular, valor, onCambiar }) {
    return (
        <div className="flex items-center gap-2">
            <span className="text-body-sm font-bold text-content-2 flex-1 min-w-0 truncate">{label}</span>
            <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" iconOnly icon={Minus}
                    title={`Quitar una ${singular.toLowerCase()}`}
                    onClick={() => onCambiar(Math.max(0, valor - 1))} />
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
export default function PuntosDeLimpieza({ puntos, onCambiar }) {
    const lista = puntos || [];

    return (
        <div className="space-y-2">
            <p className="text-label font-black uppercase tracking-widest text-content-3 flex items-center gap-1.5">
                <Sparkles size={12} /> Qué se limpia
            </p>

            {/* Una sola columna en el teléfono: a 390px las dos entraban pero
                el rótulo se cortaba en «V» y «E», que no es un rótulo. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {TIPOS_DE_PUNTO.map(t => (
                    <div key={t.tipo} data-surface="card" className="px-3 py-2">
                        <Contador label={t.label} singular={t.singular} valor={contarPuntos(lista, t.tipo)}
                            onCambiar={(n) => onCambiar(ajustarPuntos(lista, t.tipo, n))} />
                    </div>
                ))}
            </div>

            <p className="text-label text-content-3">
                {lista.length === 0
                    ? 'Sin detalle: la limpieza se anota con una sola casilla.'
                    : `Al anotar se marca cuáles de ${lista.length === 1 ? 'la' : 'las'} ${lista.length} se limpiaron.`}
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
    const lista = puntos || [];
    if (!lista.length) return null;

    const todas = lista.every(p => marcadas.has(p.clave));
    const algunas = !todas && lista.some(p => marcadas.has(p.clave));

    const alternarTodas = () => onCambiar(todas ? new Set() : new Set(lista.map(p => p.clave)));

    const alternar = (clave) => {
        const s = new Set(marcadas);
        if (s.has(clave)) s.delete(clave); else s.add(clave);
        onCambiar(s);
    };

    return (
        <div className={compacta ? 'space-y-1 pl-7' : 'space-y-1.5'}>
            {/* «Marcar todas» primero y a propósito: el día normal es que se
                limpió todo, y en ese día esto es UN toque en vez de seis. */}
            <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-border-card">
                <Checkbox
                    name={`todas-${lista[0].clave}`}
                    checked={todas} indeterminate={algunas}
                    onChange={alternarTodas}
                    label={<span className="font-black">Marcar todas</span>}
                />
                <span className="text-label font-bold text-content-3 tabular-nums">
                    {[...marcadas].filter(c => lista.some(p => p.clave === c)).length} de {lista.length}
                </span>
            </div>

            {lista.map(p => (
                <Checkbox key={p.clave} size="sm"
                    name={`punto-${p.clave}`}
                    checked={marcadas.has(p.clave)}
                    onChange={() => alternar(p.clave)}
                    label={p.label || 'Sin nombre'}
                />
            ))}
        </div>
    );
}

/** El resumen de lo anotado: «4 de 4», y en rojo si faltó alguno. */
export function ResumenDePuntos({ registro }) {
    const total = registro?.puntos_total ?? 0;
    if (!total) return null;
    const hechos = registro?.puntos_hechos ?? 0;
    const completo = hechos === total;
    return (
        <span className={`text-label font-black tabular-nums ${completo ? 'text-success-text' : 'text-danger-text'}`}>
            {completo && <Check size={11} className="inline -mt-px mr-0.5" />}
            {hechos} de {total}
        </span>
    );
}
