import React, { useState } from 'react';
import { Heart, MessageCircle, Send, Bookmark, ThumbsUp, Share2, Image as ImageIcon } from 'lucide-react';
import SegmentedControl from '../../components/common/SegmentedControl';
import { tipoDeArchivo } from '@nucleo/utils/marketing';
import Button from '../../components/common/Button';
import { tintaDeMarca } from './iconos';

const RED = [
    { value: 'instagram', label: 'Instagram' },
    { value: 'facebook', label: 'Facebook' },
];

/**
 * Cómo se vería la pieza en el teléfono, antes de aprobarla: el primer
 * diseño con el copy y los hashtags donde los pone cada red. No es una
 * captura de la red —no imita su marca—: es el orden de lectura (Instagram
 * pone la imagen arriba y el texto abajo; Facebook al revés) y el corte del
 * texto, que es lo que de verdad cambia una decisión.
 *
 * Una historia o un reel se ven verticales (9:16) con el texto encima.
 */
export default function VistaPrevia({ pieza, marca, archivos, firmadas }) {
    const [red, setRed] = useState(() => (pieza?.redes?.includes('facebook') && !pieza?.redes?.includes('instagram') ? 'facebook' : 'instagram'));
    const [entero, setEntero] = useState(false);
    const vertical = ['historia', 'reel'].includes(pieza?.formato);
    const medio = (archivos || []).find((a) => a.url && ['imagen', 'video'].includes(tipoDeArchivo(a)));
    const src = medio ? firmadas?.get?.(medio.url) : null;
    const texto = [pieza?.copy, pieza?.hashtags].filter(Boolean).join('\n\n');
    const corto = texto.length > 125 && !entero;
    const inicial = (marca?.nombre || '?').replace(/^Farmacia\s+/i, '').slice(0, 1).toUpperCase();

    const imagen = (
        <div className={`${vertical ? 'aspect-[9/16]' : 'aspect-square'} bg-surface-input flex items-center justify-center overflow-hidden`}>
            {src && tipoDeArchivo(medio) === 'imagen' && <img src={src} alt="" className="w-full h-full object-cover" />}
            {src && tipoDeArchivo(medio) === 'video' && <video src={src} muted playsInline controls className="w-full h-full object-cover" />}
            {!src && (
                <span className="flex flex-col items-center gap-1 text-content-3">
                    <ImageIcon size={28} />
                    <span className="text-micro">Sin diseño todavía</span>
                </span>
            )}
        </div>
    );

    const cabecera = (
        <div className="flex items-center gap-2 px-3 py-2">
            <span className={`w-7 h-7 rounded-full flex items-center justify-center text-label font-bold ${tintaDeMarca(marca?.color)}`}>
                {inicial}
            </span>
            <div className="min-w-0">
                <p className="text-label font-semibold text-content truncate">{marca?.nombre || 'Marca'}</p>
                {pieza?.pautar && <p className="text-micro text-content-3">Publicidad</p>}
            </div>
        </div>
    );

    const pie = (
        <p className="px-3 pb-3 text-body-sm text-content whitespace-pre-wrap break-words">
            {red === 'instagram' && <strong className="mr-1">{marca?.nombre}</strong>}
            {texto ? (corto ? `${texto.slice(0, 125)}… ` : texto) : <span className="text-content-3">Sin texto todavía</span>}
            {corto && (
                <Button variant="ghost" size="xs" onClick={() => setEntero(true)}>más</Button>
            )}
        </p>
    );

    return (
        <div className="space-y-3">
            <SegmentedControl options={RED} value={red} onChange={setRed} size="sm" label="Red de la vista previa" />
            <div data-surface="card" className="mx-auto w-full max-w-[320px] p-0 overflow-hidden rounded-2xl">
                {cabecera}
                {red === 'facebook' && pie}
                {imagen}
                <div className="flex items-center gap-4 px-3 py-2 text-content-2" aria-hidden>
                    {red === 'instagram'
                        ? <><Heart size={20} /><MessageCircle size={20} /><Send size={20} /><Bookmark size={20} className="ml-auto" /></>
                        : <><ThumbsUp size={18} /><MessageCircle size={18} /><Share2 size={18} /></>}
                </div>
                {red === 'instagram' && pie}
            </div>
            <p className="text-caption text-content-3 text-center">
                El texto se corta a ~125 caracteres en la red: lo importante va al principio.
            </p>
        </div>
    );
}
