// Extracted from TabMinMax.jsx (Bloque 6.C) — combined ABC×XYZ badge, plain
// text, only C/Z get color.
import { ABC_CFG, XYZ_CFG } from './constants';
import { normXyz } from './helpers';

export default function AbcXyzBadge({ abc, xyz }) {
    const xyzKey = normXyz(xyz);
    const abcColor = abc === 'C' ? 'text-amber-600' : 'text-slate-500';
    const xyzColor = xyzKey === 'Z' ? 'text-rose-500' : 'text-slate-500';
    return (
        <span className="font-black tracking-tight shrink-0" title={`${ABC_CFG[abc]?.title ?? ''} · ${XYZ_CFG[xyzKey]?.desc ?? ''}`}>
            <span className={`text-[11px] ${abcColor}`}>{abc || '—'}</span>
            <span className={`text-[10px] ${xyzColor}`}>{xyzKey || 'X'}</span>
        </span>
    );
}
