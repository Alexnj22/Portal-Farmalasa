import LiquidAvatar from '../../../components/common/LiquidAvatar';
import { shortEmployeeName } from '../../../utils/nameUtils';

// La cara y el nombre de una persona, juntos.
//
// Regla del usuario (2026-08-18): **siempre que se menciona a una persona, sale
// su foto.** Un nombre suelto obliga a saberse quién es cada quien; la cara se
// reconoce de un vistazo desde el otro lado del mostrador, que es donde se usa
// esta pantalla.
//
// `photo || photo_url` y no sólo `photo_url`: el bucket de fotos es privado, así
// que la URL que se puede pintar es la FIRMADA y vive en `photo`; `photo_url` es
// la cruda que se guarda en la base. Con la cruda el `<img>` da 403 — y como
// `photo_url` existe, un ternario tampoco cae en el ícono: queda un círculo
// vacío. Es el mismo bug que ya se corrigió dos veces en esta vista
// (2026-08-15 en el resumen de recepción, y en la propuesta de resolución).
//
// `LiquidAvatar` y no un `<img>` a mano: él resuelve el fallback con las
// iniciales, que es lo que se ve mientras la foto carga y cuando no hay.
// Las clases van enteras y no armadas con `text-${tono}`: Tailwind sólo genera
// las que puede LEER en el fuente, así que una clase compuesta en tiempo de
// ejecución no existe en el CSS y el texto sale sin color.
const TONO = {
    'content-2':   'text-content-2',
    'success-text':'text-success-text',
    'danger-text': 'text-danger-text',
    'content-3':   'text-content-3',
};

export default function EmpChip({ emp, label, prefijo, tono = 'content-2', size = 'sm' }) {
    if (!emp) return null;
    const px = size === 'xs' ? 'w-4 h-4' : 'w-5 h-5';
    return (
        <span className={`inline-flex items-center gap-1.5 text-label font-medium shrink-0 ${TONO[tono] ?? TONO['content-2']}`}>
            {label && <span className="text-content-3 text-caption uppercase tracking-wide">{label}</span>}
            {prefijo && <span className="text-content-3 text-caption">{prefijo}</span>}
            <LiquidAvatar
                src={emp.photo || emp.photo_url}
                alt=""
                fallbackText={shortEmployeeName(emp)}
                className={`${px} rounded-full border border-border-card shadow-sm shrink-0 text-micro`}
            />
            <span className="font-semibold whitespace-nowrap">{shortEmployeeName(emp)}</span>
        </span>
    );
}
