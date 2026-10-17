import React, { useEffect, useState } from 'react';
import Button from '../common/Button';
import SearchInput from '../common/SearchInput';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { buscarClientes } from '@nucleo/data/customers';

/**
 * La ficha del cliente que trajo su inyección: con ella la aplicación entra a
 * su historial y la ve en la app de puntos. Se busca por nombre, DUI o
 * teléfono; si no aparece, se cobra igual con el nombre escrito.
 *
 * Vive aparte (2026-10-17) porque también la usa la Bitácora para asignar
 * la ficha DESPUÉS, a una aplicación que se cobró sin ella.
 */
export default function BuscarFicha({ ficha, onElegir }) {
    const [texto, setTexto] = useState('');
    const q = useTextoRebotado(texto, 300);
    const [resultados, setResultados] = useState([]);
    const [buscando, setBuscando] = useState(false);
    useEffect(() => {
        let vivo = true;
        if (ficha || q.trim().length < 3) { setResultados([]); return undefined; } // eslint-disable-line react-hooks/set-state-in-effect -- vaciar al borrar
        setBuscando(true);
        buscarClientes(q, { select: 'id, name, dui, phone', limite: 6 }).then(({ data, error }) => {
            if (!vivo) return;
            setBuscando(false);
            if (error) console.error('BuscarFicha: no se pudo buscar', error);
            setResultados(data ?? []);
        });
        return () => { vivo = false; };
    }, [q, ficha]);

    if (ficha) {
        return (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle px-3 py-2">
                <div className="min-w-0">
                    <p className="text-caption text-content-3">Queda en el historial de</p>
                    <p className="text-body-sm font-semibold text-content truncate">{ficha.name}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => { onElegir(null); setTexto(''); }}>Cambiar</Button>
            </div>
        );
    }
    return (
        <div className="space-y-1.5">
            <SearchInput value={texto} onChange={setTexto} placeholder="Cliente: nombre, DUI o teléfono"
                ariaLabel="Buscar la ficha del cliente" />
            <p className="text-caption text-content-3">
                Con su ficha, la aplicación queda en su historial y la ve en su app. Si no tiene, se cobra igual.
            </p>
            {buscando && <p className="text-caption text-content-3">Buscando…</p>}
            {resultados.length > 0 && (
                <ul className="rounded-lg border border-border-subtle divide-y divide-border-subtle">
                    {resultados.map((c) => (
                        <li key={c.id}>
                            <button type="button" onClick={() => onElegir(c)}
                                className="w-full text-left px-3 py-2 min-h-[var(--tap-min)] hover:bg-surface-card-hover active:scale-[0.99]">
                                <span className="block text-body-sm font-semibold text-content truncate">{c.name}</span>
                                <span className="block text-caption text-content-3">{[c.dui, c.phone].filter(Boolean).join(' · ') || 'Sin documento'}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
