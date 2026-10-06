import React, { useState } from 'react';
import { Download, Copy, Share2, Image as ImageIcon, CheckCircle2, AlertTriangle, Store } from 'lucide-react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Switch from '../../components/common/Switch';
import { EmptyState } from '../../components/common/StateViews';
import { clickable } from '@nucleo/utils/clickable';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { fechaTexto } from '@nucleo/utils/fecha';
import { downloadStoredFile } from '@nucleo/utils/storageFiles';
import { formatoDe, tipoDeArchivo, aptoParaWhatsApp, esDeGaleria, mediosDe, textoParaPublicar } from '@nucleo/utils/marketing';
import { registrarEgreso } from '@nucleo/data/egreso';
import { puntoDeMarca } from './iconos';

const extension = (a) => (String(a.nombre || '').match(/\.[a-z0-9]+$/i)?.[0] || (a.mime?.startsWith('video/') ? '.mp4' : '.jpg'));

/**
 * La galería de piezas. Dos usos con la misma tarjeta:
 *   · `gestion` (Marketing): todas las piezas, con el interruptor de liberar.
 *   · sala (`/galeria`): sólo lo liberado y aprobado —lo recorta el RLS—, para
 *     descargarlo, copiar el texto y publicarlo en WhatsApp.
 *
 * Los filtros (formato, marca) los decide quien la pinta; acá llega la lista
 * ya recortada.
 */
export default function Galeria({ piezas, marcas, firmadas, gestion = false, puedeLiberar = false, onLiberar, onAbrir }) {
    if (!piezas.length) {
        return (
            <EmptyState icon={ImageIcon} title="Sin piezas"
                subtitle={gestion
                    ? 'Libera las piezas aprobadas para que las salas las descarguen.'
                    : 'Todavía no hay piezas liberadas para descargar.'} />
        );
    }
    return (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {piezas.map((p) => (
                <TarjetaDeGaleria key={p.id} pieza={p} marcas={marcas} firmadas={firmadas} gestion={gestion}
                    puedeLiberar={puedeLiberar} onLiberar={onLiberar} onAbrir={onAbrir} />
            ))}
        </div>
    );
}

function TarjetaDeGaleria({ pieza, marcas, firmadas, gestion, puedeLiberar, onLiberar, onAbrir }) {
    const showToast = useToastStore((s) => s.showToast);
    const [ocupado, setOcupado] = useState(false);
    const medios = mediosDe(pieza);
    const portada = medios.find((a) => ['imagen', 'video'].includes(tipoDeArchivo(a))) || medios[0];
    const src = portada ? firmadas?.get?.(portada.url) : null;
    const texto = textoParaPublicar(pieza);
    const susMarcas = (pieza.marcas?.length ? pieza.marcas : [pieza.marca_id]).map((id) => marcas[id]).filter(Boolean);
    const whatsapp = medios.map(aptoParaWhatsApp);
    const apta = medios.length > 0 && whatsapp.every((w) => w.apto);
    const aprobada = esDeGaleria({ ...pieza, liberada: true });
    const puedeCompartir = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function';

    const descargar = async () => {
        setOcupado(true);
        try {
            for (const [i, a] of medios.entries()) {
                await downloadStoredFile(a.url, `${pieza.titulo}${medios.length > 1 ? ` (${i + 1})` : ''}${extension(a)}`);
            }
            registrarEgreso('galeria', { formato: 'diseno', filas: medios.length, detalle: { pieza: pieza.id } });
        } catch (err) {
            showToast('No se pudo descargar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setOcupado(false);
        }
    };

    const copiar = async () => {
        try {
            await navigator.clipboard.writeText(texto);
            showToast('Texto copiado', 'Pégalo al publicar el estado', 'success');
        } catch {
            showToast('No se pudo copiar', 'Selecciona el texto y cópialo a mano', 'error');
        }
    };

    // En el teléfono, compartir abre WhatsApp directo con el archivo.
    const compartir = async () => {
        setOcupado(true);
        try {
            const archivos = await Promise.all(medios.map(async (a, i) => {
                const res = await fetch(firmadas.get(a.url));
                const blob = await res.blob();
                return new File([blob], `${pieza.titulo}${medios.length > 1 ? ` (${i + 1})` : ''}${extension(a)}`, { type: a.mime || blob.type });
            }));
            const datos = { files: archivos, text: texto || undefined };
            if (!navigator.canShare(datos)) throw new Error('Este equipo no comparte archivos: usa Descargar.');
            await navigator.share(datos);
            registrarEgreso('galeria', { formato: 'compartir', filas: medios.length, detalle: { pieza: pieza.id } });
        } catch (err) {
            if (err?.name !== 'AbortError') showToast('No se pudo compartir', mensajeAmigable(err, 'Usa Descargar.'), 'error');
        } finally {
            setOcupado(false);
        }
    };

    return (
        <article data-surface="card" className="p-0 overflow-hidden flex flex-col min-w-0">
            <div {...clickable(gestion && onAbrir ? () => onAbrir(pieza) : undefined, { label: `Abrir ${pieza.titulo}` })}
                className="aspect-square bg-surface-input flex items-center justify-center relative">
                {portada && tipoDeArchivo(portada) === 'imagen' && src && <img src={src} alt={pieza.titulo} loading="lazy" className="w-full h-full object-cover" />}
                {portada && tipoDeArchivo(portada) === 'video' && src && <video src={src} controls playsInline preload="metadata" className="w-full h-full object-cover" />}
                {!src && <ImageIcon size={28} className="text-content-3" />}
                {medios.length > 1 && <span className="absolute top-2 right-2"><Badge variant="neutral" size="sm">{medios.length} archivos</Badge></span>}
            </div>
            <div className="p-3 space-y-2 flex-1 flex flex-col min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                    {susMarcas.map((m) => <span key={m.id} className={`w-2 h-2 rounded-full shrink-0 ${puntoDeMarca(m.color)}`} aria-hidden />)}
                    <span className="text-micro text-content-3 truncate">
                        {formatoDe(pieza.formato).label} · {fechaTexto(pieza.fecha, { day: 'numeric', month: 'short' })}
                    </span>
                </div>
                <p className="text-body-sm font-semibold text-content line-clamp-2">{pieza.titulo}</p>
                {texto && <p className="text-caption text-content-2 line-clamp-3 whitespace-pre-wrap">{texto}</p>}
                <p className={`text-caption flex items-center gap-1 ${apta ? 'text-success' : 'text-warning'}`}>
                    {apta ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                    {medios.length === 0 ? 'Sin archivo para descargar'
                        : apta ? (whatsapp.some((w) => w.vertical === false) ? 'Sirve para WhatsApp (no es vertical)' : 'Listo para WhatsApp')
                            : whatsapp.find((w) => !w.apto)?.motivo}
                </p>
                <div className="mt-auto flex flex-wrap gap-2 pt-1">
                    <Button size="sm" icon={Download} loading={ocupado} disabled={!medios.length} onClick={descargar}>Descargar</Button>
                    {texto && <Button size="sm" variant="secondary" icon={Copy} onClick={copiar}>Copiar texto</Button>}
                    {puedeCompartir && medios.length > 0 && (
                        <Button size="sm" variant="secondary" icon={Share2} disabled={ocupado} onClick={compartir}>Compartir</Button>
                    )}
                </div>
                {gestion && (
                    <div className="flex items-center gap-2 pt-2 border-t border-divider">
                        <Store size={14} className="text-content-3" aria-hidden />
                        <span className="text-caption text-content-2 flex-1">
                            {aprobada ? (pieza.liberada ? 'Liberada para las salas' : 'Sin liberar') : 'Se libera al aprobarla'}
                        </span>
                        <Switch checked={!!pieza.liberada} label="Liberada para las salas"
                            disabled={!puedeLiberar || !aprobada} onChange={(on) => onLiberar?.(pieza, on)} />
                    </div>
                )}
            </div>
        </article>
    );
}
