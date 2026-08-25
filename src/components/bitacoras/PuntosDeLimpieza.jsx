import React from 'react';
import { Check, Minus, Plus, Sparkles, Trash2 } from 'lucide-react';
import Button from '../common/Button';
import Checkbox from '../common/Checkbox';
import PortalInput from '../common/PortalInput';
import { TIPOS_DE_PUNTO, ajustarPuntos, contarPuntos, nuevaClave } from '../../data/bitacoras';

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
// ── Y el nombre se puede escribir ──────────────────────────────────────────
// «Vitrina 1» alcanza para contar, pero lo que hace auditable el registro es
// que se pueda llamar «Vitrina de refrigerados» —el nombre que usa el
// procedimiento que firmó el regente—. Sin eso, cruzar el libro contra el
// procedimiento es un ejercicio de memoria.
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

/** El editor: cuántas vitrinas, cuántos estantes, y cómo se llama cada una. */
export default function PuntosDeLimpieza({ puntos, onCambiar }) {
    const lista = puntos || [];

    const renombrar = (clave, label) =>
        onCambiar(lista.map(p => (p.clave === clave ? { ...p, label } : p)));

    const quitar = (clave) => onCambiar(lista.filter(p => p.clave !== clave));

    const agregarOtro = () => onCambiar([...lista, {
        clave: nuevaClave(lista, 'p'), tipo: 'otro', label: 'Mostrador',
    }]);

    return (
        <div className="space-y-3">
            <p className="text-label font-black uppercase tracking-widest text-content-3 flex items-center gap-1.5">
                <Sparkles size={12} /> Qué se limpia
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {TIPOS_DE_PUNTO.map(t => (
                    <div key={t.tipo} data-surface="card" className="px-3 py-2">
                        <Contador label={t.label} singular={t.singular} valor={contarPuntos(lista, t.tipo)}
                            onCambiar={(n) => onCambiar(ajustarPuntos(lista, t.tipo, n))} />
                    </div>
                ))}
            </div>

            {lista.length > 0 && (
                <div className="space-y-1.5">
                    {lista.map(p => (
                        <div key={p.clave} className="flex items-center gap-2">
                            <PortalInput
                                className="flex-1 min-w-0" compact
                                name={`punto-${p.clave}`}
                                aria-label="Cómo se llama este mueble"
                                value={p.label || ''}
                                onChange={(e) => renombrar(p.clave, e.target.value)}
                                placeholder="Vitrina de refrigerados"
                            />
                            <Button variant="ghost" size="sm" iconOnly icon={Trash2}
                                title="Quitar este mueble" onClick={() => quitar(p.clave)} />
                        </div>
                    ))}
                </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
                <Button variant="ghost" size="sm" icon={Plus} onClick={agregarOtro}>
                    Agregar otro mueble
                </Button>
                <p className="text-label text-content-3">
                    {lista.length === 0
                        ? 'Sin detalle: la limpieza se anota con una sola casilla.'
                        : 'Al anotar la limpieza se marca cuáles se limpiaron.'}
                </p>
            </div>
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
