import React, { useMemo, useState } from 'react';
import { GalleryHorizontal, Clapperboard, LayoutGrid } from 'lucide-react';
import SegmentedControl from '../../components/common/SegmentedControl';
import { EmptyState } from '../../components/common/StateViews';
import { clickable } from '@nucleo/utils/clickable';
import { fechaTexto, etiquetaMes } from '@nucleo/utils/fecha';
import { formatoDe, ROTULO_CORTO, feedDeMarca, portadaDePieza } from '@nucleo/utils/marketing';
import { ICONOS_FORMATO, ICONO_DESCONOCIDO, tintaDeMarca, tonoDeEstado } from './iconos';

const ALCANCE = [
    { value: 'todo', label: 'Todo el plan' },
    { value: 'aprobado', label: 'Sólo aprobado' },
];

// La portada y el feed de cada marca salen del núcleo (`marketing`): la app arma el mismo.
const portada = portadaDePieza;
const portadaDe = (p, firmadas) => { const a = portada(p); return a ? firmadas?.get?.(a.url) : null; };


/**
 * El mes como se verá en el perfil de la red: la cuadrícula de tres, lo más
 * nuevo arriba, una marca a la vez (cada marca es su propia página). Sirve
 * para cuidar la armonía —colores, ritmo, que no vayan tres fotos de producto
 * seguidas— ANTES de aprobar. Las historias no van a la cuadrícula: van
 * arriba, en círculos, como en la red.
 */
export default function TabFeed({ mes, piezas, marcas, firmadas, onAbrir }) {
    const activas = marcas.filter((m) => m.activo);
    const [marcaId, setMarcaId] = useState(() => activas[0]?.id ?? null);
    const [alcance, setAlcance] = useState('todo');
    const marca = marcas.find((m) => m.id === marcaId);

    const { cuadricula, historias } = useMemo(() => feedDeMarca(piezas, marcaId, alcance), [piezas, marcaId, alcance]);

    const chip = (activo) => `shrink-0 flex items-center gap-2 rounded-full border pl-1.5 pr-3 min-h-[var(--tap-min)] md:min-h-0 md:py-1
        text-label font-semibold transition-colors active:scale-[0.97]
        ${activo ? 'border-brand bg-brand/10 text-content' : 'border-border-card text-content-2 hover:bg-surface-card-hover'}`;

    return (
        <div className="space-y-4">
            <div className="flex flex-col md:flex-row md:items-center gap-3">
                <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide -mx-1 px-1 flex-1" role="group" aria-label="Página">
                    {activas.map((m) => (
                        <button key={m.id} type="button" className={chip(m.id === marcaId)} aria-pressed={m.id === marcaId}
                            onClick={() => setMarcaId(m.id)}>
                            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-micro font-bold ${tintaDeMarca(m.color)}`}>
                                {m.nombre.slice(0, 1)}
                            </span>
                            {m.nombre}
                        </button>
                    ))}
                </div>
                <SegmentedControl options={ALCANCE} value={alcance} onChange={setAlcance} label="Qué mostrar" />
            </div>

            <div className="mx-auto w-full max-w-[640px] space-y-4">
                {/* La cabecera del perfil, para que se lea como la red. */}
                <div data-surface="card" className="p-4 flex items-center gap-4">
                    <span className={`w-16 h-16 rounded-full flex items-center justify-center text-body-xl font-bold shrink-0 ring-2 ring-brand/45 ring-offset-2 ring-offset-surface-card ${marca ? tintaDeMarca(marca.color) : ''}`}>
                        {marca?.nombre?.slice(0, 1) || '·'}
                    </span>
                    <div className="min-w-0 flex-1">
                        <p className="text-body font-semibold text-content truncate">{marca?.nombre || 'Todas las marcas'}</p>
                        <div className="flex gap-4 mt-1 text-caption text-content-2">
                            <span><b className="text-content tabular-nums">{cuadricula.length}</b> en la cuadrícula</span>
                            <span><b className="text-content tabular-nums">{historias.length}</b> historias</span>
                        </div>
                        <p className="text-micro text-content-3 mt-1">Así queda {etiquetaMes(mes).toLowerCase()} en el perfil. Lo más nuevo, arriba.</p>
                    </div>
                </div>

                {historias.length > 0 && (
                    <div className="flex gap-3 overflow-x-auto scrollbar-hide px-1" aria-label="Historias">
                        {historias.map((p) => {
                            const src = portadaDe(p, firmadas);
                            return (
                                <div key={p.id} {...clickable(() => onAbrir(p), { label: `Abrir ${p.titulo}` })}
                                    className="shrink-0 w-[72px] flex flex-col items-center gap-1 active:scale-[0.97] cursor-pointer">
                                    <span className={`w-16 h-16 rounded-full p-[3px] ${tonoDeEstado(p.estado).barra}`}>
                                        <span className="block w-full h-full rounded-full overflow-hidden bg-surface-card ring-2 ring-surface-card">
                                            {src ? <Miniatura src={src} mime={portada(p)?.mime} titulo={p.titulo} />
                                                : <span className="w-full h-full flex items-center justify-center text-micro text-content-3">{fechaTexto(p.fecha, { day: 'numeric' })}</span>}
                                        </span>
                                    </span>
                                    <span className="text-micro text-content-2 truncate w-full text-center">{p.titulo}</span>
                                </div>
                            );
                        })}
                    </div>
                )}

                {cuadricula.length === 0 ? (
                    <EmptyState icon={LayoutGrid} title="Sin publicaciones en la cuadrícula"
                        subtitle={alcance === 'aprobado' ? 'Todavía no hay piezas aprobadas de esta marca.' : 'Esta marca no tiene publicaciones este mes.'} />
                ) : (
                    <div className="grid grid-cols-3 gap-0.5 md:gap-1 rounded-xl overflow-hidden">
                        {cuadricula.map((p) => <Celda key={p.id} pieza={p} firmadas={firmadas} onAbrir={() => onAbrir(p)} />)}
                    </div>
                )}
            </div>
        </div>
    );
}


function Miniatura({ src, mime, titulo }) {
    return String(mime || '').startsWith('video/')
        ? <video src={src} muted playsInline preload="metadata" className="w-full h-full object-cover" aria-label={titulo} />
        : <img src={src} alt={titulo} loading="lazy" className="w-full h-full object-cover" />;
}

/** Un cuadro de la cuadrícula: el diseño si ya hay; si no, su lugar con el título y el día. */
function Celda({ pieza, firmadas, onAbrir }) {
    const a = portada(pieza);
    const src = a ? firmadas?.get?.(a.url) : null;
    const formato = formatoDe(pieza.formato);
    const Icono = ICONOS_FORMATO[formato.icono] || ICONO_DESCONOCIDO;
    const tono = tonoDeEstado(pieza.estado);
    const IconoEstado = tono.icono;
    const varias = (pieza.archivos || []).filter((x) => !x.reemplazado).length > 1;
    return (
        <div {...clickable(onAbrir, { label: `Abrir ${pieza.titulo}` })}
            className={`group relative aspect-[3/4] overflow-hidden cursor-pointer active:scale-[0.97] ${src ? 'bg-surface-card' : tono.suave}`}>
            {src ? <Miniatura src={src} mime={a.mime} titulo={pieza.titulo} /> : (
                <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 p-2 text-center">
                    <Icono size={20} className={tono.texto} aria-hidden />
                    <span className="text-micro font-semibold text-content line-clamp-3 break-words">{pieza.titulo}</span>
                    <span className="text-micro text-content-3">Sin diseño</span>
                </div>
            )}
            {/* Lo que la red pinta encima: carrusel o reel, arriba a la derecha. */}
            {(pieza.formato === 'carrusel' || varias) && (
                <span className="absolute top-1.5 right-1.5 rounded-full bg-scrim p-1 text-white"><GalleryHorizontal size={14} aria-label="Carrusel" /></span>
            )}
            {(pieza.formato === 'reel' || pieza.formato === 'video') && (
                <span className="absolute top-1.5 right-1.5 rounded-full bg-scrim p-1 text-white"><Clapperboard size={14} aria-label="Video" /></span>
            )}
            {/* Y lo nuestro, abajo: el día y en qué va. */}
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 px-1.5 py-1 bg-scrim">
                <span className="text-micro font-semibold text-white tabular-nums">{fechaTexto(pieza.fecha, { day: 'numeric', month: 'short' })}</span>
                <span className={`flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-micro font-semibold text-white ${tono.solido}`}>
                    <IconoEstado size={10} aria-hidden />
                    <span className="hidden sm:inline">{ROTULO_CORTO[pieza.estado]}</span>
                </span>
            </div>
        </div>
    );
}
