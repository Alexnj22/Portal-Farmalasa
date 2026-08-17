import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Badge from '../components/common/Badge';
import { MODULE_GROUPS, pestanasDe, capacidadesDe } from '../constants/permissionModules';
import SegmentedControl from '../components/common/SegmentedControl';
import FilterBar from '../components/common/FilterBar';
import ViewTabBar from '../components/common/ViewTabBar';
import { EmptyState } from '../components/common/StateViews';
import Button from '../components/common/Button';
import {
    ShieldCheck, Monitor, Calendar, Building2, Megaphone, ClipboardList,
    Palmtree, Activity, AlertTriangle, User, Eye, Pencil, CheckCircle2,
    Lock, Unlock, Save, RotateCcw, ChevronRight, Loader2, Check, X,
    ShieldAlert, Info, Home, Bell, FolderOpen, Zap, Copy, Search, SearchX, MousePointerClick,
    TrendingUp, Briefcase, CalendarDays, PieChart,
    BarChart2, UserX, Clock, Gift, DollarSign, FileText, Package, Receipt, Target, FlaskConical, Smartphone,
    Sparkles, Layers, Globe2, BadgeAlert, PackageMinus, ShoppingCart, ClipboardCheck, RadioTower, Ghost, Truck
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import GlassViewLayout from '../components/GlassViewLayout';
import LiquidSelect from '../components/common/LiquidSelect';
import PortalInput from '../components/common/PortalInput';
import ConfirmModal from '../components/common/ConfirmModal';
import { smartFilter } from '../utils/searchUtils';
import { useStaffStore as useStaff } from '../store/staffStore';
import Switch from '../components/common/Switch';
import LiquidTooltip from '../components/common/LiquidTooltip';
import {
    fetchRolesForPermissions, fetchRolePermissions, upsertRolePermission, upsertRolePermissionsBulk,
    updateRoleMaxPriceLevel, updateRoleIsSU, updateRoleIdleLimit,
} from '../data/permissions';
import { useToastStore } from '../store/toastStore';

// ─── Módulos del sistema agrupados por función ─────────────────────────────
// MODULE_GROUPS vive en constants/permissionModules.js (lo comparte MaintenanceView).

// Lista plana completa (incluye los sub-permisos: pestañas Y capacidades) para
// operaciones bulk (activate all, copy from). `isTab` conserva el nombre viejo
// porque lo único que expresa es "no es un módulo principal".
const MODULES = MODULE_GROUPS.flatMap(g =>
    g.modules.flatMap(m => [m, ...(m.sub || []).map(s => ({ key: s.key, hasApprove: false, isTab: true }))])
);
/* ─── El orden de las tarjetas dentro de un grupo ───────────────────────────
 *
 * Por lo ALTO QUE PUEDEN LLEGAR A SER, no por si están encendidas hoy.
 *
 * Apagadas se ven todas parejas; el desorden aparece al encenderlas, porque
 * unas crecen muchísimo —alcance, pestañas, capacidades— y otras no crecen
 * nada. Mezcladas, una alta al lado de una corta deja un hueco debajo de la
 * corta, y la grilla queda con dientes.
 *
 * Ordenar por «activa» no alcanzaba y era peor: el orden cambiaba con cada
 * clic. Esto es una propiedad FIJA del módulo, se saca del registro, y por eso
 * las tarjetas no se mueven nunca — se enciendan o se apaguen.
 *
 * Los pesos son los bloques que la tarjeta agrega, no píxeles medidos: lo único
 * que importa es el ORDEN relativo, y a esa escala un bloque es un bloque. */
const pesoDe = (m) => (m.hasScope ? 2 : 0)
                    + (m.hasApprove ? 1 : 0)
                    + (m.sub || []).length;

/* Estable: dentro del mismo peso se conserva el orden del registro, que es el
 * que alguien pensó. `sort` muta, así que se copia — `g.modules` es compartido
 * por toda la pantalla. */
const ordenar = (mods) =>
    [...mods].sort((a, b) => pesoDe(b) - pesoDe(a));

// Solo módulos principales (sin sub-permisos) para estadísticas y conteos
const MAIN_MODULES = MODULES.filter(m => !m.isTab);

// módulo → sus sub-permisos. Lo necesita el apagado en cascada: quitarle "Ver" a
// un módulo tiene que apagar también sus pestañas y capacidades.
//
// Por qué no basta con esconderlas: la tarjeta ya no las dibuja cuando el módulo
// está apagado, así que quedaban encendidas en la base y sin forma de verlas
// desde la pantalla. La auditoría del 2026-08-03 encontró 38 filas así, en 16
// cargos. En Productos era inofensivo porque la ruta bloquea la vista entera,
// pero el mecanismo no distingue: `purchase_receipts_select` mira
// `minmax_ver_costos` SIN consultar al módulo padre, así que apagar Min/Max no
// le quitaba el costo de compra a nadie.
/* ─── El cuadro de «decidir» de la bandeja de sucursal ──────────────────────
 *
 * «Solicitudes de sucursal → Aprobar» es el MAESTRO de las cuatro familias que
 * se decidieron por separado en v2.576.0. Pedido del usuario: «que si se activa
 * desde el interruptor general se active allá y al revés».
 *
 * Semántica, copiada tal cual del vínculo widgets↔«Inicio» (2026-08-07) para no
 * inventar un concepto nuevo: el maestro está encendido si hay AL MENOS UNA
 * familia encendida. Encenderlo las enciende todas, apagarlo las apaga todas, y
 * encender o apagar una sola arrastra al maestro cuando corresponde.
 *
 * `traslados` y `minmax` entran aunque vivan en su propio módulo: en la
 * pantalla el usuario ve un cuadro de cuatro, y que el maestro gobierne sólo
 * dos de ellas sería peor que no gobernar ninguna. */
const HIJOS_DE_APROBAR = ['requests_facturacion', 'requests_inventario',
                          'requests_minmax', 'traslados'];

const SUBS_DE = Object.fromEntries(
    MODULE_GROUPS.flatMap(g => g.modules.map(m => [m.key, (m.sub || []).map(s => s.key)])),
);

// El cargo elegido usa UN acento, siempre el mismo. Antes había una paleta de 7
// colores repartida cíclicamente por índice (`ROLE_COLORS[idx % 7]`), así que
// con 25 cargos la columna era un arcoíris donde el color no decía nada: el
// tono de "Regente" contra el de "Auxiliar de Bodega" no significaba ninguna
// diferencia entre los dos cargos, solo su posición en la lista.
//
// El registro `product` de PRODUCT.md lo dice al derecho: el acento es para la
// acción primaria, la selección actual y los indicadores de estado — no para
// decorar. Acá quedan dos usos, y los dos informan:
//   · chart-1  → este cargo es el que estás editando
//   · warning  → este cargo es Super Usuario (acceso irrestricto)
const SELECCION = {
    icono:  'from-chart-1 to-brand',
    texto:  'text-chart-1-text',
    fondo:  'bg-chart-1/10',
    borde:  'border-chart-1/30',
};
const SUPER_USUARIO = {
    icono:  'from-warning to-chart-4',
    texto:  'text-warning-text',
    fondo:  'bg-warning/10',
    borde:  'border-warning/30',
};

const PERMISSION_TYPES = [
    { key: 'can_view',    label: 'Ver',                          icon: Eye,          activeColor: 'bg-chart-1'    },
    { key: 'can_edit',    label: 'Gestionar',                    icon: Pencil,       activeColor: 'bg-chart-3'  },
    { key: 'can_approve', label: 'Aprobar',                      icon: CheckCircle2, activeColor: 'bg-success' },
    // Acá vivía «Delegar si no está», y estaba mal puesto: se dibujaba en las
    // 77 tarjetas, incluidas «Mi perfil» y «Mis documentos», donde delegar no
    // significa nada — eso es de cada persona, no trabajo que siga sin ella.
    // Reportado por el usuario: «no tiene sentido y no es lo que había pedido».
    //
    // Va en la tarjeta aparte de «Decidir solicitudes», junto a los cuatro
    // selectores que gobierna. La columna `role_permissions.delega_en_ausencia`
    // y toda la lógica de Postgres siguen vivas y probadas: falta esa tarjeta.
];

// El tono por opción NO es adorno: distingue "Todos" de "Mi sucursal" de un
// vistazo en una pantalla llena de toggles.
// «Sólo míos» se agregó el 2026-08-10 (pedido del usuario) junto con el centro
// de solicitudes: hay módulos donde el escalón más chico no es la sucursal sino
// la propia persona — quien puede mandar una solicitud personal pero no tiene
// por qué ver la de su compañero.
//
// El valor NO tiene CHECK en `role_permissions.scope` (verificado), así que
// agregarlo no rompe filas viejas: las 1,320 existentes son ALL o BRANCH y
// siguen leyéndose igual. Lo que sí hay que hacer al usarlo es enseñarle a la
// policy qué significa — una policy que sólo distingue ALL de «lo demás» trata
// MINE como BRANCH y abre de más.
const SCOPE_OPTIONS = [
    { value: 'ALL',    label: 'Todos',       tone: 'chart-3' },
    { value: 'BRANCH', label: 'Mi sucursal', tone: 'chart-9' },
    { value: 'MINE',   label: 'Sólo míos',   tone: 'chart-4' },
];

// Tooltip descriptivo por tipo de permiso
const PERM_DESC = {
    can_view:    'Puede ver y consultar este módulo',
    can_edit:    'Puede crear, editar y eliminar registros en este módulo',
    can_approve: 'Puede aprobar o rechazar solicitudes',
    delega_en_ausencia:
        'Si quienes tienen este cargo están de vacaciones o incapacitados, su jefe '
        + 'inmediato se hace cargo de este módulo mientras dure la ausencia. Se apaga solo al volver',
};

// ─── Toggle — alias del canónico (A14, 2026-07-27) ─────────────────────────
// Era el tercero de los tres switches locales que competían en el proyecto.
// Se conserva el nombre y la firma (`value`/`color`) por los 3 call sites de
// este archivo, que traen el color desde el config de PERM_TYPES.
const Toggle = ({ value, onChange, color = 'chart-1', disabled = false, size = 'md' }) => (
    <Switch checked={!!value} onChange={onChange} variant={color}
        disabled={disabled} size={size === 'lg' ? 'md' : 'sm'} />
);

/* ─── Tarjeta «Decidir solicitudes» ─────────────────────────────────────────
 *
 * Los cuatro selectores de quién resuelve cada clase de solicitud, juntos en UNA
 * tarjeta. Diseño pedido y aprobado por el usuario el 2026-08-12, después de dos
 * intentos que no eran: tres tarjetas sueltas primero, y un interruptor de
 * delegación repetido en las 77 tarjetas después.
 *
 * Por qué una tarjeta aparte y no cuatro repartidas: las cuatro contestan LA
 * MISMA pregunta —«¿qué puede decidir este cargo?»— y separadas obligan a
 * recorrer la pantalla para responderla. Juntas se lee de un vistazo, y el
 * maestro tiene dónde vivir.
 *
 * Traslados y Min/Max se muestran acá **y siguen teniendo su propia tarjeta**
 * con sus otros permisos: su «Aprobar» es el mismo dato visto desde dos lados,
 * no dos datos. Encenderlo en cualquiera de los dos lo enciende en el otro —de
 * eso se encarga la cascada de `handleToggle`—, y por eso no se duplica en la
 * base: es una sola fila.
 */
const FAMILIAS_DECIDIR = [
    { key: 'requests_facturacion', label: 'Facturación', desc: 'Anular una factura, o cambiarle el pago, el vendedor o el cliente' },
    { key: 'requests_inventario',  label: 'Inventario',  desc: 'Cargas y descartes de existencia' },
    { key: 'requests_minmax',      label: 'Min / Max',   desc: 'Ajustes de stock mínimo y máximo' },
    { key: 'traslados',            label: 'Traslados',   desc: 'Confirmar el envío de producto que otra sala pide' },
];

// ── Cuánto aguanta una sesión sin que nadie la use ───────────────────────────
//
// Campo libre y no una escala de píldoras (pedido del usuario, 2026-08-17):
// cinco minutos, veinte o dos horas dependen de cómo trabaja cada sala, y una
// escala fija obliga a elegir el valor más cercano al que uno quería.
//
// Se guarda al SALIR del campo o con Enter, no en cada tecla: escribir «120»
// pasa por «1» y por «12», y guardar eso dejaría el cargo en un minuto —por
// debajo del piso— o en doce, que nadie pidió.
const MIN_INACTIVIDAD = 5;
const MAX_INACTIVIDAD = 1440;

// El mismo número dicho como lo diría una persona. Sirve de confirmación: quien
// escribe 240 quiere leer «4 horas» antes de irse del campo.
const enPalabras = (min) => {
    if (!Number.isFinite(min)) return '';
    if (min < 60) return `${min} minutos`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    const horas = h === 1 ? '1 hora' : `${h} horas`;
    return m ? `${horas} y ${m} min` : horas;
};

const TarjetaTiempoDeInactividad = ({ minutos, onChange, locked }) => {
    const [texto, setTexto] = useState(String(minutos));

    // Al cambiar de cargo el campo tiene que mostrar el del cargo nuevo. Sin
    // esto quedaba el número tecleado para el anterior — el mismo modo de falla
    // que un formulario que no se reinicia al cambiar de ficha.
    useEffect(() => { setTexto(String(minutos)); }, [minutos]);

    const n = parseInt(texto, 10);
    const valido = Number.isFinite(n) && n >= MIN_INACTIVIDAD && n <= MAX_INACTIVIDAD;

    const confirmar = () => {
        if (!valido) { setTexto(String(minutos)); return; }   // se descarta y vuelve al guardado
        if (n !== minutos) onChange(n);
    };

    return (
        // Misma anatomía que la tarjeta de Super Usuario —ícono de 9, `p-3.5`,
        // título `body-sm`— para que las tres de la fila midan lo mismo. Antes
        // esta llevaba ícono de 11 y un párrafo de tres renglones explicando el
        // aviso previo: al estar en una rejilla `items-stretch`, ese párrafo le
        // fijaba el alto a TODA la fila y dejaba a Super Usuario con la mitad
        // vacía. La explicación no se perdió, vive donde se necesita —debajo del
        // campo— y en una línea.
        <div data-surface="card" className="rounded-2xl border border-border-card p-3.5 h-full flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-chart-3 to-chart-6 flex items-center justify-center flex-shrink-0">
                    <Clock size={15} className="text-white" strokeWidth={2} />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-body-sm font-black text-content-2 leading-tight">Cerrar sesión sin uso</p>
                    <p className="text-micro text-content-3 font-medium mt-0.5 leading-snug">
                        Hoy: <span className="font-black text-content-2">{enPalabras(minutos)}</span> · avisa 1 min antes
                    </p>
                </div>
            </div>

            <PortalInput
                type="number"
                label="Minutos sin tocar el portal"
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onBlur={confirmar}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                readOnly={locked}
                min={MIN_INACTIVIDAD}
                max={MAX_INACTIVIDAD}
                hasError={!!texto && !valido}
                errorMessage={`Entre ${MIN_INACTIVIDAD} y ${MAX_INACTIVIDAD} minutos`}
                helperText={valido && n !== minutos
                    ? `Se guardará como ${enPalabras(n)}`
                    : 'No aplica al teléfono con la aplicación instalada'}
            />
        </div>
    );
};

const TarjetaDecidirSolicitudes = ({ roleId, permissions, onChange, onDelegar, locked, saving, roles = [], employees = [] }) => {
    const perm = (k) => permissions[`${roleId}:${k}`] || {};
    const encendidas = FAMILIAS_DECIDIR.filter(f => perm(f.key).can_approve).length;
    const total = FAMILIAS_DECIDIR.length;
    const delegando = FAMILIAS_DECIDIR.some(f => perm(f.key).delega_en_ausencia)
                   || perm('requests').delega_en_ausencia;
    const resumen = encendidas === 0 ? 'No decide ninguna'
                  : encendidas === total ? 'Decide todas'
                  : `Decide ${encendidas} de ${total}`;

    // A quién le llegan estos permisos cuando el interruptor está encendido.
    // Sin esto, «Delegar» reparte facultades a alguien que no se nombra en
    // ningún lado de la pantalla, y una delegación anónima no se puede auditar.
    const nombresDe = (lista) => lista.map(e => e.name).filter(Boolean);
    const cargoPadreId = roles.find(r => String(r.id) === String(roleId))?.parent_role_id ?? null;
    const activos = employees.filter(e => e.status === 'ACTIVO');
    const porOrganigrama = nombresDe(activos.filter(e => String(e.role_id) === String(cargoPadreId)));
    const conSuplente = activos
        .filter(e => String(e.role_id) === String(roleId) && e.suplente_id)
        .map(e => ({
            titular: e.name,
            suplente: activos.find(s => String(s.id) === String(e.suplente_id))?.name,
        }))
        .filter(p => p.suplente);
    const listar = (arr) => arr.length <= 1 ? (arr[0] || '')
        : `${arr.slice(0, -1).join(', ')} y ${arr[arr.length - 1]}`;

    return (
        // `md:col-span-3`: el comentario de donde se usa decía «a lo ancho de las
        // tres columnas» desde que se escribió, y nunca lo estuvo — quedaba en
        // una columna con dos vacías al lado. Son cuatro píldoras y dos mandos:
        // apretados en un tercio no se leen.
        <div data-surface="card" className="rounded-2xl border border-border-card p-3.5 h-full md:col-span-3">
            <div className="flex items-center gap-2.5 mb-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-success to-chart-1 flex items-center justify-center flex-shrink-0">
                    <CheckCircle2 size={15} className="text-white" strokeWidth={2} />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-body-sm font-black text-content-2 leading-tight">Decidir solicitudes</p>
                    <p className="text-micro text-content-3 font-medium mt-0.5 leading-snug truncate">
                        Hoy: <span className="font-black text-content-2">{resumen}</span>
                    </p>
                </div>
            </div>

            {/* Los dos mandos que gobiernan la fila entera. En una columna
                angosta ya no caben junto al título, así que bajan acá; siguen
                aparte de las píldoras porque no son una familia más. */}
            <div className="flex items-center justify-between gap-3 mb-2.5">
                <div className="flex items-center gap-2">
                    <span className="text-caption font-black uppercase tracking-widest text-content-3">Todas</span>
                    {/* Encendido SÓLO cuando están las cuatro. Con «algunas» decía
                        que sí, y entonces un clic las apagaba todas: para completar
                        el juego había que apretarlo dos veces. Medido con un clic
                        real el 2026-08-13 partiendo de «Decide 1 de 4». El estado
                        intermedio lo cuenta el renglón de arriba («Decide 1 de 4»),
                        que es donde se lee, no en un interruptor de dos posiciones. */}
                    <Toggle value={encendidas === total} color="success" disabled={locked}
                        onChange={(v) => onChange('requests', 'can_approve', v)} />
                </div>
                <LiquidTooltip content="Mientras alguien de este cargo esté de vacaciones o incapacitado, sus decisiones las resuelve el suplente que haya elegido en su ficha; si no eligió a nadie —o el cargo entero está ausente— se hace cargo quien esté arriba en el organigrama. Se apaga solo al volver.">
                    <div className="flex items-center gap-2">
                        <span className="text-caption font-black uppercase tracking-widest text-content-3">Delegar</span>
                        <Toggle value={delegando} color="chart-4" disabled={locked}
                            onChange={(v) => onDelegar(roleId, v)} />
                    </div>
                </LiquidTooltip>
            </div>

            {/* Con el interruptor encendido hay que decir A QUIÉN le llegan estas
                decisiones. Es la corrección de fondo: la delegación se decide en
                esta tarjeta pero se cobra en la cuenta de otra persona, que hasta
                acá no aparecía escrita en ninguna parte de la pantalla. */}
            {delegando && (
                <div className="mb-2.5 space-y-1">
                    {conSuplente.map(p => (
                        <p key={p.titular} className="flex items-start gap-1 text-caption text-content-3 font-medium leading-snug">
                            <ChevronRight size={12} className="text-chart-4-text mt-0.5 flex-shrink-0" strokeWidth={3} />
                            <span>A <span className="font-black text-content-2">{p.titular}</span> lo cubre <span className="font-black text-content-2">{p.suplente}</span></span>
                        </p>
                    ))}
                    {porOrganigrama.length > 0 ? (
                        <p className="flex items-start gap-1 text-caption text-content-3 font-medium leading-snug">
                            <ChevronRight size={12} className="text-chart-4-text mt-0.5 flex-shrink-0" strokeWidth={3} />
                            <span>{conSuplente.length > 0 ? 'Del resto se hace cargo' : 'Se hace cargo'} <span className="font-black text-content-2">{listar(porOrganigrama)}</span></span>
                        </p>
                    ) : (
                        <p className="flex items-start gap-1 text-caption text-warning-text font-medium leading-snug">
                            <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" strokeWidth={3} />
                            <span>{conSuplente.length > 0 ? 'Del resto no se hace cargo nadie: ' : 'No se hace cargo nadie: '}
                                arriba de este cargo no hay ninguna persona activa. Elige un suplente en la ficha de cada quien.</span>
                        </p>
                    )}
                </div>
            )}

            {/* Las cuatro, con el MISMO control que los sub-permisos de cada
                tarjeta: fila con rótulo y `Toggle`, en una caja que se tiñe al
                encender. Antes eran píldoras escritas a mano acá — un tercer
                lenguaje en una pantalla que ya tenía dos, y ninguno de los dos
                era ése. Reportado por el usuario: «¿por qué no son canónicos?».
                No se usa `SegmentedControl` porque ahí se elige UNA de N y acá
                se encienden las que sean: es otro control, no otro estilo. */}
            <div className="space-y-1.5">
                {FAMILIAS_DECIDIR.map(f => {
                    const on = !!perm(f.key).can_approve;
                    return (
                        <LiquidTooltip key={f.key} content={f.desc}>
                            <div data-surface={on ? undefined : 'card'}
                                className={`flex items-center justify-between gap-3 px-2.5 py-1.5 rounded-xl border transition-all duration-[var(--dur-slow)] ${on ? 'bg-success/10 border-success/30' : ''}`}>
                                <span className={`text-caption font-bold transition-colors duration-[var(--dur-slow)] ${on ? 'text-content-2' : 'text-content-3'}`}>
                                    {f.label}
                                </span>
                                <div className="flex items-center gap-1.5">
                                    {saving[`${roleId}:${f.key}`] && <Loader2 size={9} className="text-content-3 animate-spin" />}
                                    <Toggle value={on} color="bg-success" disabled={locked}
                                        onChange={(v) => onChange(f.key, 'can_approve', v)} />
                                </div>
                            </div>
                        </LiquidTooltip>
                    );
                })}
            </div>
        </div>
    );
};

// ─── Módulo card ────────────────────────────────────────────────────────────
const ModuleCard = ({ module, perms, onChange, locked, saving, flash, tabs, tabPerms, tabSaving, onTabChange }) => {
    const ModIcon = module.icon;
    const hasAnyPerm = perms.can_view || perms.can_edit || perms.can_approve;
    const currentScope = perms.scope || 'ALL';
    const isComing = !!module.comingSoon;
    const [flashedPerm, setFlashedPerm] = useState(null);

    const handlePerm = (key, permType, v) => {
        onChange(key, permType, v);
        setFlashedPerm(permType);
        setTimeout(() => setFlashedPerm(null), 500);
    };

    return (
        <div className={`rounded-3xl border transition-all duration-[var(--dur-lento)] ease-out ${
            isComing
                ? 'bg-surface-card border-border-card opacity-40 select-none'
                : hasAnyPerm
                    ? `bg-surface-card border-border-card
                       shadow-[var(--shadow-glass-2)]
                       hover:shadow-[var(--shadow-glass-4)]
                       hover:translate-y-[var(--lift-card)] hover:scale-[1.018] hover:bg-surface-card
                       ${flash ? 'ring-2 ring-chart-1/45 shadow-[var(--shadow-glass-3)]' : ''}`
                    /* Sin acceso. NO se usa opacidad sobre la tarjeta entera: eso
                       bajaba el texto junto con el fondo y dejaba el nombre y la
                       descripción por debajo del contraste AA que fija PRODUCT.md.
                       El estado se comunica con la superficie y el borde; las
                       letras se leen igual que en una tarjeta encendida. */
                    : 'bg-surface-card-hover/40 border-divider shadow-[var(--shadow-shine)] hover:translate-y-[var(--lift-card)] hover:bg-surface-card'
        }`}>
            <div className="p-4">
                {/* Header */}
                <div className="flex items-start gap-3 mb-3.5">
                    <div data-surface={hasAnyPerm ? undefined : 'card'} className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-all duration-[var(--dur-lento)] ${hasAnyPerm ? 'bg-gradient-to-br from-brand to-brand-purple text-white shadow-[var(--shadow-glow-brand)] scale-100' : 'text-content-3 scale-90'}`}>
                        <ModIcon size={15} strokeWidth={2} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                            {/* `text-content-2` y no `-3` en el estado apagado: el nombre
                                del módulo es lo que se busca al recorrer la pantalla,
                                también —sobre todo— entre los que el cargo NO tiene. */}
                            <p className={`text-body-sm font-black leading-tight transition-colors duration-[var(--dur-slow)] ${hasAnyPerm ? 'text-content' : 'text-content-2'}`}>
                                {module.label}
                            </p>
                            {saving && <Loader2 size={10} className="text-content-3 animate-spin flex-shrink-0" />}
                        </div>
                        <p className="text-caption text-content-3 font-medium mt-0.5 leading-snug line-clamp-2">{module.desc}</p>
                    </div>
                </div>

                {/* Toggles */}
                <div className={`rounded-xl p-2.5 space-y-1.5 border transition-all duration-[var(--dur-slow)] ${
                    hasAnyPerm
                        ? 'bg-surface-card border-border-card shadow-[var(--shadow-shine)]'
                        : 'bg-surface-card border-border-card'
                }`}>
                    {PERMISSION_TYPES.map(pt => {
                        if (pt.key === 'can_approve' && !module.hasApprove) return null;
                        /* Los módulos que SÓLO son un permiso de decisión no
                         * abren pantalla: dibujarles Ver y Gestionar sería
                         * ofrecer dos interruptores que no gobiernan nada. */
                        if (module.soloAprobar && (pt.key === 'can_view' || pt.key === 'can_edit')) return null;
                        const PtIcon = pt.icon;
                        const val = !!perms[pt.key];
                        /* «Sin Ver no hay Gestionar ni Aprobar» — salvo en los
                         * módulos que no tienen Ver, donde la regla dejaría
                         * Aprobar apagado para siempre. Y la delegación queda
                         * fuera: no es un permiso, es qué pasa con los otros
                         * cuando el titular no está. */
                        const needsView = !module.soloAprobar && !pt.esDelegacion
                            && (pt.key === 'can_edit' || pt.key === 'can_approve') && !perms.can_view;
                        const isFlashing = flashedPerm === pt.key;
                        return (
                            <div
                                key={pt.key}
                                className={`flex items-center justify-between gap-3 px-1.5 py-1 rounded-lg transition-all duration-[var(--dur-slow)] ${
                                    needsView ? 'opacity-20 pointer-events-none' : ''
                                } ${isFlashing ? (val ? 'bg-chart-1/10 scale-[1.02]' : 'bg-danger/10 scale-[0.99]') : ''}`}
                            >
                                <div className="flex items-center gap-2">
                                    <div className={`w-5 h-5 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-[var(--dur-slow)] ${
                                        val
                                            ? `${pt.activeColor} shadow-sm ${isFlashing ? 'scale-125' : 'scale-100'}`
                                            : `bg-surface-card-hover/50 ${isFlashing ? 'scale-75' : 'scale-100'}`
                                    }`}>
                                        <PtIcon size={9} className="text-white" strokeWidth={3} />
                                    </div>
                                    <LiquidTooltip content={PERM_DESC[pt.key]}>
                                        <span className={`text-caption font-black uppercase tracking-widest transition-all duration-[var(--dur-slow)] ${val ? 'text-content-2' : 'text-content-2'}`}>
                                            {pt.label}
                                        </span>
                                    </LiquidTooltip>
                                </div>
                                <Toggle
                                    value={val}
                                    onChange={v => handlePerm(module.key, pt.key, v)}
                                    color={pt.activeColor}
                                    disabled={locked || needsView}
                                />
                            </div>
                        );
                    })}
                </div>

                {/* Scope selector */}
                {module.hasScope && perms.can_view && (
                    <div className="mt-3 pt-3 border-t border-border-card">
                        <div className="flex items-center gap-1.5 mb-2">
                            <Globe2 size={9} className="text-content-3" strokeWidth={2.5} />
                            <p className="text-micro font-black uppercase tracking-widest text-content-2">Alcance</p>
                        </div>
                        <div className="flex gap-1.5">
                            <SegmentedControl
                                size="sm"
                                label="Alcance"
                                value={currentScope}
                                onChange={(v) => onChange(module.key, 'scope', v)}
                                options={SCOPE_OPTIONS}
                                disabled={locked}
                                className="flex-1"
                            />
                        </div>
                    </div>
                )}

                {/* Sub-permisos, en DOS bloques. Antes iban todos juntos bajo el
                    rótulo "Pestañas", que para la mitad era falso: ahí adentro
                    conviven pestañas de la vista y capacidades (descargar, ver
                    montos, ver costos, abrir). Ver el encabezado de
                    constants/permissionModules.js. Las pestañas van primero
                    porque son las que dibujan la vista; las capacidades después,
                    porque modifican lo que ya se ve. */}
                {perms.can_view && tabPerms && [
                    { titulo: 'Pestañas',    icono: Layers,   items: pestanasDe({ sub: tabs }) },
                    { titulo: 'Capacidades', icono: Sparkles, items: capacidadesDe({ sub: tabs }) },
                ].filter(b => b.items.length > 0).map(bloque => {
                    const BloqueIcon = bloque.icono;
                    return (
                    <div key={bloque.titulo} className="mt-3 pt-3 border-t border-border-card">
                        <div className="flex items-center gap-1.5 mb-2">
                            <BloqueIcon size={9} className="text-content-3" strokeWidth={2.5} />
                            <p className="text-micro font-black uppercase tracking-widest text-content-2">{bloque.titulo}</p>
                        </div>
                        <div className="space-y-1.5">
                            {bloque.items.map(tab => {
                                const tabPerm = tabPerms[tab.key] || { can_view: false };
                                return (
                                    <div key={tab.key} data-surface={tabPerm.can_view ? undefined : 'card'} className={`flex items-center justify-between gap-3 px-2.5 py-1.5 rounded-xl border transition-all duration-[var(--dur-slow)] ${tabPerm.can_view ? 'bg-chart-1/10 border-chart-1/30' : ''}`}>
                                        <span className={`text-caption font-bold transition-colors duration-[var(--dur-slow)] ${tabPerm.can_view ? 'text-content-2' : 'text-content-3'}`}>
                                            {tab.label}
                                        </span>
                                        <div className="flex items-center gap-1.5">
                                            {tabSaving?.[tab.key] && <Loader2 size={9} className="text-content-3 animate-spin" />}
                                            <Toggle
                                                value={!!tabPerm.can_view}
                                                onChange={v => onTabChange(tab.key, 'can_view', v)}
                                                color="bg-chart-1"
                                                disabled={locked}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    );
                })}
            </div>
        </div>
    );
};

// ─── Vista principal ────────────────────────────────────────────────────────
const PermissionsView = () => {
    const { hasPermission } = useAuth();
    const canEdit = hasPermission('permissions', 'can_edit');
    // Para poder nombrar a quién se le delega: quién tiene el cargo de arriba y
    // quién nombró un suplente propio. Salen de la tabla, no de una lista fija.
    const empleados = useStaff(s => s.employees);

    const [selectedRoleId, setSelectedRoleId] = useState(null); // integer (roles.id)
    const [orgRoles, setOrgRoles] = useState([]);               // [{ id, name, parent_role_id }] sorted hierarchically
    const [permissions, setPermissions] = useState({});         // { 'role_id:module_key': { can_view, can_edit, can_approve } }
    const [rolePriceLevels, setRolePriceLevels] = useState({}); // { [roleId]: string | null }
    const [roleIdleLimits, setRoleIdleLimits] = useState({});   // { [roleId]: minutos }
    const showToast = useToastStore(s => s.showToast);
    const [roleIsSU, setRoleIsSU] = useState({});               // { [roleId]: boolean }
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState({});
    const [savedFlash, setSavedFlash] = useState({});
    const [activatingAll, setActivatingAll] = useState(false);
    const [copyingFrom, setCopyingFrom] = useState(false);
    const [confirmActivate, setConfirmActivate] = useState(false);
    const [confirmCopy, setConfirmCopy] = useState(null); // roleId a copiar
    // Las dos acciones menos reversibles de la pantalla no confirmaban nada,
    // mientras "Activar todo" —que hace menos daño— sí. Hallazgo P0/P1 de la
    // auditoría del 2026-08-03.
    const [confirmSU, setConfirmSU] = useState(null);       // true|false a aplicar
    const [confirmGroup, setConfirmGroup] = useState(null); // { modules, activate, group }
    const [searchQuery, setSearchQuery] = useState('');

    // Contrato estándar de todo buscador toggleable (DESIGN.md §24): Escape
    // cierra Y limpia; click afuera cierra SOLO si está vacío.

    // ── Carga roles organizacionales + permisos desde DB ─────────────────────
    useEffect(() => {
        setLoading(true); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial de datos
        Promise.all([
            fetchRolesForPermissions(),
            fetchRolePermissions(),
        ]).then(([{ data: rolesData }, { data: permsData }]) => {
            // Ordenar jerárquicamente: raíz → hijos → nietos...
            const rawRoles = rolesData || [];
            const byParent = {};
            rawRoles.forEach(r => {
                const p = r.parent_role_id ?? 'root';
                if (!byParent[p]) byParent[p] = [];
                byParent[p].push(r);
            });
            // BFS: nivel a nivel (mayor → menor jerarquía)
            const sorted = [];
            const queue = (byParent['root'] || []).map(r => r);
            while (queue.length) {
                const r = queue.shift();
                sorted.push(r);
                (byParent[r.id] || []).forEach(child => queue.push(child));
            }
            const loadedRoles = sorted;
            setOrgRoles(loadedRoles);

            // Niveles de precio, flag is_su y tiempo de inactividad por cargo
            const levels = {};
            const suFlags = {};
            const idles = {};
            rawRoles.forEach(r => {
                levels[r.id]  = r.max_price_level ?? null;
                suFlags[r.id] = r.is_su ?? false;
                idles[r.id]   = r.idle_limit_min ?? 5;
            });
            setRolePriceLevels(levels);
            setRoleIsSU(suFlags);
            setRoleIdleLimits(idles);

            const map = {};
            (permsData || []).forEach(p => {
                map[`${p.role_id}:${p.module_key}`] = {
                    can_view: p.can_view,
                    can_edit: p.can_edit,
                    can_approve: p.can_approve,
                    scope: p.scope || 'ALL',
                    delega_en_ausencia: !!p.delega_en_ausencia,
                };
            });
            // Inicializar vacíos
            loadedRoles.forEach(r => MODULES.forEach(m => {
                const k = `${r.id}:${m.key}`;
                if (!map[k]) map[k] = { can_view: false, can_edit: false, can_approve: false, scope: 'ALL', delega_en_ausencia: false };
            }));
            setPermissions(map);
            setLoading(false);
        });
    }, []);

    // ── Toggle individual con auto-save ─────────────────────────────────────
    const handleToggle = useCallback(async (moduleKey, permType, value) => {
        const roleId = selectedRoleId;
        if (!roleId) return;
        const k = `${roleId}:${moduleKey}`;

        // Apagar "Ver" de un módulo arrastra sus sub-permisos (ver SUBS_DE).
        const arrastra = permType === 'can_view' && !value ? (SUBS_DE[moduleKey] || []) : [];

        // ── Los widgets del tablero arrastran a «Inicio» ────────────────────
        // Un widget encendido sin `overview` no se ve en ninguna parte: el
        // permiso de la vista es el que deja entrar. Y al revés, un «Inicio»
        // encendido sin un solo widget es una pantalla vacía con barra de
        // pestañas. Así que el vínculo va en los dos sentidos —decisión del
        // usuario, 2026-08-07— y se calcula sobre el estado que va a quedar,
        // no sobre el actual: el que se está apagando todavía figura encendido.
        const esWidget = moduleKey.startsWith('dash_');
        const kInicio = `${roleId}:overview`;
        let inicioPasaA = null;
        if (esWidget && permType === 'can_view') {
            if (value) {
                if (!permissions[kInicio]?.can_view) inicioPasaA = true;
            } else {
                const quedaAlguno = MODULES.some(m =>
                    m.key.startsWith('dash_') && m.key !== moduleKey
                    && permissions[`${roleId}:${m.key}`]?.can_view);
                if (!quedaAlguno && permissions[kInicio]?.can_view) inicioPasaA = false;
            }
        }

        // ── Las cuatro familias y su maestro, en los dos sentidos ───────────
        // Mismo criterio que los widgets de arriba, y por el mismo motivo: se
        // calcula sobre el estado que VA A QUEDAR, no sobre el actual — el que
        // se está apagando todavía figura encendido en `permissions`.
        const kMaestro   = `${roleId}:requests`;
        const esMaestro  = moduleKey === 'requests' && permType === 'can_approve';
        const esFamilia  = HIJOS_DE_APROBAR.includes(moduleKey) && permType === 'can_approve';
        const familiasPasanA = esMaestro ? value : null;
        let   maestroPasaA   = null;
        if (esFamilia) {
            if (value) {
                if (!permissions[kMaestro]?.can_approve) maestroPasaA = true;
            } else {
                const quedaAlguna = HIJOS_DE_APROBAR.some(h =>
                    h !== moduleKey && permissions[`${roleId}:${h}`]?.can_approve);
                if (!quedaAlguna && permissions[kMaestro]?.can_approve) maestroPasaA = false;
            }
        }

        setPermissions(prev => {
            const next = { ...prev };
            const cur = { ...prev[k] };
            cur[permType] = value;
            if (permType === 'can_view' && !value) { cur.can_edit = false; cur.can_approve = false; }
            next[k] = cur;
            for (const sk of arrastra) {
                next[`${roleId}:${sk}`] = { ...(prev[`${roleId}:${sk}`] || {}), can_view: false, can_edit: false, can_approve: false };
            }
            if (inicioPasaA !== null) {
                const ini = { ...(prev[kInicio] || {}), can_view: inicioPasaA };
                if (!inicioPasaA) { ini.can_edit = false; ini.can_approve = false; }
                next[kInicio] = ini;
            }
            if (familiasPasanA !== null) {
                for (const h of HIJOS_DE_APROBAR) {
                    const kh = `${roleId}:${h}`;
                    next[kh] = { ...(prev[kh] || { can_view: false, can_edit: false, scope: 'ALL' }),
                                 can_approve: familiasPasanA };
                }
            }
            if (maestroPasaA !== null) {
                next[kMaestro] = { ...(prev[kMaestro] || {}), can_approve: maestroPasaA };
            }
            return next;
        });

        setSaving(prev => ({ ...prev, [k]: true }));

        const cur = permissions[k] || {};
        const next = { ...cur, [permType]: value };
        if (permType === 'can_view' && !value) { next.can_edit = false; next.can_approve = false; }

        const { error } = await upsertRolePermission({
            role_id: roleId,
            module_key: moduleKey,
            can_view: next.can_view ?? false,
            can_edit: next.can_edit ?? false,
            can_approve: next.can_approve ?? false,
            scope: next.scope || 'ALL',
            delega_en_ausencia: next.delega_en_ausencia ?? false,
            updated_at: new Date().toISOString(),
        });

        /* Persistir la cascada. Va aparte del upsert de arriba y no dentro,
         * porque son filas de OTROS módulos: `upsertRolePermission` escribe una
         * sola. Y se manda sólo si la principal entró — si esa falló, propagar
         * el cambio a cuatro filas más dejaría el cuadro diciendo una cosa y el
         * módulo que se tocó diciendo otra. */
        if (!error && (familiasPasanA !== null || maestroPasaA !== null)) {
            const filas = [];
            if (familiasPasanA !== null) {
                for (const h of HIJOS_DE_APROBAR) {
                    const pv = permissions[`${roleId}:${h}`] || {};
                    filas.push({
                        role_id: roleId, module_key: h,
                        can_view: pv.can_view ?? false,
                        can_edit: pv.can_edit ?? false,
                        can_approve: familiasPasanA,
                        scope: pv.scope || 'ALL',
                        delega_en_ausencia: pv.delega_en_ausencia ?? false,
                        updated_at: new Date().toISOString(),
                    });
                }
            }
            if (maestroPasaA !== null) {
                const pv = permissions[kMaestro] || {};
                filas.push({
                    role_id: roleId, module_key: 'requests',
                    can_view: pv.can_view ?? false,
                    can_edit: pv.can_edit ?? false,
                    can_approve: maestroPasaA,
                    scope: pv.scope || 'ALL',
                    delega_en_ausencia: pv.delega_en_ausencia ?? false,
                    updated_at: new Date().toISOString(),
                });
            }
            await upsertRolePermissionsBulk(filas);
        }

        if (!error && arrastra.length > 0) {
            await upsertRolePermissionsBulk(arrastra.map(sk => ({
                role_id: roleId, module_key: sk,
                can_view: false, can_edit: false, can_approve: false,
                scope: permissions[`${roleId}:${sk}`]?.scope || 'ALL',
                updated_at: new Date().toISOString(),
            })));
        }

        if (!error && inicioPasaA !== null) {
            const iniPrevio = permissions[kInicio] || {};
            await upsertRolePermission({
                role_id: roleId,
                module_key: 'overview',
                can_view: inicioPasaA,
                can_edit: inicioPasaA ? (iniPrevio.can_edit ?? false) : false,
                can_approve: inicioPasaA ? (iniPrevio.can_approve ?? false) : false,
                scope: iniPrevio.scope || 'ALL',
                updated_at: new Date().toISOString(),
            });
        }

        setSaving(prev => ({ ...prev, [k]: false }));
        if (!error) {
            setSavedFlash(prev => ({ ...prev, [k]: true }));
            setTimeout(() => setSavedFlash(prev => ({ ...prev, [k]: false })), 1500);
        }
        // Toda acción de usuario va a la bitácora (regla de CLAUDE.md). Faltaba
        // en TODA esta vista, que es justo donde más importa saber quién le dio
        // acceso a quién — hallazgo P0 de la auditoría del 2026-08-03.
        useStaff.getState().appendAuditLog('PERMISOS_CAMBIO', String(roleId), {
            cargo: orgRoles.find(r => r.id === roleId)?.name,
            modulo: moduleKey, permiso: permType, valor: value,
            arrastro: arrastra.length || undefined,
            // Queda en la bitácora porque es un cambio de acceso que el
            // administrador no pidió explícitamente: si «Inicio» aparece o
            // desaparece de un cargo, tiene que poder rastrearse por qué.
            inicio: inicioPasaA === null ? undefined : (inicioPasaA ? 'encendido' : 'apagado'),
            error: error ? (error.message || 'error al guardar') : undefined,
        });
    }, [selectedRoleId, permissions, orgRoles]);

    // ── Nivel de precio por cargo ────────────────────────────────────────────
    const handlePriceLevelChange = useCallback(async (level) => {
        if (!selectedRoleId) return;
        setRolePriceLevels(prev => ({ ...prev, [selectedRoleId]: level }));
        await updateRoleMaxPriceLevel(selectedRoleId, level);
        useStaff.getState().appendAuditLog('PERMISOS_NIVEL_PRECIO', String(selectedRoleId), {
            cargo: orgRoles.find(r => r.id === selectedRoleId)?.name, nivel: level || 'sin límite',
        });
    }, [selectedRoleId, orgRoles]);

    // ── Tiempo de inactividad por cargo ──────────────────────────────────────
    // A diferencia del nivel de precio, esto NO es optimista sin red de
    // seguridad: la base acota el valor (5 a 1440) y si rechaza hay que volver
    // atrás, o la pantalla mostraría un tiempo que nadie guardó.
    const handleIdleLimitChange = useCallback(async (minutos) => {
        if (!selectedRoleId) return;
        const anterior = roleIdleLimits[selectedRoleId] ?? 5;
        setRoleIdleLimits(prev => ({ ...prev, [selectedRoleId]: minutos }));
        const { error } = await updateRoleIdleLimit(selectedRoleId, minutos);
        if (error) {
            setRoleIdleLimits(prev => ({ ...prev, [selectedRoleId]: anterior }));
            showToast?.('No se pudo cambiar el tiempo', 'Vuelve a intentarlo.', 'error');
            return;
        }
        useStaff.getState().appendAuditLog('PERMISOS_TIEMPO_INACTIVIDAD', String(selectedRoleId), {
            cargo: orgRoles.find(r => r.id === selectedRoleId)?.name, minutos,
        });
    }, [selectedRoleId, orgRoles, roleIdleLimits, showToast]);

    // ── Toggle Super Usuario por cargo ───────────────────────────────────────
    const handleSuToggle = useCallback(async (value) => {
        if (!selectedRoleId) return;
        setRoleIsSU(prev => ({ ...prev, [selectedRoleId]: value }));
        await updateRoleIsSU(selectedRoleId, value);
        useStaff.getState().appendAuditLog('PERMISOS_SUPER_USUARIO', String(selectedRoleId), {
            cargo: orgRoles.find(r => r.id === selectedRoleId)?.name, valor: value,
        });
    }, [selectedRoleId, orgRoles]);

    /* Delegar (o dejar de delegar) las decisiones de solicitudes.
     *
     * Enciende `delega_en_ausencia` en las CINCO filas de una vez —las cuatro
     * familias más `requests`, que es la que abre la bandeja— porque en la
     * pantalla es un solo interruptor y en la base son cinco filas. Delegar
     * decidir sin delegar ver dejaría al suplente con permiso para resolver algo
     * que no puede abrir. */
    const handleDelegar = useCallback(async (roleId, value) => {
        const claves = [...FAMILIAS_DECIDIR.map(f => f.key), 'requests'];
        setPermissions(prev => {
            const next = { ...prev };
            for (const k of claves) {
                const kk = `${roleId}:${k}`;
                next[kk] = { ...(prev[kk] || { can_view: false, can_edit: false, can_approve: false, scope: 'ALL' }),
                             delega_en_ausencia: value };
            }
            return next;
        });
        const { error } = await upsertRolePermissionsBulk(claves.map(k => {
            const pv = permissions[`${roleId}:${k}`] || {};
            return {
                role_id: roleId, module_key: k,
                can_view: pv.can_view ?? false,
                can_edit: pv.can_edit ?? false,
                can_approve: pv.can_approve ?? false,
                scope: pv.scope || 'ALL',
                delega_en_ausencia: value,
                updated_at: new Date().toISOString(),
            };
        }));
        if (!error) {
            useStaff.getState().appendAuditLog('PERMISOS_DELEGAR_AUSENCIA', String(roleId), {
                cargo: orgRoles.find(r => r.id === roleId)?.name, valor: value,
            });
        }
    }, [permissions, orgRoles]);

    /* Las tarjetas ACTIVAS primero, dentro de cada grupo.
     *
     * Una tarjeta encendida es más alta —muestra alcance, pestañas y
     * capacidades— y una apagada es apenas dos interruptores. Mezcladas, la
     * grilla queda con dientes: una alta al lado de una corta y un hueco
     * debajo. Agrupando las altas, las filas cierran parejo.
     *
     * ── Por qué se congela por cargo y no se recalcula al vuelo ────────────
     * Si el orden dependiera del estado actual, apagar un módulo lo mandaría
     * al final EN EL MISMO CLIC: la tarjeta salta de lugar debajo del cursor y
     * el siguiente clic cae sobre otra cosa. Se calcula una vez al abrir el
     * cargo y se sostiene mientras se lo edita; al cambiar de cargo, se
     * recalcula.
     *
     * `permissions` se lee de una ref a propósito, para que cambiarlo NO
     * dispare el recálculo — que es justo lo que se quiere evitar. */
    // (el orden de las tarjetas se calcula del registro, ver `ordenar` arriba)

    // ── Activar todos los permisos (como SUPERADMIN) ─────────────────────────
    const handleActivateAll = useCallback(async () => {
        if (!selectedRoleId) return;
        setActivatingAll(true);
        const rows = MODULES.map(m => ({
            role_id: selectedRoleId,
            module_key: m.key,
            can_view: true,
            can_edit: m.isTab ? false : true,
            can_approve: m.hasApprove ? true : false,
            scope: permissions[`${selectedRoleId}:${m.key}`]?.scope || 'ALL',
            updated_at: new Date().toISOString(),
        }));
        const [{ error }] = await Promise.all([
            upsertRolePermissionsBulk(rows),
            updateRoleMaxPriceLevel(selectedRoleId, null),
        ]);
        if (!error) {
            setPermissions(prev => {
                const next = { ...prev };
                MODULES.forEach(m => {
                    next[`${selectedRoleId}:${m.key}`] = {
                        can_view: true,
                        can_edit: m.isTab ? false : true,
                        can_approve: m.hasApprove ? true : false,
                        scope: prev[`${selectedRoleId}:${m.key}`]?.scope || 'ALL',
                    };
                });
                return next;
            });
            setRolePriceLevels(prev => ({ ...prev, [selectedRoleId]: null }));
        }
        useStaff.getState().appendAuditLog('PERMISOS_ACTIVAR_TODO', String(selectedRoleId), {
            cargo: orgRoles.find(r => r.id === selectedRoleId)?.name, modulos: MODULES.length,
        });
        setActivatingAll(false);
    }, [selectedRoleId, permissions, orgRoles]);

    // ── Copiar permisos de otro cargo ────────────────────────────────────────
    const handleCopyFrom = useCallback(async (sourceRoleId) => {
        if (!selectedRoleId || sourceRoleId === selectedRoleId) return;
        setCopyingFrom(true);
        const rows = MODULES.map(m => {
            const src = permissions[`${sourceRoleId}:${m.key}`] || {};
            return {
                role_id: selectedRoleId,
                module_key: m.key,
                can_view: src.can_view ?? false,
                can_edit: src.can_edit ?? false,
                can_approve: src.can_approve ?? false,
                scope: src.scope || 'ALL',
                // Copiar un cargo sin su delegación dejaría dos cargos que se
                // ven iguales en la pantalla y se comportan distinto el día que
                // alguien se va de vacaciones.
                delega_en_ausencia: src.delega_en_ausencia ?? false,
                updated_at: new Date().toISOString(),
            };
        });
        const srcLevel = rolePriceLevels[sourceRoleId] ?? null;
        const [{ error }] = await Promise.all([
            upsertRolePermissionsBulk(rows),
            updateRoleMaxPriceLevel(selectedRoleId, srcLevel),
        ]);
        if (!error) {
            setPermissions(prev => {
                const next = { ...prev };
                MODULES.forEach(m => {
                    const src = permissions[`${sourceRoleId}:${m.key}`] || {};
                    next[`${selectedRoleId}:${m.key}`] = {
                        can_view: src.can_view ?? false,
                        can_edit: src.can_edit ?? false,
                        can_approve: src.can_approve ?? false,
                        scope: src.scope || 'ALL',
                        delega_en_ausencia: src.delega_en_ausencia ?? false,
                    };
                });
                return next;
            });
            setRolePriceLevels(prev => ({ ...prev, [selectedRoleId]: srcLevel }));
        }
        useStaff.getState().appendAuditLog('PERMISOS_COPIAR_DESDE', String(selectedRoleId), {
            cargo: orgRoles.find(r => r.id === selectedRoleId)?.name,
            desde: orgRoles.find(r => r.id === sourceRoleId)?.name,
        });
        setCopyingFrom(false);
    }, [selectedRoleId, permissions, rolePriceLevels, orgRoles]);

    // ── Toggle de sección completa ────────────────────────────────────────────
    const handleGroupToggle = useCallback(async (groupModules, activate) => {
        if (!selectedRoleId) return;
        // Optimistic update
        setPermissions(prev => {
            const next = { ...prev };
            groupModules.forEach(m => {
                const k = `${selectedRoleId}:${m.key}`;
                next[k] = {
                    can_view: activate,
                    can_edit: activate,
                    can_approve: activate && !!m.hasApprove,
                };
            });
            return next;
        });
        const rows = groupModules.map(m => ({
            role_id: selectedRoleId,
            module_key: m.key,
            can_view: activate,
            can_edit: activate,
            can_approve: activate && !!m.hasApprove,
            scope: permissions[`${selectedRoleId}:${m.key}`]?.scope || 'ALL',
            updated_at: new Date().toISOString(),
        }));
        await upsertRolePermissionsBulk(rows);
        useStaff.getState().appendAuditLog(activate ? 'PERMISOS_ACTIVAR_SECCION' : 'PERMISOS_APAGAR_SECCION',
            String(selectedRoleId), {
                cargo: orgRoles.find(r => r.id === selectedRoleId)?.name,
                modulos: groupModules.length,
            });
    }, [selectedRoleId, permissions, orgRoles]);

    const selectedOrgRole = orgRoles.find(r => r.id === selectedRoleId) ?? null;

    // Mismo criterio que la lista: el chip del header es el acento de selección,
    // salvo que el cargo sea Super Usuario — ahí el warning es el dato.
    const roleStyle = selectedRoleId && roleIsSU[selectedRoleId] ? SUPER_USUARIO : SELECCION;

    // El buscador cambia de objeto según dónde estés parado: sin cargo elegido
    // busca CARGOS (es lo único que hay), y con uno elegido busca MÓDULOS, que
    // es lo que se está mirando. Antes solo buscaba cargos, así que ubicar
    // "descargar de Nómina" entre 63 tarjetas era recorrerlas con el ojo.
    const buscaModulos = !!selectedRoleId;
    const q = searchQuery.trim();

    const { filteredRoles, isPermRoleFuzzy } = useMemo(() => {
        // Con un cargo elegido la columna de cargos NO se filtra: el texto está
        // buscando en la otra columna, y esconder cargos mientras tanto haría
        // desaparecer el que se está editando.
        if (buscaModulos || !q) return { filteredRoles: orgRoles, isPermRoleFuzzy: false };
        const { results, isFuzzy } = smartFilter(q, orgRoles, r => [r.name]);
        return { filteredRoles: results, isPermRoleFuzzy: isFuzzy };
    }, [orgRoles, q, buscaModulos]);

    // Grupos con sus módulos filtrados. Busca en el nombre del módulo, en el del
    // grupo y en los SUB-PERMISOS: escribir "descargar" tiene que traer los
    // módulos que tienen esa capacidad aunque la palabra no esté en su nombre —
    // y así trae Listado de Personal, Auditoría de Tiempos y Sucursales.
    //
    // La DESCRIPCIÓN queda fuera a propósito. Se probó con y sin, y con ella la
    // búsqueda se vuelve inútil: "pedidos" devolvía 6 módulos (entre ellos Plan
    // de Vacaciones y Salud de Syncs) en vez de 1, "nómina" devolvía 4 en vez de
    // 1, y "iva" traía Monitor Real-Time porque su descripción dice "asistencia
    // act·iva·". Las descripciones son párrafos escritos para leerse, no para
    // buscarse; el precio de incluirlas es que el resultado deja de ser una
    // respuesta.
    const gruposFiltrados = useMemo(() => {
        if (!buscaModulos || !q) return MODULE_GROUPS;
        return MODULE_GROUPS
            .map(g => ({
                ...g,
                modules: smartFilter(q, g.modules,
                    m => [m.label, g.group, ...(m.sub || []).map(s => s.label)]).results,
            }))
            .filter(g => g.modules.length > 0);
    }, [buscaModulos, q]);

    const modulosEncontrados = gruposFiltrados.reduce((n, g) => n + g.modules.length, 0);

    const copyOptions = orgRoles
        .filter(r => r.id !== selectedRoleId)
        .map(r => ({ value: r.id, label: r.name }));

    // Header flotante
    const headerLeft = (
        <div className="flex items-center gap-3">
            <div className="bg-gradient-to-tr from-brand to-brand-purple rounded-xl md:rounded-2xl shadow-[var(--shadow-glow-brand)] p-2 md:p-2.5 flex items-center justify-center shrink-0">
                <Lock className="text-white" size={20} strokeWidth={1.5} />
            </div>
            <h2 className="font-semibold text-title-sm md:text-title-lg text-content tracking-tight">
                Permisos de acceso
            </h2>
            {selectedOrgRole && (
                <>
                    <div className="hidden md:block w-px h-6 bg-divider mx-0.5" />
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-2xl border ${roleStyle.fondo} ${roleStyle.borde}`}>
                        <div className={`w-5 h-5 rounded-lg bg-gradient-to-br ${roleStyle.icono} flex items-center justify-center flex-shrink-0`}>
                            <ShieldCheck size={11} className="text-white" strokeWidth={2} />
                        </div>
                        <span className={`text-body font-black ${roleStyle.texto} leading-tight`}>
                            {selectedOrgRole.name}
                        </span>
                    </div>
                </>
            )}
        </div>
    );

    const filtersContent = (
        <ViewTabBar
            searchValue={searchQuery}
            onSearchChange={setSearchQuery}
            placeholder={buscaModulos ? 'Buscar módulo o permiso…' : 'Buscar cargo…'}
        />
    );

    // §17: las dos acciones sobre el cargo elegido bajan a la píldora del cuerpo.
    // "Copiar desde…" es un `LiquidSelect` y no cabe en un descriptor de botón,
    // así que va por `accionesExtra` — que existe exactamente para esto.
    const puedeEditarCargo = selectedRoleId && canEdit;
    const filtrosCuerpo = puedeEditarCargo ? (
        <FilterBar
            acciones={[{
                key: 'activar',
                icon: activatingAll ? Loader2 : Zap,
                label: 'Activar todo',
                // "TODO" solo, que es lo que daría la regla, no dice nada bajo un
                // ícono de rayo.
                rotulo: 'Activar',
                tone: 'warning',
                disabled: activatingAll || !!copyingFrom,
                onClick: () => setConfirmActivate(true),
            }]}
            accionesExtra={(
                <div className="w-44 shrink-0">
                    <LiquidSelect value="" onChange={val => { if (val) setConfirmCopy(Number(val)); }}
                        options={copyOptions}
                        placeholder={copyingFrom ? 'Copiando…' : 'Copiar desde…'}
                        compact bare clearable={false} disabled={!!copyingFrom} />
                </div>
            )}
        />
    ) : null;

    return (
        <>
        <GlassViewLayout
            headerLeft={headerLeft}
            transparentBody={true}
            fixedScrollMode={true}
            filtersContent={filtersContent}
        >
            {loading ? (
                /* ── Skeleton ── */
                <div className="flex flex-col lg:flex-row gap-5 lg:-mt-[180px] xl:-mt-[200px] lg:flex-1 lg:min-h-0">
                        {/* Skeleton left column */}
                        <div className="w-full lg:w-64 shrink-0 lg:overflow-y-auto [&::-webkit-scrollbar]:hidden lg:pt-[180px] xl:pt-[200px] space-y-2.5 lg:pb-10">
                            {[...Array(6)].map((_, i) => (
                                <div key={i} data-surface="card" className="animate-stagger-child p-4" style={{ '--stagger-delay': `${i * 60}ms` }}>
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-xl skeleton flex-shrink-0" />
                                        <div className="flex-1 space-y-1.5">
                                            <div className="h-3 skeleton rounded-full w-3/4" />
                                            <div className="h-2 skeleton rounded-full w-1/2" />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        {/* Skeleton right */}
                        <div className="flex-1 min-w-0 lg:overflow-y-auto [&::-webkit-scrollbar]:hidden lg:pt-[180px] xl:pt-[200px] space-y-6 lg:pb-10">
                            {MODULE_GROUPS.slice(0, 3).map((g, gi) => (
                                <div key={gi}>
                                    <div className="h-3 w-24 skeleton mx-auto mb-3" />
                                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                                        {g.modules.map((_, i) => (
                                            <div key={i} data-surface="card" className="animate-stagger-child p-4" style={{ '--stagger-delay': `${(gi * 3 + i) * 50}ms` }}>
                                                <div className="flex gap-3 mb-4">
                                                    <div className="w-9 h-9 rounded-xl skeleton flex-shrink-0" />
                                                    <div className="flex-1 space-y-1.5 pt-0.5">
                                                        <div className="h-3 skeleton w-3/4" />
                                                        <div className="h-2 skeleton w-full" />
                                                    </div>
                                                </div>
                                                <div className="space-y-2.5">
                                                    <div className="h-4 skeleton" />
                                                    <div className="h-4 skeleton" />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                </div>
            ) : (
            <div className="flex flex-col lg:flex-row gap-5 lg:-mt-[180px] xl:-mt-[200px] lg:flex-1 lg:min-h-0">

                    {/* ── Columna izquierda: selector de cargos ── */}
                    <div className="w-full lg:w-64 shrink-0 lg:h-full lg:overflow-y-auto lg:overscroll-contain lg:pt-[180px] xl:pt-[200px] [&::-webkit-scrollbar]:hidden">
                        <p className="text-caption font-black text-content-2 uppercase tracking-widest px-1 mb-3 flex items-center gap-1.5">
                            <ShieldCheck size={10} /> Cargos
                        </p>
                        <div className="space-y-2">
                        {isPermRoleFuzzy && searchQuery && (
                            <div className="mb-2 flex items-center gap-2 px-3 py-2 rounded-xl bg-warning/10 border border-warning/30 text-caption text-warning-text font-semibold">
                                <Search size={11} strokeWidth={2.5} className="shrink-0" />
                                Similares a &ldquo;{searchQuery}&rdquo;
                            </div>
                        )}
                        {filteredRoles.length === 0 && (
                            <EmptyState
                                compact
                                icon={SearchX}
                                glowClass="bg-content-3/30"
                                title="Sin resultados"
                                subtitle={`Ningún cargo se parece a “${q}”`}
                                action={<Button variant="secondary" onClick={() => setSearchQuery('')}>Ver todos</Button>}
                            />
                        )}
                        {filteredRoles.map((r) => {
                            const isActive = selectedRoleId === r.id;
                            const isSURol = !!roleIsSU[r.id];
                            // El color entra SOLO cuando dice algo: SU manda sobre
                            // selección porque "acceso irrestricto" hay que verlo
                            // aunque el cargo no sea el que se está editando.
                            const cs = isSURol ? SUPER_USUARIO : SELECCION;
                            const viewCount = MAIN_MODULES.filter(m => permissions[`${r.id}:${m.key}`]?.can_view).length;
                            return (
                                <button
                                    key={r.id}
                                    aria-pressed={isActive}
                                    onClick={() => setSelectedRoleId(r.id)}
                                    className={`w-full text-left rounded-3xl border p-3.5 transition-all duration-[var(--dur-slow)] hover:translate-y-[var(--lift-hover)] active:scale-[0.98] transform-gpu ${
                                        isActive
                                            ? `${cs.fondo} ${cs.borde} shadow-[var(--shadow-elevation-md)]`
                                            : 'bg-surface-card border-border-card hover:bg-surface-card hover:shadow-[var(--shadow-elevation-sm)]'
                                    }`}
                                >
                                    <div className="flex items-center gap-3">
                                        {/* El ícono lleva color solo si el cargo es SU o está
                                            elegido. En reposo es neutro: 25 escudos de colores
                                            distintos no distinguían nada. */}
                                        <div className={`relative w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
                                            isSURol || isActive
                                                ? `bg-gradient-to-br ${cs.icono} shadow-sm`
                                                : 'bg-surface-card-hover'
                                        }`}>
                                            <ShieldCheck size={13} className={isSURol || isActive ? 'text-white' : 'text-content-3'} strokeWidth={2} />
                                            {isSURol && (
                                                <div className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-white flex items-center justify-center">
                                                    <Sparkles size={8} className="text-warning" strokeWidth={2.5} />
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-1.5">
                                                <p className={`text-body-sm font-black leading-tight truncate ${isActive ? cs.texto : 'text-content-2'}`}>{r.name}</p>
                                                {isSURol && <Badge variant="warning" tone="solid" size="sm">SU</Badge>}
                                            </div>
                                            <p className={`text-caption font-medium mt-0.5 ${isActive ? cs.texto : 'text-content-3'}`}>
                                                {viewCount} de {MAIN_MODULES.length} módulos
                                            </p>
                                        </div>
                                        {isActive && <ChevronRight size={14} className={cs.texto} strokeWidth={2.5} />}
                                    </div>
                                </button>
                            );
                        })}
                        </div>

                        {/* Info */}
                        <div data-surface="card" className="mt-4 mb-10 px-4 py-3 bg-surface-card-hover/80">
                            <div className="flex items-start gap-2">
                                <Info size={11} className="text-content-3 flex-shrink-0 mt-0.5" strokeWidth={2} />
                                <p className="text-caption text-content-3 font-medium leading-snug">
                                    Los cambios se aplican inmediatamente a todos los empleados con este cargo.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* ── Panel derecho: permisos del cargo ── */}
                    <div className="flex-1 min-w-0 lg:h-full lg:overflow-y-auto lg:overscroll-contain lg:pt-[180px] xl:pt-[200px] [&::-webkit-scrollbar]:hidden">
                        {!selectedRoleId ? (
                            /* Empty state */
                            <EmptyState icon={MousePointerClick} title="Selecciona un cargo"
                                subtitle="para modificar sus permisos de acceso" />
                        ) : (
                        /* Grid de módulos. `space-y-9` y no `-6`: con nueve secciones
                           seguidas, el aire entre grupos es la mitad de lo que los
                           separa — la otra mitad es el encabezado de abajo. */
                        <div className="space-y-9 pb-10">

                            {/* Las acciones sobre el cargo elegido (§17). Van acá y no
                                en la columna de cargos porque operan sobre ESTA
                                columna: es lo que están por reescribir. */}
                            {filtrosCuerpo && <div className="flex justify-end">{filtrosCuerpo}</div>}

                            {/* Buscando módulos: se dice cuántos quedan y se ofrece la
                                salida. Sin esto, escribir algo que no matchea deja la
                                columna en blanco sin explicar por qué. */}
                            {buscaModulos && q && modulosEncontrados > 0 && (
                                <div className="flex items-center gap-2 px-1">
                                    <Search size={11} className="text-content-3 shrink-0" strokeWidth={2.5} />
                                    <p className="text-caption font-semibold text-content-2">
                                        {modulosEncontrados} módulo{modulosEncontrados !== 1 ? 's' : ''} para &ldquo;{q}&rdquo;
                                    </p>
                                    <Button variant="ghost" onClick={() => setSearchQuery('')}>Ver todos</Button>
                                </div>
                            )}

                            {/* ── Las cuatro preguntas del CARGO ──────────────────
                                Arriba las tres cortas —Super Usuario, nivel de precio
                                y tiempo de inactividad—, una por columna y a la misma
                                altura. Abajo, Decidir solicitudes a lo ancho.

                                Las tres de arriba entraron en una fila recién cuando
                                el nivel de precio dejó de ser ocho píldoras en dos
                                renglones: mientras lo fue, marcaba la altura de la
                                fila y las otras dos quedaban con la mitad vacía. */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-stretch">

                            {/* SU Card — columna pequeña */}
                            {(() => {
                                const isRoleSU = !!roleIsSU[selectedRoleId];
                                return (
                                <div data-surface={isRoleSU ? undefined : 'card'} className={`relative overflow-hidden rounded-2xl border transition-all duration-[var(--dur-lento)] ease-out transform-gpu md:col-span-1 h-full ${isRoleSU ? 'bg-gradient-to-br from-warning/20 via-chart-4/10 to-warning/5 backdrop-blur-xl border-warning/40 shadow-[var(--shadow-glass-2)] scale-[1.01]' : ''}`}>
                                    {isRoleSU && <div className="absolute -top-4 -right-4 w-16 h-16 rounded-full bg-warning/30 blur-xl pointer-events-none" />}
                                    <div className="relative p-3.5 flex flex-col gap-3">
                                        {/* Icon + toggle row */}
                                        <div className="flex items-center justify-between">
                                            <div data-surface={isRoleSU ? undefined : 'card'} className={`relative w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-all duration-[var(--dur-lento)] ${isRoleSU ? 'bg-gradient-to-br from-warning to-chart-4 shadow-[var(--shadow-glow-chart-4-md)] scale-100' : 'scale-90'}`}>
                                                <ShieldAlert size={15} className={isRoleSU ? 'text-white' : 'text-content-3'} strokeWidth={2} />
                                                {isRoleSU && (
                                                    <div className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-white shadow flex items-center justify-center">
                                                        <Sparkles size={8} className="text-warning" strokeWidth={2.5} />
                                                    </div>
                                                )}
                                            </div>
                                            <Toggle
                                                value={isRoleSU}
                                                onChange={v => canEdit && setConfirmSU(v)}
                                                color="bg-warning"
                                                disabled={!canEdit}
                                            />
                                        </div>
                                        {/* Label */}
                                        <div>
                                            <div className="flex items-center gap-1.5">
                                                <p className={`text-body-sm font-black leading-tight transition-colors duration-[var(--dur-slow)] ${isRoleSU ? 'text-warning-text' : 'text-content-2'}`}>
                                                    Super Usuario
                                                </p>
                                                {isRoleSU && (
                                                    <Badge variant="warning" tone="solid" size="sm">SU</Badge>
                                                )}
                                            </div>
                                            <p className={`text-micro font-medium mt-0.5 leading-snug transition-colors duration-[var(--dur-slow)] ${isRoleSU ? 'text-warning-text/70' : 'text-content-3'}`}>
                                                {isRoleSU ? 'Acceso total · oculto en listas' : 'Acceso irrestricto al sistema'}
                                            </p>
                                        </div>
                                        {/* Warning badge */}
                                        {isRoleSU && (
                                            <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-xl bg-warning/12 border border-warning/40 animate-in fade-in slide-in-from-bottom-1 duration-[var(--dur-slow)]">
                                                <Zap size={8} className="text-warning flex-shrink-0" strokeWidth={2.5} />
                                                <p className="text-micro font-black text-warning-text uppercase tracking-wide">Permisos ignorados</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                );
                            })()}

                            {/* Price Level Card */}
                            {(() => {
                                const currentLevel = rolePriceLevels[selectedRoleId] ?? null;
                                const PRICE_OPTS = [
                                    { value: null,          label: 'Sin límite',  sub: 'todos los precios', icon: Unlock,     grad: 'from-success to-chart-9'  },
                                    { value: 'vineta',      label: 'Viñeta',      sub: 'precio viñeta',     icon: DollarSign, grad: 'from-chart-1 to-chart-3'   },
                                    { value: 'descuento_1', label: 'Desc. 1',     sub: 'descuento 1',       icon: DollarSign, grad: 'from-chart-3 to-chart-6' },
                                    { value: 'vip',         label: 'VIP',         sub: 'precio VIP',        icon: DollarSign, grad: 'from-warning to-chart-4'  },
                                    { value: 'clinica',     label: 'Clínica',     sub: 'precio clínica',    icon: DollarSign, grad: 'from-danger to-chart-6'     },
                                    { value: 'mayoreo',     label: 'Mayoreo',     sub: 'precio mayoreo',    icon: DollarSign, grad: 'from-chart-9 to-chart-1'      },
                                    { value: 'premium',     label: 'Premium',     sub: 'precio premium',    icon: DollarSign, grad: 'from-chart-8 to-chart-8-text'   },
                                    { value: 'precio_7',    label: 'Precio 7',    sub: 'precio 7',          icon: DollarSign, grad: 'from-chart-4 to-danger'    },
                                ];
                                const activeOpt = PRICE_OPTS.find(o => o.value === currentLevel) || PRICE_OPTS[0];
                                const ActiveIcon = activeOpt.icon;
                                return (
                                <div data-surface="card" className="rounded-2xl border border-border-card p-3.5 h-full flex flex-col gap-3">
                                    <div className="flex items-center gap-2.5">
                                        <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${activeOpt.grad} flex items-center justify-center flex-shrink-0 transition-all duration-[var(--dur-slow)]`}>
                                            <ActiveIcon size={15} className="text-white" strokeWidth={2} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-body-sm font-black text-content-2 leading-tight">Nivel de Precio Máximo</p>
                                            <p className="text-micro text-content-3 font-medium mt-0.5 leading-snug truncate">
                                                Hoy: <span className="font-black text-content-2">{activeOpt.label}</span>
                                                {activeOpt.sub !== activeOpt.label && ` · ${activeOpt.sub}`}
                                            </p>
                                        </div>
                                    </div>
                                    {/* Ocho opciones NO son un segmentado (DESIGN.md §15.3):
                                        arriba de tres, el segmentado deja de comparar y pasa a
                                        ser una lista disfrazada. Pintaba dos renglones de
                                        píldoras que se comían la tarjeta, y a 1440 «Precio 7»
                                        quedaba cortado por el borde. Con el select, la tarjeta
                                        mide lo que dice y no hace falta scroll horizontal. */}
                                    <LiquidSelect
                                        disabled={!canEdit}
                                        clearable={false}
                                        icon={DollarSign}
                                        options={PRICE_OPTS.map(opt => ({ value: opt.value ?? '_null', label: opt.label }))}
                                        value={currentLevel ?? '_null'}
                                        onChange={v => canEdit && handlePriceLevelChange(v === '_null' ? null : v)}
                                        placeholder="Elegir nivel" />
                                </div>
                                );
                            })()}

                            {/* ── Tiempo de inactividad ────────────────────────────
                                Va acá, junto a Super Usuario y al nivel de precio,
                                porque contesta una pregunta del CARGO.

                                Antes esto se DEDUCÍA de los permisos: 12 horas si el
                                cargo veía algún módulo de gestión. Y dos de esa lista
                                —pedir vacaciones y leer avisos— los tiene todo el
                                mundo, así que los 39 de sala y bodega tenían la
                                computadora del mostrador abierta 12 horas. Ahora es un
                                dato que se elige, no un efecto secundario. */}
                            <TarjetaTiempoDeInactividad
                                minutos={roleIdleLimits[selectedRoleId] ?? 5}
                                onChange={handleIdleLimitChange}
                                locked={!canEdit}
                            />

                            {/* Decidir solicitudes va ACÁ y no entre los módulos —pedido
                                del usuario— porque contesta una pregunta del CARGO, como
                                Super Usuario y el nivel de precio, no del módulo que se
                                esté mirando. A lo ancho de las tres columnas: son cuatro
                                píldoras y dos mandos, y apretados no se leen. */}
                            <TarjetaDecidirSolicitudes
                                roleId={selectedRoleId}
                                permissions={permissions}
                                onChange={handleToggle}
                                onDelegar={handleDelegar}
                                locked={!canEdit}
                                saving={saving}
                                roles={orgRoles}
                                employees={empleados}
                            />

                            </div>{/* end 2-col grid */}

                            {/* "No hay resultados" es un estado vacío, no una línea de
                                texto: el estándar (DESIGN.md §18) pide el canónico cada vez
                                que no haya datos que mostrar, y eso incluye una búsqueda que
                                no encuentra nada. Antes acá quedaba el aviso suelto y debajo
                                la columna en blanco, sin decir qué hacer. */}
                            {buscaModulos && q && modulosEncontrados === 0 && (
                                <EmptyState
                                    compact
                                    icon={SearchX}
                                    glowClass="bg-content-3/30"
                                    title="Sin resultados"
                                    subtitle={`Ningún módulo se parece a “${q}”`}
                                    action={<Button variant="secondary" onClick={() => setSearchQuery('')}>Ver todos los módulos</Button>}
                                />
                            )}

                            {gruposFiltrados.map((g, gi) => {
                                // groupActive/groupPartial solo considera módulos principales (sin tabs)
                                const groupActive = g.modules.every(m => permissions[`${selectedRoleId}:${m.key}`]?.can_view);
                                const groupPartial = !groupActive && g.modules.some(m => permissions[`${selectedRoleId}:${m.key}`]?.can_view);
                                const groupCount = g.modules.filter(m => permissions[`${selectedRoleId}:${m.key}`]?.can_view).length;
                                // Para el toggle de sección, incluir también los tabs de cada módulo
                                const allGroupModules = g.modules.flatMap(m => [m, ...(m.sub || []).map(t => ({ key: t.key, hasApprove: false }))]);
                                return (
                                <div key={g.group}>
                                    {/* Encabezado de SECCIÓN, no una etiqueta flotante. Antes era
                                        una píldora centrada entre dos líneas al 15% de opacidad:
                                        con nueve grupos y 63 tarjetas, el corte entre secciones no
                                        se veía y todo leía como una sola lista larga. Ahora va a la
                                        izquierda —que es por donde baja el ojo—, con el nombre a
                                        peso pleno y cuántos módulos del grupo tiene el cargo. */}
                                    <div className="flex items-center gap-3 mb-3.5">
                                        <span className={`w-2 h-2 rounded-full bg-current shrink-0 ${g.color}`} />
                                        <p className="text-label font-black uppercase tracking-widest text-content-2">{g.group}</p>
                                        <span className="text-caption font-semibold text-content-3 tabular-nums shrink-0">
                                            {groupCount} de {g.modules.length}
                                        </span>
                                        {groupActive && <Check size={11} strokeWidth={3} className="text-success shrink-0" />}
                                        {groupPartial && <span className="w-1.5 h-1.5 rounded-full bg-content-3 shrink-0" />}
                                        <span className="flex-1 border-t border-divider" />
                                        {/* Toggle de sección. `groupPartial` (algunos módulos
                                            de la sección activos, no todos) no es un estado que
                                            el switch tenga: se muestra apagado y a media opacidad,
                                            igual que antes, y el punto del chip de arriba es quien
                                            comunica el "a medias". */}
                                        <Switch
                                            checked={groupActive}
                                            onChange={() => canEdit && setConfirmGroup({ modules: allGroupModules, activate: !groupActive, group: g.group })}
                                            disabled={!canEdit}
                                            size="sm"
                                            variant={(g.color || '').replace('text-', '') || 'brand'}
                                            label={groupActive ? 'Desactivar sección' : 'Activar sección'}
                                            title={groupActive ? 'Desactivar sección' : 'Activar sección'}
                                            className={!groupActive && groupPartial ? 'opacity-40' : ''}
                                        />
                                    </div>
                                    {/* GRILLA, y se volvió a ella a propósito (2026-08-04).
                                        Se probó `columns` para que cada tarjeta ocupara su alto y
                                        no quedaran huecos: el usuario reportó tarjetas de un grupo
                                        pisando al grupo siguiente, con una columna vacía en el
                                        medio — una distribución que el balanceo de multi-columna
                                        no produce, así que la fragmentación se estaba rompiendo
                                        por algo del contexto (el panel es un contenedor con
                                        `overflow-y-auto` y altura resuelta por flex).
                                        No se reprodujo a 1600/1920/2200/2560, y un layout que
                                        falla donde no se puede medir no se deja puesto: un hueco
                                        es feo, una tarjeta encima de otra es una pantalla rota.
                                        Si se retoma el empaquetado, hacerlo repartiendo los
                                        módulos en N listas desde JS —determinista, sin
                                        fragmentación— y no con `columns`. */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 items-start">
                                        {ordenar(g.modules.filter(m => !m.enTarjetaAparte)).map((m, i) => {
                                            const k = `${selectedRoleId}:${m.key}`;
                                            const tabPerms = m.sub
                                                ? Object.fromEntries(m.sub.map(t => [t.key, permissions[`${selectedRoleId}:${t.key}`] || { can_view: false }]))
                                                : null;
                                            const tabSaving = m.sub
                                                ? Object.fromEntries(m.sub.map(t => [t.key, !!saving[`${selectedRoleId}:${t.key}`]]))
                                                : null;
                                            return (
                                                <div
                                                    key={m.key}
                                                    className="animate-in fade-in slide-in-from-bottom-3 duration-[var(--dur-lento)] fill-mode-both"
                                                    style={{ animationDelay: `${(gi * 3 + i) * 40}ms` }}
                                                >
                                                    <ModuleCard
                                                        module={m}
                                                        perms={permissions[k] || { can_view: false, can_edit: false, can_approve: false }}
                                                        onChange={handleToggle}
                                                        locked={!canEdit}
                                                        saving={saving[k]}
                                                        flash={!!savedFlash[k]}
                                                        tabs={m.sub}
                                                        tabPerms={tabPerms}
                                                        tabSaving={tabSaving}
                                                        onTabChange={handleToggle}
                                                    />
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                                );
                            })}
                        </div>
                        )}
                    </div>
            </div>
            )}
        </GlassViewLayout>

        {/* ── Confirmación: Activar todo ── */}
        <ConfirmModal
            isOpen={confirmActivate}
            onClose={() => setConfirmActivate(false)}
            onConfirm={() => { setConfirmActivate(false); handleActivateAll(); }}
            title="¿Activar todos los permisos?"
            message={`Se habilitarán todos los módulos para el cargo "${selectedOrgRole?.name}". Los permisos que ya tenía se sobreescribirán.`}
            confirmText="Sí, activar todo"
            isDestructive={false}
            isProcessing={activatingAll}
        />

        {/* ── Confirmación: Copiar de otro cargo ── */}
        <ConfirmModal
            isOpen={!!confirmCopy}
            onClose={() => setConfirmCopy(null)}
            onConfirm={() => { const id = confirmCopy; setConfirmCopy(null); handleCopyFrom(id); }}
            title="¿Copiar permisos?"
            message={`Se copiarán los permisos de "${orgRoles.find(r => r.id === confirmCopy)?.name}" al cargo "${selectedOrgRole?.name}". Los permisos actuales serán reemplazados.`}
            confirmText="Sí, copiar"
            isDestructive={false}
            isProcessing={copyingFrom}
        />

        {/* ── Confirmación: Super Usuario ──
            Es la acción de mayor alcance de la pantalla y era la única sin
            guarda: un switch idéntico a los otros sesenta y tres. `isDestructive`
            al ENCENDER, que es el sentido peligroso — apagarlo solo quita. */}
        <ConfirmModal
            isOpen={confirmSU !== null}
            onClose={() => setConfirmSU(null)}
            onConfirm={() => { const v = confirmSU; setConfirmSU(null); handleSuToggle(v); }}
            title={confirmSU ? '¿Dar acceso irrestricto?' : '¿Quitar el acceso irrestricto?'}
            message={confirmSU
                ? `El cargo "${selectedOrgRole?.name}" pasará a ver y hacer TODO en el portal, sin importar los permisos de abajo. Incluye salarios, documentos fiscales y la bitácora.`
                : `El cargo "${selectedOrgRole?.name}" vuelve a regirse por los permisos de abajo.`}
            confirmText={confirmSU ? 'Sí, dar acceso total' : 'Sí, quitarlo'}
            isDestructive={!!confirmSU}
        />

        {/* ── Confirmación: sección completa ── */}
        <ConfirmModal
            isOpen={!!confirmGroup}
            onClose={() => setConfirmGroup(null)}
            onConfirm={() => { const c = confirmGroup; setConfirmGroup(null); handleGroupToggle(c.modules, c.activate); }}
            title={confirmGroup?.activate ? `¿Activar toda la sección?` : `¿Apagar toda la sección?`}
            message={confirmGroup
                ? `${confirmGroup.activate ? 'Se habilitarán' : 'Se quitarán'} los ${confirmGroup.modules.length} permisos de "${confirmGroup.group}" para el cargo "${selectedOrgRole?.name}".`
                : ''}
            confirmText={confirmGroup?.activate ? 'Sí, activar' : 'Sí, apagar'}
            isDestructive={confirmGroup ? !confirmGroup.activate : false}
        />
        </>
    );
};

export default PermissionsView;
