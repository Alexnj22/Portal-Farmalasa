import {
  FileText, IdCard, User, HeartPulse, AlertCircle, Paperclip, Calendar,
  TrendingUp, ArrowRightLeft, Building2, Watch, LogOut, GraduationCap, ClipboardList, DollarSign, RefreshCw
} from 'lucide-react';
import { normalizeText } from '../utils/helpers';



// Bucket B categórico (tipos de evento) salvo TERMINATION, que es Bucket A
// (severidad real — es un desenlace negativo/definitivo, no una categoría
// más entre pares).
export const EVENT_TYPES = {
  VACATION: { label: 'Vacaciones', color: 'bg-success/10 text-success-text', icon: Calendar, requiresDuration: true, defaultDocType: 'MEMO' },
  DISABILITY: { label: 'Incapacidad médica', color: 'bg-chart-6/10 text-chart-6-text', icon: HeartPulse, requiresDuration: true, defaultDocType: 'MEDICAL' },
  PERMIT: { label: 'Permiso / Licencia', color: 'bg-warning/10 text-warning-text', icon: ClipboardList, requiresDuration: true, defaultDocType: 'MEMO' },
  PROMOTION: { label: 'Cambio de cargo', color: 'bg-chart-3/10 text-chart-3-text', icon: TrendingUp, requiresDuration: false, requiresNewRole: true, defaultDocType: 'CONTRACT' },
  SALARY: { label: 'Ajuste salarial', color: 'bg-success/10 text-success-text', icon: DollarSign, requiresDuration: false, requiresNewCode: false, defaultDocType: 'OTHER' },
  TRANSFER: { label: 'Traslado de sucursal', color: 'bg-chart-1/10 text-chart-1-text', icon: ArrowRightLeft, requiresDuration: false, requiresTargetBranch: true, defaultDocType: 'MEMO' },
  SUPPORT: { label: 'Apoyo temporal', color: 'bg-chart-4/10 text-chart-4-text', icon: Building2, requiresDuration: true, requiresTargetBranch: true, defaultDocType: 'MEMO' },
  CODE_CHANGE: { label: 'Cambio de código/ID', color: 'bg-chart-3/10 text-chart-3-text', icon: IdCard, requiresDuration: false, requiresNewCode: true, defaultDocType: 'OTHER' },
  INDUCTION: { label: 'Inducción', color: 'bg-chart-9/10 text-chart-9-text', icon: GraduationCap, requiresDuration: true, defaultDocType: 'OTHER' },
  SHIFT_CHANGE: { label: 'Cambio de turno', color: 'bg-chart-9/10 text-chart-9-text', icon: Watch, requiresDuration: false, defaultDocType: 'MEMO' },
  TERMINATION: { label: 'Liquidación/Renuncia', color: 'bg-danger text-white', icon: LogOut, requiresDuration: false, defaultDocType: 'CONTRACT' },
  REHIRE: { label: 'Recontratación', color: 'bg-success/10 text-success-text', icon: RefreshCw, requiresDuration: false, defaultDocType: 'CONTRACT' },
};


// ════════════════════════════════════════════════════════════════════════════
// Catálogos cuya CLAVE es el dato y cuyo rótulo es sólo texto de pantalla.
//
// Es la forma sana, la misma de `EVENT_TYPES` de arriba: lo que se guarda es la
// clave (`RENUNCIA`, `PERMISOS`), así que el rótulo se puede reescribir sin
// tocar una sola fila. Antes estos dos catálogos guardaban el rótulo —
// `value === label`—, o sea que corregir una mayúscula desincronizaba lo
// guardado de lo que el código busca. Ver «un rótulo no es una clave» en
// `CLAUDE.md` y `docs/PLAN-CATALOGOS-QUE-SON-SU-PROPIO-ROTULO.md`.
// ════════════════════════════════════════════════════════════════════════════

// Motivo legal de baja → `employee_events.metadata.terminationReason`.
// `SIN`/`CON` van en mayúsculas a propósito: son dos opciones que se distinguen
// por esa sola palabra y de otro modo se leen casi iguales.
export const TERMINATION_REASONS = {
  RENUNCIA: { label: 'Renuncia voluntaria' },
  DESPIDO_SIN_RESPONSABILIDAD: { label: 'Despido SIN responsabilidad' },
  DESPIDO_CON_RESPONSABILIDAD: { label: 'Despido CON responsabilidad' },
  ABANDONO: { label: 'Abandono de trabajo' },
};

// Tipo de incapacidad → `employee_events.metadata.disabilityType`.
//
// Éste es el caso más traicionero de los tres: su `value` NO era igual al
// `label` (el label agrega la aclaración entre paréntesis), así que un filtro
// que busque `value === label` no lo encuentra — y sin embargo el valor era un
// rótulo en Title Case que además se compara por igualdad para decidir los
// **112 días del Art. 309**. Reescribir ese texto no desincronizaba una lista:
// apagaba la regla de maternidad, en silencio.
export const DISABILITY_TYPES = {
  ENFERMEDAD_COMUN: { label: 'Enfermedad común (padecimiento o embarazo)' },
  RIESGO_PROFESIONAL: { label: 'Riesgo profesional (accidente laboral)' },
  MATERNIDAD: { label: 'Maternidad (16 semanas por ley)' },
};

// Categoría de un documento del expediente de sucursal →
// `branches.settings.customDocs[].category`. El orden es el de las secciones de
// `TabExpediente`, y el primero es el valor por omisión del formulario.
// `Recursos Humanos` conserva las mayúsculas: es el nombre del departamento.
export const CATEGORIAS_DOCUMENTO = {
  PERMISOS: { label: 'Permisos y licencias' },
  RRHH: { label: 'Recursos Humanos' },
  OPERATIVO: { label: 'Operativo y logística' },
  LEGALES: { label: 'Documentos legales' },
  FISCAL: { label: 'Fiscal y financiero' },
  OTRO: { label: 'Otro' },
};

/** Opciones de `LiquidSelect` a partir de un catálogo clave → { label }. */
export const opcionesDeCatalogo = (catalogo) =>
  Object.entries(catalogo).map(([value, { label }]) => ({ value, label }));

// `normalizeText` ya quita tildes y baja a minúsculas; acá se le suma el
// colapso de espacios, que es lo que hace falta para cruzar rótulos escritos a
// mano. Se reusa en vez de repetir el rango de diacríticos: escrito de nuevo,
// una de las dos copias se queda vieja.
const normalizarRotulo = (s) => normalizeText(s).replace(/\s+/g, ' ');

/**
 * Resuelve la categoría guardada de un documento a su clave.
 *
 * Acepta la clave (lo que se guarda desde hoy) y también el rótulo con el que
 * se guardaba antes, con o sin tildes y con cualquier mayúscula — la misma
 * tolerancia que `buscarCargo` en `src/utils/roles.js`, y por el mismo motivo.
 * Lo que no reconoce cae en `OTRO`, que es una sección que sí se pinta: un
 * documento mal categorizado se ve, uno sin sección desaparece de la pantalla.
 */
export function categoriaDeDocumento(valor) {
  if (CATEGORIAS_DOCUMENTO[valor]) return valor;
  const buscado = normalizarRotulo(valor);
  if (!buscado) return 'OTRO';
  const porRotulo = Object.entries(CATEGORIAS_DOCUMENTO)
    .find(([, { label }]) => normalizarRotulo(label) === buscado);
  return porRotulo ? porRotulo[0] : 'OTRO';
}

// Los rótulos con los que se guardaba el tipo de incapacidad antes de v2.590.5.
// Van escritos, no derivados de `label`: el label de hoy trae la aclaración
// entre paréntesis y nunca fue igual al valor guardado, así que no hay de dónde
// deducirlos. Es el puente de vuelta y por eso es una lista cerrada.
const TIPO_INCAPACIDAD_LEGADO = {
  'enfermedad comun': 'ENFERMEDAD_COMUN',
  'riesgo profesional': 'RIESGO_PROFESIONAL',
  'maternidad': 'MATERNIDAD',
};

/**
 * Resuelve el tipo de incapacidad guardado a su clave, o `null`.
 *
 * A diferencia de `categoriaDeDocumento` acá NO hay valor de respaldo: el tipo
 * decide los 112 días del Art. 309, y adivinarlo mal es peor que no saberlo.
 * Quien la llama decide qué hacer con el `null` — el formulario deja el
 * selector vacío y obliga a elegir.
 */
export function tipoDeIncapacidad(valor) {
  if (DISABILITY_TYPES[valor]) return valor;
  const buscado = normalizarRotulo(valor);
  if (!buscado) return null;
  if (TIPO_INCAPACIDAD_LEGADO[buscado]) return TIPO_INCAPACIDAD_LEGADO[buscado];
  const porRotulo = Object.entries(DISABILITY_TYPES)
    .find(([, { label }]) => normalizarRotulo(label) === buscado);
  return porRotulo ? porRotulo[0] : null;
}

// El estado de quien no tiene cargo ni sucursal. Es texto de PANTALLA, no un
// dato: `employees` no tiene columna `role` —el store la deriva de `role_id` y
// `updateEmployee` la borra del payload antes de escribir—, así que este rótulo
// no viaja a ninguna tabla salvo la bitácora, que es para leerse. Vivía escrito
// a mano en once lugares, que es exactamente como se desincroniza.
export const SIN_ASIGNAR = 'Sin asignar';


export const WEEK_DAYS = [
  { id: 1, name: 'Lunes' }, { id: 2, name: 'Martes' }, { id: 3, name: 'Miércoles' }, { id: 4, name: 'Jueves' },
  { id: 5, name: 'Viernes' }, { id: 6, name: 'Sábado' }, { id: 0, name: 'Domingo' },
];




