import React, { useEffect, useState } from 'react';
import { UserPlus } from 'lucide-react';
import Button from '../common/Button';
import PortalInput from '../common/PortalInput';
import SearchInput from '../common/SearchInput';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { buscarClientes, crearClienteDeMostrador } from '@nucleo/data/customers';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';

/**
 * La ficha del cliente que trajo su inyección: con ella la aplicación entra a
 * su historial y la ve en la app de puntos. Se busca por nombre, DUI o
 * teléfono; si no aparece, se cobra igual con el nombre escrito.
 *
 * Vive aparte (2026-10-17) porque también la usa la Bitácora para asignar
 * la ficha DESPUÉS, a una aplicación que se cobró sin ella.
 */
/* `ayuda` y `rotulo`: el texto de abajo y el de la ficha elegida. Por defecto
 * hablan de la inyección; el pago de Mapfre los cambia, porque ahí la ficha
 * del asegurado es obligatoria y decir «se cobra igual» sería falso. */
/* `crear` (2026-10-28): si el cliente no aparece, se le crea la ficha ahí
 * mismo —nombre y apellido más teléfono o DUI—. La base devuelve la que ya
 * existía si el DUI o el nombre coinciden, en vez de duplicarla. */
const AYUDA = 'Con su ficha, la aplicación queda en su historial y la ve en su app. Si no tiene, se cobra igual.';
const NUEVA = { nombre: '', telefono: '', dui: '' };

export default function BuscarFicha({ ficha, onElegir, ayuda = AYUDA, rotulo = 'Queda en el historial de', crear = false }) {
    const [texto, setTexto] = useState('');
    const [nueva, setNueva] = useState(null);
    const [creando, setCreando] = useState(false);
    const [errorNueva, setErrorNueva] = useState('');
    const [yaExistia, setYaExistia] = useState(false);
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

    const abrirNueva = () => {
        // Lo buscado se lleva al campo que corresponde: dígitos son un teléfono o un DUI.
        const d = texto.replace(/\D/g, '');
        const conLetras = /[a-záéíóúñ]/i.test(texto);
        setNueva({ ...NUEVA, nombre: conLetras ? texto.trim() : '', telefono: !conLetras && d.length === 8 ? d : '', dui: !conLetras && d.length === 9 ? d : '' });
        setErrorNueva('');
    };
    const guardarNueva = async () => {
        setCreando(true);
        setErrorNueva('');
        try {
            const c = await crearClienteDeMostrador(nueva);
            setYaExistia(!!c.existente);
            setNueva(null);
            onElegir(c);
        } catch (e) {
            setErrorNueva(mensajeAmigable(e, 'No se pudo crear la ficha'));
        } finally {
            setCreando(false);
        }
    };

    if (ficha) {
        return (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle px-3 py-2">
                <div className="min-w-0">
                    <p className="text-caption text-content-3">{rotulo}</p>
                    <p className="text-body-sm font-semibold text-content truncate">{ficha.name}</p>
                    {yaExistia && <p className="text-caption text-content-3">Ya tenía ficha: se usa ésa.</p>}
                </div>
                <Button variant="ghost" size="sm" onClick={() => { onElegir(null); setTexto(''); setYaExistia(false); }}>Cambiar</Button>
            </div>
        );
    }
    if (nueva) {
        const set = (k) => (e) => setNueva((n) => ({ ...n, [k]: e.target.value }));
        return (
            <div className="space-y-2 rounded-lg border border-border-subtle p-3">
                <p className="text-body-sm font-semibold text-content">Cliente nuevo</p>
                <PortalInput label="Nombre y apellido" value={nueva.nombre} onChange={set('nombre')} maxLength={80} autoComplete="off" />
                <div className="grid grid-cols-2 gap-2">
                    <PortalInput label="Teléfono" value={nueva.telefono} onChange={set('telefono')} maxLength={9} inputMode="numeric" autoComplete="off" />
                    <PortalInput label="DUI" value={nueva.dui} onChange={set('dui')} maxLength={10} inputMode="numeric" autoComplete="off" />
                </div>
                <p className="text-caption text-content-3">Hace falta el teléfono o el DUI.</p>
                {errorNueva && <p className="text-caption text-danger">{errorNueva}</p>}
                <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setNueva(null)} disabled={creando}>Cancelar</Button>
                    <Button variant="primary" size="sm" loading={creando} onClick={guardarNueva}
                        disabled={nueva.nombre.trim().split(/\s+/).length < 2 || !(nueva.telefono.trim() || nueva.dui.trim())}>
                        Crear y usar
                    </Button>
                </div>
            </div>
        );
    }
    return (
        <div className="space-y-1.5">
            <SearchInput value={texto} onChange={setTexto} placeholder="Cliente: nombre, DUI o teléfono"
                ariaLabel="Buscar la ficha del cliente" />
            {ayuda && <p className="text-caption text-content-3">{ayuda}</p>}
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
            {crear && !buscando && q.trim().length >= 3 && (
                <Button variant="ghost" size="sm" icon={UserPlus} onClick={abrirNueva}>
                    {resultados.length ? 'No es ninguno: crear cliente nuevo' : 'No aparece: crear cliente nuevo'}
                </Button>
            )}
        </div>
    );
}
