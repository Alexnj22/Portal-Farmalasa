import React from 'react';
import Button from '../common/Button';
import Badge from '../common/Badge';

// Dibuja las piezas con que Saly arma una ayuda (ver `@nucleo/utils/salyAyuda`).
// Llegan ya validadas; acá sólo se pintan. El único marcado de texto es
// `**negrita**`: nunca HTML, venga de la guía escrita o de la IA.

function Texto({ children }) {
    const partes = String(children ?? '').split(/(\*\*[^*]+\*\*)/g);
    return partes.map((p, i) => (p.startsWith('**') && p.endsWith('**')
        ? <b key={i} className="font-bold text-content">{p.slice(2, -2)}</b>
        : <React.Fragment key={i}>{p}</React.Fragment>));
}

const Rotulo = ({ children }) => (
    <p className="text-micro font-black uppercase tracking-widest text-content-3">{children}</p>
);

function Pieza({ p, onIr }) {
    switch (p.tipo) {
        case 'titular':
            return (
                <div>
                    <p className="text-body font-black text-content leading-tight"><Texto>{p.texto}</Texto></p>
                    {p.sub && <p className="mt-0.5 text-caption text-content-3">{p.sub}</p>}
                </div>
            );
        case 'cifras':
            return (
                <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${p.items.length}, minmax(0, 1fr))` }}>
                    {p.items.map((c) => (
                        <div key={c.rotulo} className="saly-cifra min-w-0" data-tono={c.tono}>
                            <Rotulo>{c.rotulo}</Rotulo>
                            <p className={`mt-0.5 truncate text-body font-black tabular-nums ${c.tono === 'mal' ? 'text-danger-text' : 'text-content'}`}>{c.valor}</p>
                        </div>
                    ))}
                </div>
            );
        case 'barras': {
            const max = Math.max(...p.items.map((b) => b.valor), 0) || 1;
            return (
                <div className="grid gap-1.5">
                    {p.items.map((b) => (
                        <div key={b.rotulo} className="grid items-center gap-2" style={{ gridTemplateColumns: '4.5rem 1fr 3.75rem' }}>
                            <span className="truncate text-caption text-content-3">{b.rotulo}</span>
                            <div className="saly-barra" data-medida="dato">
                                <span data-tono={b.tono} style={{ width: `${Math.max(2, (b.valor / max) * 100)}%` }} />
                            </div>
                            <span className="text-right text-caption font-bold tabular-nums text-content">{b.texto}</span>
                        </div>
                    ))}
                </div>
            );
        }
        case 'linea':
            return (
                <div className="flex items-start pt-1">
                    {p.items.map((h, i) => (
                        <div key={`${h.hora}-${i}`} className="relative flex-1 text-center">
                            {i < p.items.length - 1 && <div className="saly-hito-trazo" aria-hidden="true" />}
                            <div className="saly-hito-punto" data-tono={h.tono} aria-hidden="true" />
                            <p className="mt-1.5 text-caption font-black tabular-nums text-content">{h.hora}</p>
                            <p className="text-caption leading-tight text-content-3">{h.texto}</p>
                        </div>
                    ))}
                </div>
            );
        case 'pasos':
            return (
                <ol className="grid gap-2">
                    {p.items.map((t, i) => (
                        <li key={i} className="flex items-start gap-2.5">
                            <span className="saly-paso-num" aria-hidden="true">{i + 1}</span>
                            <span className="pt-px text-body-sm leading-snug text-content-2"><Texto>{t}</Texto></span>
                        </li>
                    ))}
                </ol>
            );
        case 'chips':
            return (
                <div className="flex flex-wrap gap-1.5">
                    {p.items.map((t) => (
                        <Badge key={t} variant="info" size="sm">✓ {t}</Badge>
                    ))}
                </div>
            );
        case 'nota':
            return (
                <p className="flex gap-1.5 text-caption text-content-3">
                    <span aria-hidden="true">ⓘ</span><span><Texto>{p.texto}</Texto></span>
                </p>
            );
        case 'botones':
            return (
                <div className="flex flex-wrap gap-2">
                    {p.items.map((b) => (
                        <Button key={b.texto} variant="secondary" size="sm" onClick={() => onIr?.(b.ir)}>{b.texto}</Button>
                    ))}
                </div>
            );
        default:
            return null;
    }
}

/** Las piezas, con aire entre ellas: lo amontonado era lo que no se leía. */
export default function PiezasDeSaly({ piezas, onIr }) {
    return (
        <div className="grid gap-3">
            {(piezas || []).map((p, i) => <Pieza key={`${p.tipo}-${i}`} p={p} onIr={onIr} />)}
        </div>
    );
}
