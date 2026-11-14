import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Ban, CheckCircle2, Pill, RotateCcw, Search, Undo2 } from 'lucide-react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import SearchInput from '../../components/common/SearchInput';
import SegmentedControl from '../../components/common/SegmentedControl';
import ConfirmModal from '../../components/common/ConfirmModal';
import LiquidModal from '../../components/common/LiquidModal';
import { EmptyState, LoadingState } from '../../components/common/StateViews';
import { useToastStore } from '@nucleo/store/toastStore';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { coincide } from '@nucleo/utils/busqueda';
import {
    buscarEnCatalogoSrs, fetchParejasSrs, mensajeDeDatosMercado, revisarParejaSrs,
} from '@nucleo/data/datosMercadoSrs';

/*
 * Datos de mercado de la SRS (2026-11-14). Cada año la Superintendencia pide
 * existencias y precio real de venta de todo medicamento, por farmacia, y su
 * sistema identifica cada producto con un código propio. Acá se decide, una
 * sola vez, qué producto de la SRS es cada producto del portal: el
 * emparejador ya propuso uno (con su confianza) y una persona lo confirma,
 * elige otro o lo marca como «no es medicamento». Lo confirmado queda para
 * los años siguientes y es lo que se usa para enviar.
 */

const POR_PAGINA = 40;
const VACIO = [];

const CONFIANZA = {
    alta: { texto: 'Confianza alta', variant: 'success' },
    media: { texto: 'Confianza media', variant: 'warning' },
    baja: { texto: 'Confianza baja', variant: 'danger' },
    manual: { texto: 'Elegido a mano', variant: 'info' },
    sin_pareja: { texto: 'Sin pareja', variant: 'neutral' },
};

function grupoDe(f) {
    if (f.estado === 'confirmado') return 'confirmados';
    if (f.estado === 'no_aplica') return 'no_aplica';
    if (!f.crp) return 'sin_pareja';
    return f.confianza === 'alta' ? 'alta' : f.confianza === 'media' ? 'media' : 'baja';
}

function ProductoSrs({ p, compacto = false }) {
    if (!p?.crp) return <p className="text-body-sm text-content-3">Sin producto de la SRS</p>;
    return (
        <div className="min-w-0">
            <p className={`${compacto ? 'text-body-sm' : 'text-body'} font-bold text-content break-words`}>
                {p.nombre_srs ?? p.nombre_comercial}
            </p>
            <p className="text-caption text-content-2 break-words">{p.presentacion_srs ?? p.presentacion}</p>
            <p className="text-caption text-content-3 break-words">
                {(p.laboratorio_srs ?? p.laboratorio) || '—'} · Reg. {p.n_registro} · {p.crp}
            </p>
        </div>
    );
}

export default function TabDatosMercado({ puedeEditar }) {
    const showToast = useToastStore((s) => s.showToast);
    const [filas, setFilas] = useState(null);
    const [error, setError] = useState(null);
    const [grupo, setGrupo] = useState('alta');
    const [texto, setTexto] = useState('');
    const [visibles, setVisibles] = useState(POR_PAGINA);
    const [ocupado, setOcupado] = useState(null); // product_id en curso
    const [eligiendo, setEligiendo] = useState(null); // fila
    const [masivo, setMasivo] = useState(null); // { hechos, total } | 'confirmar'

    const cargar = useCallback(async () => {
        const { filas: f, error: e } = await fetchParejasSrs();
        setError(e ? mensajeDeDatosMercado(e) : null);
        if (!e) setFilas(f);
    }, []);
    useEffect(() => {
        let vivo = true;
        fetchParejasSrs().then(({ filas: f, error: e }) => {
            if (!vivo) return;
            setError(e ? mensajeDeDatosMercado(e) : null);
            if (!e) setFilas(f);
        });
        return () => { vivo = false; };
    }, []);

    const conteo = useMemo(() => {
        const c = { alta: 0, media: 0, baja: 0, sin_pareja: 0, confirmados: 0, no_aplica: 0 };
        for (const f of filas ?? VACIO) c[grupoDe(f)] += 1;
        return c;
    }, [filas]);

    const lista = useMemo(() => (filas ?? VACIO)
        .filter((f) => grupoDe(f) === grupo)
        .filter((f) => coincide(texto, f.nombre, f.laboratorio, f.nombre_srs, f.crp)),
    [filas, grupo, texto]);

    const elegirGrupo = (g) => { setGrupo(g); setVisibles(POR_PAGINA); };
    const escribir = (t) => { setTexto(t); setVisibles(POR_PAGINA); };

    const reemplazar = (fila) => setFilas((prev) => prev.map((f) => (f.product_id === fila.product_id ? { ...f, ...fila } : f)));

    const decidir = async (f, estado, producto = null) => {
        setOcupado(f.product_id);
        const { fila, error: e } = await revisarParejaSrs(f.product_id, estado, producto);
        setOcupado(null);
        if (e) { showToast('No se guardó', mensajeDeDatosMercado(e), 'error'); return false; }
        reemplazar(fila);
        useStaff.getState().appendAuditLog('SRS_MERCADO_PAREJA', String(f.product_id), {
            producto: f.nombre, estado, crp: fila?.crp ?? null,
        });
        return true;
    };

    const confirmarTodasLasAltas = async () => {
        const pendientes = (filas ?? VACIO).filter((f) => grupoDe(f) === 'alta');
        let hechos = 0;
        let fallas = 0;
        setMasivo({ hechos: 0, total: pendientes.length });
        const cola = [...pendientes];
        const trabajar = async () => {
            while (cola.length) {
                const f = cola.shift();
                const { fila, error: e } = await revisarParejaSrs(f.product_id, 'confirmado');
                if (e) fallas += 1; else reemplazar(fila);
                hechos += 1;
                setMasivo({ hechos, total: pendientes.length });
            }
        };
        await Promise.all(Array.from({ length: 6 }, trabajar));
        setMasivo(null);
        useStaff.getState().appendAuditLog('SRS_MERCADO_CONFIRMAR_ALTAS', 'srs_mercado', {
            confirmadas: pendientes.length - fallas, fallas,
        });
        if (fallas) showToast('Confirmación incompleta', `${fallas} no se pudieron confirmar. Vuelve a intentar.`, 'warning');
        else showToast('Listo', `${pendientes.length} productos confirmados.`, 'success');
    };

    if (error) return <Notice variant="danger" action={<Button size="sm" variant="secondary" onClick={() => { setError(null); cargar(); }}>Reintentar</Button>}>{error}</Notice>;
    if (!filas) return <LoadingState label="Cargando productos…" />;

    const total = filas.length;
    const decididos = conteo.confirmados + conteo.no_aplica;
    const opciones = [
        { value: 'alta', label: `Alta · ${conteo.alta}` },
        { value: 'media', label: `Media · ${conteo.media}` },
        { value: 'baja', label: `Baja · ${conteo.baja}` },
        { value: 'sin_pareja', label: `Sin pareja · ${conteo.sin_pareja}` },
        { value: 'confirmados', label: `Confirmados · ${conteo.confirmados}` },
        { value: 'no_aplica', label: `No es medicamento · ${conteo.no_aplica}` },
    ];
    const enCurso = masivo && masivo !== 'confirmar';

    return (
        <div className="space-y-4">
            <Notice variant="info" bloque>
                La Superintendencia pide cada año las existencias y el precio de venta de todo medicamento de uso
                humano, por farmacia. Aquí se elige, una sola vez, qué producto de su catálogo es cada producto
                nuestro. Revisados {decididos} de {total}.
            </Notice>

            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between min-w-0">
                <SegmentedControl options={opciones} value={grupo} onChange={elegirGrupo} size="sm" />
                <SearchInput value={texto} onChange={escribir} placeholder="Buscar producto…" className="md:w-72" />
            </div>

            {grupo === 'alta' && puedeEditar && conteo.alta > 0 && (
                <Notice variant="success" bloque
                    action={(
                        <Button size="sm" icon={CheckCircle2} loading={!!enCurso} disabled={!!enCurso}
                            onClick={() => setMasivo('confirmar')}>
                            {enCurso ? `Confirmando ${masivo.hechos} de ${masivo.total}…` : `Confirmar las ${conteo.alta}`}
                        </Button>
                    )}>
                    Coinciden nombre, concentración y presentación. Dales una mirada y confírmalas de una vez.
                </Notice>
            )}
            {grupo === 'sin_pareja' && (
                <Notice variant="info" bloque>
                    Casi todos son productos que no son medicamentos (curitas, cepillos, leches, cosméticos): márcalos
                    como «No es medicamento». Si alguno sí lo es, búscalo en el catálogo de la SRS.
                </Notice>
            )}

            {lista.length === 0 ? (
                <EmptyState icon={Pill} title={texto ? 'Nada coincide con la búsqueda' : 'No hay productos en este grupo'} />
            ) : (
                <ul className="space-y-2">
                    {lista.slice(0, visibles).map((f) => {
                        const conf = CONFIANZA[f.confianza] ?? CONFIANZA.sin_pareja;
                        const g = grupoDe(f);
                        const decidido = g === 'confirmados' || g === 'no_aplica';
                        return (
                            <li key={f.product_id} data-surface="card" className="p-3 md:p-4">
                                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-2 md:gap-4 md:items-center">
                                    <div className="min-w-0">
                                        <p className="text-body font-bold text-content break-words">{f.nombre}</p>
                                        <p className="text-caption text-content-3">
                                            {f.laboratorio || 'Sin laboratorio'} · Existencia {f.existencia}
                                        </p>
                                    </div>
                                    <ArrowRight size={18} className="hidden md:block text-content-3" aria-hidden />
                                    {g === 'no_aplica'
                                        ? <p className="text-body-sm text-content-3">No es medicamento: la SRS no lo pide.</p>
                                        : <ProductoSrs p={f} />}
                                </div>
                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                    {g !== 'no_aplica' && g !== 'sin_pareja' && (
                                        <Badge variant={conf.variant} uppercase={false}>{conf.texto}</Badge>
                                    )}
                                    {g === 'confirmados' && <Badge variant="success" uppercase={false} icon={CheckCircle2}>Confirmado</Badge>}
                                    <div className="flex-1" />
                                    {puedeEditar && !decidido && (
                                        <>
                                            {f.crp && (
                                                <Button size="sm" icon={CheckCircle2} loading={ocupado === f.product_id}
                                                    onClick={() => decidir(f, 'confirmado')}>
                                                    Es éste
                                                </Button>
                                            )}
                                            <Button size="sm" variant="secondary" icon={Search} onClick={() => setEligiendo(f)}>
                                                {f.crp ? 'Elegir otro' : 'Buscar en la SRS'}
                                            </Button>
                                            <Button size="sm" variant="ghost" icon={Ban} disabled={ocupado === f.product_id}
                                                onClick={() => decidir(f, 'no_aplica')}>
                                                No es medicamento
                                            </Button>
                                        </>
                                    )}
                                    {puedeEditar && decidido && (
                                        <>
                                            {g === 'confirmados' && (
                                                <Button size="sm" variant="secondary" icon={Search} onClick={() => setEligiendo(f)}>
                                                    Cambiar
                                                </Button>
                                            )}
                                            <Button size="sm" variant="ghost" icon={Undo2} loading={ocupado === f.product_id}
                                                onClick={() => decidir(f, 'propuesto')}>
                                                Deshacer
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
            {lista.length > visibles && (
                <div className="flex justify-center">
                    <Button variant="secondary" icon={RotateCcw} onClick={() => setVisibles((v) => v + POR_PAGINA)}>
                        Ver más ({lista.length - visibles} restantes)
                    </Button>
                </div>
            )}

            <ConfirmModal
                isOpen={masivo === 'confirmar'}
                onClose={() => setMasivo(null)}
                onConfirm={confirmarTodasLasAltas}
                title={`¿Confirmar ${conteo.alta} productos?`}
                message="Se confirman todas las parejas de confianza alta. Cualquiera se puede cambiar o deshacer después."
                confirmText="Confirmar"
                isDestructive={false}
            />

            {eligiendo && (
                <ElegirProductoSrs
                    fila={eligiendo}
                    onClose={() => setEligiendo(null)}
                    onElegir={async (p) => { if (await decidir(eligiendo, 'confirmado', p)) setEligiendo(null); }}
                />
            )}
        </div>
    );
}

function ElegirProductoSrs({ fila, onClose, onElegir }) {
    const [q, setQ] = useState(() => (fila.nombre || '').split(/\s+/).slice(0, 2).join(' '));
    const [resultados, setResultados] = useState(null);
    const [buscando, setBuscando] = useState(false);
    const [error, setError] = useState(null);
    const alternativas = Array.isArray(fila.alternativas) ? fila.alternativas : VACIO;

    const buscar = async () => {
        if (q.trim().length < 3) return;
        setBuscando(true);
        setError(null);
        const { productos, error: e } = await buscarEnCatalogoSrs(q.trim());
        setBuscando(false);
        if (e) { setError(mensajeDeDatosMercado(e)); return; }
        setResultados(productos);
    };

    const opcion = (p) => (
        <li key={p.crp} className="flex items-start gap-3 py-2">
            <div className="flex-1 min-w-0"><ProductoSrs p={p} compacto /></div>
            <Button size="sm" onClick={() => onElegir(p)}>Elegir</Button>
        </li>
    );

    return (
        // Cabecera, cuerpo y pie del canónico: el cuerpo es el que scrollea
        // (con un <div> suelto la lista larga del buscador quedaba cortada).
        <LiquidModal open onClose={onClose} maxWidth="max-w-2xl" ariaLabel="Elegir producto de la SRS">
            <LiquidModal.Header icono={Search} tono="brand" titulo={fila.nombre}
                subtitulo="Producto del portal" onClose={onClose} />
            <LiquidModal.Body className="space-y-4">
                {alternativas.length > 0 && (
                    <div>
                        <p className="text-caption font-bold text-content-2">Otras opciones que encontró el emparejador</p>
                        <ul className="divide-y divide-divider">{alternativas.map(opcion)}</ul>
                    </div>
                )}
                <div className="space-y-2">
                    <p className="text-caption font-bold text-content-2">Buscar en el catálogo de la SRS</p>
                    <div className="flex gap-2">
                        <SearchInput value={q} onChange={setQ} placeholder="Nombre y concentración"
                            onKeyDown={(e) => { if (e.key === 'Enter') buscar(); }} className="flex-1" />
                        <Button icon={Search} loading={buscando} onClick={buscar}>Buscar</Button>
                    </div>
                    {error && <Notice variant="danger">{error}</Notice>}
                    {resultados && (resultados.length === 0
                        ? <p className="text-body-sm text-content-3">Sin resultados. Prueba con menos palabras.</p>
                        : <ul className="divide-y divide-divider">{resultados.map(opcion)}</ul>)}
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <Button variant="secondary" onClick={onClose}>Cerrar</Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
