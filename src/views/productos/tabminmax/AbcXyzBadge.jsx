// Extracted from TabMinMax.jsx (Bloque 6.C) — combined ABC×XYZ badge, plain
// text, only C/Z get color.
import { ABC_CFG, XYZ_CFG } from './constants';
import { normXyz } from './helpers';

export default function AbcXyzBadge({ abc, xyz }) {
    const xyzKey = normXyz(xyz);
    const abcColor = abc === 'C' ? 'text-warning' : 'text-content-3';
    const xyzColor = xyzKey === 'Z' ? 'text-danger-text' : 'text-content-3';
    return (
        <span className="font-black tracking-tight shrink-0" title={`${ABC_CFG[abc]?.title ?? ''} · ${XYZ_CFG[xyzKey]?.desc ?? ''}`}>
            <span className={`text-label ${abcColor}`}>{abc || '—'}</span>
            <span className={`text-caption ${xyzColor}`}>{xyzKey || 'X'}</span>
        </span>
    );
}
