import React from 'react';
import { Check, Minus, Plus, Sparkles } from 'lucide-react';
import Button from '../common/Button';
import Checkbox from '../common/Checkbox';
import { PUNTOS_POR_AREA, TIPOS_DE_PUNTO, ajustarPuntos, contarPuntos } from '../../data/bitacoras';

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
    const receta = PUNTOS_POR_AREA[tipoDeArea];
    if (!receta) return null;

    const tipos = TIPOS_DE_PUNTO.filter(t => receta.tipos.includes(t.tipo));

    // Cuántos hay de verdad, contando el mínimo del área: el servicio sanitario
    // arranca en 1 porque siempre hay al menos uno, aunque nadie lo haya
    // configurado. Mostrar 0 sería decir que la sala no tiene baño.
    const cuenta = (tipo) => Math.max(contarPuntos(lista, tipo), receta.minimo);
    const total = tipos.reduce((n, t) => n + cuenta(t.tipo), 0);

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
    const lista = puntos || [];
    // Con uno solo no hay nada que elegir: marcar el turno ya lo dice todo, y
    // una lista de un renglón al lado de su propia casilla es la misma pregunta
    // dos veces. La captura lo manda igual como hecho.
    if (lista.length < 2) return null;

    const alternar = (clave) => {
        const s = new Set(marcadas);
        if (s.has(clave)) s.delete(clave); else s.add(clave);
        onCambiar(s);
    };

    const alternarGrupo = (delGrupo) => {
        const todas = delGrupo.every(p => marcadas.has(p.clave));
        const s = new Set(marcadas);
        delGrupo.forEach(p => (todas ? s.delete(p.clave) : s.add(p.clave)));
        onCambiar(s);
    };

    // Agrupados por tipo: veintiséis casillas seguidas son un muro donde no se
    // sabe si el visto de la derecha es del nombre que tiene al lado o del
    // siguiente. Con la vitrina y el estante separados, cada grupo se lee —y se
    // marca— como una unidad.
    const grupos = TIPOS_DE_PUNTO
        .map(t => ({ ...t, items: lista.filter(p => p.tipo === t.tipo) }))
        .filter(g => g.items.length > 0);
    const otros = lista.filter(p => !TIPOS_DE_PUNTO.some(t => t.tipo === p.tipo));
    if (otros.length) grupos.push({ tipo: 'otro', label: 'Otros', singular: '', items: otros });

    // Dentro de un grupo alcanza con el NÚMERO: repetir «Vitrina» once veces es
    // la misma palabra ocupando el ancho que necesita la casilla.
    const corto = (p, singular) => {
        const n = String(p.label || '').replace(singular, '').trim();
        return singular && n ? n : (p.label || '·');
    };

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
