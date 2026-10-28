import React, { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import PieDeModal from '../../components/common/PieDeModal';
import Button from '../../components/common/Button';
import LiquidSelect from '../../components/common/LiquidSelect';
import PortalInput from '../../components/common/PortalInput';
import SearchInput from '../../components/common/SearchInput';
import SegmentedControl from '../../components/common/SegmentedControl';
import Notice from '../../components/common/Notice';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { useToastStore } from '@nucleo/store/toastStore';
import { buscarProductos } from '@nucleo/data/busquedaProductos';
import {
    GRUPOS_AWARE, VIAS_ANTIBIOTICO, agregarMoleculaAntibiotico, antibioticoAutomatico, asignarAntibiotico,
    fetchMoleculasAware,
} from '@nucleo/data/bitacoras';

/*
 * Fijar a mano de qué molécula es un producto y por qué vía se usa
 * (2026-10-28). Lo que se guarda acá manda sobre lo que proponga el nombre.
 * Sin `producto`, primero se busca (agregar uno que el listado no ve).
 *
 * «No es antibiótico» lo saca del listado sin borrar nada: queda en «Sacados»
 * y se puede devolver.
 */

const GRUPOS = Object.entries(GRUPOS_AWARE).map(([value, g]) => ({ value, label: g.label }));

export default function EditarAntibioticoModal({ producto: inicial = null, onClose, onHecho }) {
    const showToast = useToastStore((s) => s.showToast);
    const [producto, setProducto] = useState(inicial);
    const [molecula, setMolecula] = useState(inicial?.molecula || '');
    const [via, setVia] = useState(inicial?.via || 'oral');
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState(null);
    const [extra, setExtra] = useState([]);
    const [moleculas, setMoleculas] = useState([]);
    useEffect(() => {
        fetchMoleculasAware().then(({ moleculas: m, error: e }) => {
            if (e) setError(e);
            setMoleculas(m);
        });
    }, []);
    const [nueva, setNueva] = useState(null);

    const [texto, setTexto] = useState('');
    const q = useTextoRebotado(texto, 300);
    const [resultados, setResultados] = useState([]);
    useEffect(() => {
        let vivo = true;
        if (producto || q.trim().length < 3) { setResultados([]); return undefined; } // eslint-disable-line react-hooks/set-state-in-effect -- vaciar al borrar
        buscarProductos(q, { select: 'id, nombre', limite: 8 }).then(({ data, error: e }) => {
            if (!vivo) return;
            if (e) console.error('EditarAntibioticoModal: no se pudo buscar', e);
            setResultados(data ?? []);
        });
        return () => { vivo = false; };
    }, [q, producto]);

    const opciones = useMemo(() => [...moleculas, ...extra.filter(x => !moleculas.some(m => m.molecula === x.molecula))]
        .map((m) => ({ value: m.molecula, label: `${m.molecula}${m.grupo ? ` · ${GRUPOS_AWARE[m.grupo]?.label}` : ''}` }))
        .sort((a, b) => a.value.localeCompare(b.value)), [moleculas, extra]);

    const guardar = async (mol) => {
        setGuardando(true);
        setError(null);
        const { error: e } = await asignarAntibiotico({ productId: producto.product_id, molecula: mol, via });
        setGuardando(false);
        if (e) { setError(e); return; }
        showToast(mol ? 'Guardado' : 'Sacado del listado', producto.producto, 'success');
        onHecho?.();
    };
    const automatico = async () => {
        setGuardando(true);
        const { error: e } = await antibioticoAutomatico(producto.product_id);
        setGuardando(false);
        if (e) { setError(e); return; }
        showToast('Vuelve a lo que dice su nombre', producto.producto, 'success');
        onHecho?.();
    };
    const crearMolecula = async () => {
        setGuardando(true);
        setError(null);
        const r = await agregarMoleculaAntibiotico(nueva);
        setGuardando(false);
        if (r.error) { setError(r.error); return; }
        setExtra((x) => [...x, { molecula: r.molecula, grupo: nueva.grupo || null }]);
        setMolecula(r.molecula);
        setNueva(null);
    };

    return (
        <LiquidModal open onClose={guardando ? undefined : onClose} maxWidth="max-w-lg" ariaLabel="Antibiótico del listado">
            <LiquidModal.Header>
                <h3 className="text-h3 font-bold text-content">{producto ? producto.producto : 'Agregar un producto'}</h3>
                {producto?.origen === 'nombre' && (
                    <p className="text-caption text-content-3 mt-1">Hoy está en el listado por su nombre. Lo que guardes aquí manda.</p>
                )}
            </LiquidModal.Header>
            <LiquidModal.Body className="space-y-4">
                {!producto ? (
                    <div className="space-y-2">
                        <SearchInput value={texto} onChange={setTexto} placeholder="Nombre del producto" ariaLabel="Buscar producto" />
                        {resultados.length > 0 && (
                            <ul className="rounded-lg border border-border-subtle divide-y divide-border-subtle">
                                {resultados.map((p) => (
                                    <li key={p.id}>
                                        <button type="button" onClick={() => setProducto({ product_id: p.id, producto: p.nombre })}
                                            className="w-full text-left px-3 py-2 min-h-[var(--tap-min)] text-body-sm text-content hover:bg-surface-card-hover active:scale-[0.99]">
                                            {p.nombre}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                ) : (
                    <>
                        <div className="space-y-1.5">
                            <LiquidSelect value={molecula} onChange={(v) => setMolecula(v || '')} options={opciones}
                                placeholder="Molécula" clearable={false} />
                            {!nueva && (
                                <Button variant="ghost" size="xs" icon={Plus}
                                    onClick={() => setNueva({ molecula: '', grupo: '', atc: '' })}>
                                    No está la molécula: agregarla
                                </Button>
                            )}
                        </div>
                        {nueva && (
                            <div className="space-y-2 rounded-lg border border-border-subtle p-3">
                                <PortalInput label="Molécula" value={nueva.molecula} maxLength={40}
                                    onChange={(e) => setNueva((n) => ({ ...n, molecula: e.target.value }))} />
                                <SegmentedControl label="Grupo AWaRe (lo confirma el regente)" options={GRUPOS}
                                    value={nueva.grupo || null} onChange={(g) => setNueva((n) => ({ ...n, grupo: g }))}
                                    layout="block" columns={3} />
                                <PortalInput label="Código ATC (opcional)" value={nueva.atc} maxLength={10}
                                    onChange={(e) => setNueva((n) => ({ ...n, atc: e.target.value }))} />
                                <div className="flex justify-end gap-2">
                                    <Button variant="ghost" size="sm" onClick={() => setNueva(null)} disabled={guardando}>Cancelar</Button>
                                    <Button variant="secondary" size="sm" loading={guardando}
                                        disabled={nueva.molecula.trim().length < 4} onClick={crearMolecula}>Agregar</Button>
                                </div>
                            </div>
                        )}
                        <SegmentedControl label="Vía" options={VIAS_ANTIBIOTICO} value={via} onChange={setVia}
                            layout="block" columns={3} />
                        <p className="text-caption text-content-3">
                            Va al libro: cefixima, azitromicina, claritromicina, levofloxacina, moxifloxacina y
                            norfloxacina en cualquier presentación, y todo antibiótico inyectable. El resto pide receta
                            pero no va al libro. Los de uso local no tienen grupo AWaRe.
                        </p>
                    </>
                )}
                {error && <Notice variant="danger">{error}</Notice>}
            </LiquidModal.Body>
            {producto && (
                <PieDeModal izquierda={(
                    <div className="flex flex-wrap gap-2">
                        <Button variant="ghost" size="sm" disabled={guardando} onClick={() => guardar(null)}>No es antibiótico</Button>
                        {producto.origen === 'manual' && (
                            <Button variant="ghost" size="sm" disabled={guardando} onClick={automatico}>Volver a lo automático</Button>
                        )}
                    </div>
                )}>
                    <Button variant="ghost" onClick={onClose} disabled={guardando}>Cancelar</Button>
                    <Button variant="primary" loading={guardando} disabled={!molecula} onClick={() => guardar(molecula)}>Guardar</Button>
                </PieDeModal>
            )}
        </LiquidModal>
    );
}
