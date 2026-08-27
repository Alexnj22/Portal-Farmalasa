import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, Search, MapPin, Phone, MessageCircle, AlertCircle, ShieldAlert,
  Cake, Medal, Palmtree, Stethoscope, Baby, Clock, Briefcase, UserMinus,
  UserX, HelpCircle, CornerDownRight, UserPlus, Download, List,
} from 'lucide-react';

import GlassViewLayout from '../../components/GlassViewLayout';
import FilterBar from '../../components/common/FilterBar';
import ViewTabBar from '../../components/common/ViewTabBar';
import Notice from '../../components/common/Notice';
import Badge from '../../components/common/Badge';
import LiquidAvatar from '../../components/common/LiquidAvatar';
import OjoDeTarjeta from '../../components/common/OjoDeTarjeta';
import { EmptyState } from '../../components/common/StateViews';
import Button from '../../components/common/Button';

import { useStaffStore as useStaff } from '../../store/staffStore';
import { useAuth } from '../../context/AuthContext';
import { clickable } from '../../utils/clickable';
import { getEffectiveStatus } from '../../utils/helpers';
import { getRoleTheme } from '../../utils/scheduleHelpers';
import { cadenaDeSuperiores } from '../../utils/roles';
import { repartirSala, puestosVacantesConGente } from '../../utils/mandoDeSala';
import { getExpiringDocuments } from '../../utils/documentExpiry';
import { soloPersonalEnPlanilla } from '../../utils/tipoDeFicha';
import { exportarDirectorio } from '../../utils/directorioCsv';
import { shortEmployeeName } from '../../utils/nameUtils';
import { smartFilter } from '../../utils/searchUtils';
import { calcAge, MINOR_AGE } from '../../utils/ageUtils';
import { SIN_ASIGNAR } from '../../data/constants';

/*
 * Equipos por sucursal — BOCETO (2026-08-26).
 *
 * Propuesta de reemplazo para la mitad «mirar» de `/personal`, que hoy es una
 * tabla paginada. Vive en su propia dirección a propósito: mientras se decide,
 * `/personal` no cambia ni una línea.
 *
 * ── Por qué agrupar ────────────────────────────────────────────────────────
 * Son 46 personas en 8 sucursales, de 5 a 8 por sala. La tabla YA ordena por
 * sucursal (`getBranchWeight`) pero no lo dice: el grupo hay que adivinarlo
 * leyendo una columna que se repite. Y pagina de a 25, así que la mitad de la
 * empresa vive en la página 2 sin ningún motivo. Agrupada, entra entera.
 *
 * ── Por qué no cuesta una consulta ─────────────────────────────────────────
 * Todo lo que la tarjeta muestra ya viaja en el boot (`systemSlice`, bloque de
 * empleados): `history` son los eventos, `role`/`secondary_role` los cargos,
 * `documents` el expediente, y `roles` trae `parent_role_id`. Cero fetch nuevo.
 *
 * ── Lo que este boceto NO puede mostrar todavía ────────────────────────────
 * Medido en producción el 2026-08-26: `employee_events` tiene CUATRO filas en
 * toda la tabla —3 traslados y 1 ascenso—. Ni una vacación, ni un permiso, ni
 * una incapacidad, ni vigente ni histórica. O sea que `getEffectiveStatus`
 * devuelve «Activo» para las 46 fichas.
 *
 * Por eso la franja de estado se pinta SÓLO cuando hay algo que decir. Una
 * píldora «Activo» repetida 46 veces no informa: enseña a no mirarla, y el día
 * que aparezca la primera vacación va a pasar desapercibida entre las otras 45.
 */

// ── Estado vigente, con la fecha de vuelta ─────────────────────────────────
//
// `getEffectiveStatus` devuelve el ROTULO y nada más, y ese es justo el dato
// que le falta a quien mira: «En Vacaciones» sin fecha no dice si la persona
// vuelve mañana o en dos semanas. El evento que lo causa ya está en
// `emp.history` con su `endDate` — sólo hay que devolverlo junto al rótulo.
//
// Si el boceto se aprueba, esto sube a `utils/helpers.js` al lado de
// `getEffectiveStatus`; se queda acá mientras la vista sea una propuesta.
const TEMPORALES = ['VACATION', 'DISABILITY', 'SUPPORT', 'PERMIT', 'INDUCTION'];

const ROTULO_TEMPORAL = {
  DISABILITY: { texto: 'Incapacitado',  icon: Stethoscope, variante: 'danger'  },
  VACATION:   { texto: 'En vacaciones', icon: Palmtree,    variante: 'warning' },
  SUPPORT:    { texto: 'En apoyo',      icon: Briefcase,   variante: 'chart-9' },
  INDUCTION:  { texto: 'En inducción',  icon: Baby,        variante: 'chart-6' },
  PERMIT:     { texto: 'Con permiso',   icon: Clock,       variante: 'chart-3' },
};

const ROTULO_FIJO = {
  Inactivo:   { texto: 'Inactivo',   icon: UserMinus, variante: 'neutral' },
  Liquidado:  { texto: 'Liquidado',  icon: UserX,     variante: 'danger'  },
  Suspendido: { texto: 'Suspendido', icon: HelpCircle,variante: 'danger'  },
};

const hoyISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// «Vuelve el 2 de septiembre», no «2026-09-02». La fecha cruda obliga a contar
// días con los dedos; lo que se necesita saber es si la persona está mañana.
//
// Sin el día de la semana a propósito: `es-SV` lo abrevia con coma —«mié, 2
// sept»— y dentro de la píldora eso se lee «vuelve el mié, 2 sept», con una
// coma que parte la frase justo donde no va. El mes largo entra igual y se lee
// como una fecha dicha en voz alta.
const fechaCorta = (iso) => {
  if (!iso) return null;
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('es-SV', { day: 'numeric', month: 'long' });
};

function estadoVigente(emp) {
  const fijo = ROTULO_FIJO[getEffectiveStatus(emp)];
  if (fijo) return { ...fijo, hasta: null };

  const t = hoyISO();
  const ev = (emp?.history || []).find(h =>
    TEMPORALES.includes(h.type) &&
    h.date <= t &&
    ((h.metadata?.endDate ?? h.endDate) >= t || !(h.metadata?.endDate ?? h.endDate))
  );
  if (!ev) return null;                      // Activo: no se pinta nada.

  const cfg = ROTULO_TEMPORAL[ev.type];
  if (!cfg) return null;
  return { ...cfg, hasta: fechaCorta(ev.metadata?.endDate ?? ev.endDate) };
}

// ── Lo que hoy vive escondido tras `hover` ─────────────────────────────────
// En la tabla los enlaces de teléfono son `opacity-0 group-hover:opacity-100`,
// o sea invisibles en el teléfono, que es donde a alguien le hace falta llamar
// a un compañero de otra sala. En la tarjeta van visibles.
const soloDigitos = (tel) => String(tel || '').replace(/\D/g, '');

// ── Alertas: una línea, no cuatro insignias compitiendo ────────────────────
// La fila de hoy pone pendientes, cumpleaños, aniversario y vencimiento TODAS
// al lado del nombre, y las cuatro pelean por el mismo renglón. Acá el nombre
// se queda solo y las alertas bajan a su propia línea.
function alertasDe(emp) {
  const salida = [];

  const faltan = [];
  if (!emp.dui) faltan.push('DUI');
  if (!emp.birth_date) faltan.push('fecha de nacimiento');
  if (!emp.isss_number && !emp.afp_number) faltan.push('ISSS / AFP');
  const menor = (calcAge(emp.birth_date) ?? 99) < MINOR_AGE;
  const docs = emp.employee_documents || [];
  const tieneIdentidad = menor
    ? docs.some(d => d.category === 'DOCUMENTO_IDENTIDAD' && d.url)
    : docs.some(d => d.category === 'DUI_FRENTE' && d.url) && docs.some(d => d.category === 'DUI_REVERSO' && d.url);
  if (!tieneIdentidad) faltan.push('documento de identidad');
  if (faltan.length) {
    salida.push({
      key: 'pendiente', icon: AlertCircle, variante: 'warning',
      texto: faltan.length === 1 ? 'Falta 1 dato' : `Faltan ${faltan.length} datos`,
      title: `Información pendiente: ${faltan.join(', ')}`,
    });
  }

  const doc = getExpiringDocuments(docs)[0];
  if (doc) {
    const vencido = doc.daysLeft < 0;
    salida.push({
      key: 'documento', icon: ShieldAlert, variante: vencido ? 'danger' : 'warning',
      texto: vencido ? 'Documento vencido' : `Vence en ${doc.daysLeft} d`,
      title: `${doc.title || doc.category}: ${vencido ? 'vencido' : `vence en ${doc.daysLeft} día${doc.daysLeft === 1 ? '' : 's'}`}`,
    });
  }

  if (emp.birth_date) {
    const b = new Date(`${emp.birth_date}T12:00:00`);
    const hoy = new Date(); hoy.setHours(12, 0, 0, 0);
    if (b.getMonth() === hoy.getMonth()) {
      const esteAnio = new Date(hoy.getFullYear(), b.getMonth(), b.getDate(), 12, 0, 0, 0);
      const dias = Math.round((esteAnio - hoy) / 86400000);
      if (dias >= 0) {
        const cumple = hoy.getFullYear() - b.getFullYear();
        salida.push({
          key: 'cumple', icon: Cake, variante: 'chart-6',
          texto: dias === 0 ? `¡Hoy cumple ${cumple}!` : dias === 1 ? 'Cumple mañana' : `Cumple en ${dias} días`,
          title: `Cumple ${cumple} años el día ${b.getDate()}`,
        });
      }
    }
  }

  if (emp.hire_date) {
    const h = new Date(`${emp.hire_date}T12:00:00`);
    const hoy = new Date();
    if (h.getMonth() === hoy.getMonth() && h.getFullYear() < hoy.getFullYear()) {
      const anios = hoy.getFullYear() - h.getFullYear();
      salida.push({
        key: 'aniversario', icon: Medal, variante: 'success',
        texto: `${anios} año${anios === 1 ? '' : 's'} en la empresa`,
        title: `Aniversario laboral el día ${h.getDate()} de este mes`,
      });
    }
  }

  return salida;
}

const cargosDe = (emp) => [emp.role, emp.secondary_role || emp.secondaryRole].filter(Boolean);

// ── Orden de las secciones ────────────────────────────────────────────────
// El mismo criterio que ya usa la tabla, para que cambiar de vista no cambie
// el orden de las salas y haya que volver a buscarlas.
const pesoDeSucursal = (nombre) => {
  const b = (nombre || '').toUpperCase();
  if (b.includes('POPULAR')) return 1;
  if (b.includes('SALUD')) return 2;
  if (b.includes('BODEGA')) return 3;
  if (b.includes('ADMIN')) return 5;
  if (b.includes('EXTERNO')) return 99;
  return 4;
};

// ── La tarjeta ────────────────────────────────────────────────────────────
// `data-surface="card"` y no un `<div>` con borde y radio a mano: dibujarla a
// mano deja el radio FIJO cuando `--card-radius` cambia por tema, y falla la
// categoría `tarjeta-a-mano` de `gate:design`.
function TarjetaPersona({ emp, sucursal, roles, nombreDeSucursal, destacada = false, conSuperior = false, lugar, abrir }) {
  const estado = useMemo(() => estadoVigente(emp), [emp]);
  const alertas = useMemo(() => alertasDe(emp), [emp]);
  const cargos = cargosDe(emp);
  const tel = soloDigitos(emp.phone);

  // ── Las áreas que cubre, cuando son más de la suya ─────────────────────
  // Hay puestos que existen porque recorren —mantenimiento repara en las
  // ocho—. Decirlo es lo contrario de «se sobreentiende que las cubre todas»:
  // ese default es indistinguible de «nadie lo llenó», y el día que alguien
  // cubra sólo tres, nadie lo nota.
  const cobertura = useMemo(() => {
    const ids = emp.assigned_branch_ids || [];
    if (ids.length < 2) return null;
    const nombres = ids.map(id => nombreDeSucursal?.get(Number(id))).filter(Boolean);
    return { cuantas: ids.length, detalle: nombres.join(', ') };
  }, [emp.assigned_branch_ids, nombreDeSucursal]);

  // A quién responde — sale del árbol de `roles`, no de adivinar por el
  // nombre del cargo. Sólo en la jefatura y en los adscritos: en el equipo el
  // superior ES el encabezado de la sección, y repetirlo en cada tarjeta sería
  // ruido. En los adscritos es al revés — es el dato que explica por qué están
  // aparte.
  const respondeA = useMemo(() => {
    if (!destacada && !conSuperior) return null;
    const [padre] = cadenaDeSuperiores(roles, emp.role_id);
    return (roles || []).find(r => String(r.id) === String(padre))?.name || null;
  }, [destacada, conSuperior, roles, emp.role_id]);

  return (
    <div
      data-surface="card"
      /* `data-lugar` no cambia un pixel y convierte la pregunta en una
         respuesta: desde afuera, «¿esta tarjeta es la jefatura o un adscrito?»
         se contesta con el tamaño o con la presencia de la línea «Responde
         a…», y las dos sondas fallan —la de tamaño es CSS, y la línea la
         llevan los dos—. En tiempo de render sí se sabe. Es lo mismo que
         `data-destino` hizo por las fichas y `data-vacio` por los vacíos. */
      data-lugar={lugar}
      /* `clickable` aunque la tarjeta contenga dos `<a>`: la nota del helper
         («si ya hay un enlace adentro, el teclado llega por ahí») habla de dos
         afordancias para la MISMA acción. Acá son tres acciones distintas —
         abrir el expediente, escribir por WhatsApp, llamar—, así que sin esto
         la principal sería la única sin camino de teclado. */
      {...clickable(() => abrir(emp), { label: `Abrir la ficha de ${emp.name || 'la persona'}` })}
      /* Sin `hover:-translate-y-*` propio: `data-surface="card"` ya levanta con
         `--lift-card`, y el segundo se SUMA al primero (DESIGN.md §5). */
      className={`group relative flex gap-3 p-3.5 transition-all duration-[var(--dur-base)]
        active:scale-[0.99] ${destacada ? 'md:col-span-2' : ''}`}
    >
      <OjoDeTarjeta className="absolute top-3 right-3" />

      <div className={`shrink-0 overflow-hidden rounded-xl border border-border-card bg-surface-card
        ${destacada ? 'h-16 w-16' : 'h-12 w-12'}`}>
        <LiquidAvatar
          src={emp.photo || emp.photo_url}
          alt={emp.name || 'Empleado'}
          fallbackText={shortEmployeeName(emp)}
          className="h-full w-full"
        />
      </div>

      <div className="min-w-0 flex-1 space-y-1.5">
        <p className={`truncate pr-6 font-black tracking-tight text-content
          ${destacada ? 'text-body' : 'text-body-sm'}`} title={emp.name}>
          {emp.name || shortEmployeeName(emp)}
        </p>

        <div className="flex flex-wrap items-center gap-1">
          {cargos.map((c, i) => (
            <Badge key={i} variant={getRoleTheme(c).variante} size="sm">{c}</Badge>
          ))}
          {!cargos.length && <Badge variant="neutral" size="sm">Sin cargo</Badge>}
        </div>

        {cobertura && (
          <Badge variant="chart-9" size="sm" icon={MapPin} uppercase={false} title={cobertura.detalle}>
            Cubre {cobertura.cuantas} áreas
          </Badge>
        )}

        {respondeA && (
          <p className="flex items-center gap-1 text-micro font-bold uppercase tracking-widest text-content-3">
            <CornerDownRight size={11} strokeWidth={2.5} className="shrink-0" />
            <span className="truncate">Responde a {respondeA}</span>
          </p>
        )}

        {/* Sólo cuando hay algo que decir — ver la nota del encabezado. */}
        {estado && (
          <Badge variant={estado.variante} size="sm" icon={estado.icon} uppercase={false}>
            {estado.texto}{estado.hasta ? ` · vuelve el ${estado.hasta}` : ''}
          </Badge>
        )}

        {!!alertas.length && (
          <div className="flex flex-wrap items-center gap-1">
            {alertas.map(a => (
              <Badge key={a.key} variant={a.variante} size="sm" icon={a.icon} uppercase={false} title={a.title}>
                {a.texto}
              </Badge>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 pt-0.5">
          <span className="truncate text-micro font-black uppercase tracking-widest text-content-3">
            {sucursal || SIN_ASIGNAR}
          </span>
          {tel.length >= 8 && (
            <span className="ml-auto flex items-center gap-1.5">
              {/* `stopPropagation`: la tarjeta entera abre la ficha, así que sin
                  esto llamar por teléfono además navegaría. */}
              <a href={`https://wa.me/${tel}`} target="_blank" rel="noreferrer"
                 onClick={e => e.stopPropagation()} title={`WhatsApp a ${emp.name || ''}`}
                 className="blanco-tactil relative rounded-full bg-success/10 p-1.5 text-success
                   transition-all hover:scale-110 active:scale-[0.97]">
                <MessageCircle size={12} strokeWidth={3} />
              </a>
              <a href={`tel:${tel}`} onClick={e => e.stopPropagation()} title={`Llamar a ${emp.name || ''}`}
                 className="blanco-tactil relative rounded-full bg-brand/10 p-1.5 text-brand-text
                   transition-all hover:scale-110 active:scale-[0.97]">
                <Phone size={12} strokeWidth={3} />
              </a>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── El puesto que falta ───────────────────────────────────────────────────
// Pedido del usuario: «si no hay subjefe, que aparezca el espacio pendiente».
// Un hueco dibujado dice algo que una ausencia no dice — la sala de al lado sí
// lo tiene, y esta no. Sólo se pinta para un cargo que existe ocupado en otra
// parte de la empresa; ver el motivo en `mandoDeSala.js`.
function PuestoVacante({ cargo }) {
  return (
    <div data-surface="card"
      className="flex items-center gap-3 border-dashed p-3.5 opacity-70 md:col-span-2">
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl
        border border-dashed border-border-card text-content-3">
        <UserPlus size={22} strokeWidth={2} />
      </div>
      <div className="min-w-0">
        <p className="text-body font-black tracking-tight text-content-2">Puesto sin cubrir</p>
        <Badge variant="neutral" size="sm" className="mt-1">{cargo}</Badge>
      </div>
    </div>
  );
}

// ── El pulso de la sala ───────────────────────────────────────────────────
// Los `StatCard` de `/personal` cuentan la EMPRESA entera. Cuántos hay hoy en
// Salud 2 —y cuántos de ellos están ausentes— no se puede saber en ninguna
// pantalla del portal. Es lo que este renglón contesta.
function PulsoDeSala({ personas }) {
  const conteo = useMemo(() => {
    const m = new Map();
    personas.forEach(p => {
      const e = estadoVigente(p);
      const k = e ? e.texto : 'Activos';
      m.set(k, (m.get(k) || 0) + 1);
    });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [personas]);

  return (
    <p className="text-caption font-bold text-content-2">
      {personas.length} persona{personas.length === 1 ? '' : 's'}
      {conteo.map(([k, n]) => (
        <span key={k} className="text-content-3"> · {n} {k.toLowerCase()}</span>
      ))}
    </p>
  );
}

function SeccionSucursal({ seccion, roles, nombreDeSucursal, abrir }) {
  const { sucursal, sinSede, personas, jefe, segundos, vacantesDeSegundo, equipo, adscritos } = seccion;

  return (
    <section className="space-y-3">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-divider pb-2">
        <h2 className="flex items-center gap-2 text-body font-black tracking-tight text-content">
          <MapPin size={15} strokeWidth={2.5} className="shrink-0 text-content-3" />
          {sinSede ? 'Sin sucursal asignada' : sucursal}
        </h2>
        <PulsoDeSala personas={personas} />
        {/* Un hueco se DICE. Que una sala no tenga jefatura no es un renglón
            vacío que nadie mira: es un hallazgo, y acá es donde se ve. */}
        {!jefe && !sinSede && (
          <Badge variant="warning" size="sm" icon={AlertCircle} uppercase={false}>
            Sin jefatura
          </Badge>
        )}
      </header>

      {sinSede && (
        <Notice variant="warning" icon={AlertCircle}>
          Estas fichas no tienen sucursal, así que no aparecen en ningún equipo
          ni en el conteo de ninguna sala. Falta elegirles una sede.
        </Notice>
      )}

      {/* La jefatura y su segundo, en su propia fila y siempre arriba. */}
      {(jefe || !!vacantesDeSegundo.length) && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {jefe && (
            <TarjetaPersona key={jefe.id} emp={jefe} sucursal={sucursal} roles={roles} nombreDeSucursal={nombreDeSucursal} destacada lugar="jefatura" abrir={abrir} />
          )}
          {segundos.map(emp => (
            <TarjetaPersona key={emp.id} emp={emp} sucursal={sucursal} roles={roles} nombreDeSucursal={nombreDeSucursal} destacada lugar="segundo" abrir={abrir} />
          ))}
          {vacantesDeSegundo.map(cargo => (
            <PuestoVacante key={cargo.id} cargo={cargo.name} />
          ))}
        </div>
      )}

      {!!equipo.length && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {equipo.map(emp => (
            <TarjetaPersona key={emp.id} emp={emp} sucursal={sucursal} roles={roles} nombreDeSucursal={nombreDeSucursal} lugar="equipo" abrir={abrir} />
          ))}
        </div>
      )}

      {/* Trabaja acá y responde a otro. Va aparte para no decir que la
          jefatura de sala lo dirige, que es lo que haría meterlo en el equipo. */}
      {!!adscritos.length && (
        <>
          <p className="pt-1 text-micro font-black uppercase tracking-widest text-content-3">
            También en esta sala
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {adscritos.map(emp => (
              <TarjetaPersona key={emp.id} emp={emp} sucursal={sucursal} roles={roles} nombreDeSucursal={nombreDeSucursal} conSuperior lugar="adscrito" abrir={abrir} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export default function EquiposView({ searchTerm, setSearchTerm, selectedBranch, setSelectedBranch, openModal }) {
  const navigate = useNavigate();
  const employees = useStaff(s => s.employees);
  const branches = useStaff(s => s.branches);
  const roles = useStaff(s => s.roles);
  const employeesStatus = useStaff(s => s.employeesStatus);
  const { user, getScope, hasPermission } = useAuth();
  const canEdit = hasPermission('staff_list', 'can_edit');
  // El CSV se lleva el padrón fuera del portal — permiso aparte de consultarlo
  // en pantalla (canon 2026-08-03).
  const canDownload = hasPermission('staff_list_descargar');

  const busqueda = (searchTerm || '').trim();

  const nombreDeSucursal = useMemo(() => {
    const m = new Map();
    (branches || []).forEach(b => m.set(Number(b.id), b.name));
    return m;
  }, [branches]);

  // ── Dos listas, y la diferencia importa ────────────────────────────────
  //
  // `plantilla` es todo lo que hay con vida en el alcance, fichas técnicas y de
  // servicio incluidas. NO se dibuja: contesta «¿alguien ocupa este cargo?».
  // `visibles` es lo que sí se pinta. Medirlo todo sobre la lista visible haría
  // que Administración anunciara «Contador Externo: puesto sin cubrir» sobre un
  // puesto ocupado que sólo no se muestra.
  const plantilla = useMemo(() => {
    const base = getScope('staff_list') !== 'ALL'
      ? (employees || []).filter(e => String(e.branch_id || e.branchId) === String(user?.branchId))
      : (employees || []);
    return base.filter(e => !['INACTIVO', 'Inactivo', 'LIQUIDADO', 'Liquidado'].includes(e.status));
  }, [employees, getScope, user?.branchId]);

  // Mismo alcance que el listado: quien sólo ve su sala, sólo ve su sala.
  const visibles = useMemo(() => {
    const base = getScope('staff_list') !== 'ALL'
      ? (employees || []).filter(e => String(e.branch_id || e.branchId) === String(user?.branchId))
      : (employees || []);
    // Las cuentas externas y del sistema no son personal y no arman equipo.
    // Siguen alcanzables en `/personal?tab=externos`.
    const personas = soloPersonalEnPlanilla(base)
      .filter(e => !['INACTIVO', 'Inactivo', 'LIQUIDADO', 'Liquidado'].includes(e.status))
      .filter(e => !selectedBranch || selectedBranch === 'ALL' ||
        String(e.branchId ?? e.branch_id ?? '') === String(selectedBranch));
    if (!busqueda) return personas;
    return smartFilter(busqueda, personas, e => [
      e?.name, e?.role, e?.secondary_role,
      nombreDeSucursal.get(Number(e?.branchId || e?.branch_id)),
    ]).results;
  }, [employees, getScope, user?.branchId, busqueda, selectedBranch, nombreDeSucursal]);

  // ── El reparto ────────────────────────────────────────────────────────
  // Las tres reglas —y por qué el primer boceto las tenía mal— viven en
  // `utils/mandoDeSala.js`. Acá sólo se agrupa por sala y se ordena.
  //
  // `visibles` completo se le pasa a cada sala a propósito: para saber si un
  // puesto intermedio está VACANTE hay que mirar la empresa entera, no la sala.
  const secciones = useMemo(() => {
    const porSucursal = new Map();
    visibles.forEach(e => {
      const id = Number(e.branchId || e.branch_id) || 0;
      if (!porSucursal.has(id)) porSucursal.set(id, []);
      porSucursal.get(id).push(e);
    });

    return [...porSucursal.entries()]
      .map(([id, personas]) => ({
        id,
        // `id === 0` no es una sucursal: es una ficha sin sede. Se dice, no se
        // disfraza de sala — ver el aviso de la sección.
        sinSede: id === 0,
        sucursal: nombreDeSucursal.get(id) || SIN_ASIGNAR,
        ...repartirSala({ personas, todos: plantilla, roles, sucursalId: id || null }),
        personas,
      }))
      .sort((a, b) => {
        // La ficha sin sede va al final: es un pendiente, no una sala.
        if (a.sinSede !== b.sinSede) return a.sinSede ? 1 : -1;
        const pa = pesoDeSucursal(a.sucursal);
        const pb = pesoDeSucursal(b.sucursal);
        if (pa !== pb) return pa - pb;
        return a.sucursal.localeCompare(b.sucursal);
      });
  }, [visibles, plantilla, roles, nombreDeSucursal]);

  // Los puestos intermedios que nadie ocupa, dichos UNA vez para toda la
  // empresa en vez de repetir la explicación en cada tarjeta.
  const vacantes = useMemo(
    () => puestosVacantesConGente({ todos: plantilla, roles }), [plantilla, roles]);

  const abrir = (emp) => navigate(`/personal/empleado/${emp.id}`);
  const cargando = employeesStatus !== 'ready' && !employees.length;

  const opcionesDeSucursal = useMemo(() => ([
    { value: 'ALL', label: 'Todas las sucursales' },
    ...(branches || []).map(b => ({ value: String(b.id), label: b.name })),
  ]), [branches]);

  // Las acciones de la vista, en la píldora del cuerpo (§17). «Ver como lista»
  // no es una pestaña: es la salida hacia lo que una tarjeta no puede hacer
  // —ordenar por columna, y administrar practicantes y cuentas externas—.
  const acciones = [
    { key: 'empleado', icon: UserPlus, label: 'Nuevo empleado', variant: 'primary',
      disabled: !canEdit, onClick: () => openModal?.('newEmployee') },
    { key: 'lista', icon: List, label: 'Ver como lista', rotulo: 'Lista',
      onClick: () => navigate('/personal/listado') },
    ...(canDownload ? [{ key: 'exportar', icon: Download, label: 'Exportar',
      soloIcono: true, onClick: () => exportarDirectorio(visibles, nombreDeSucursal) }] : []),
  ];

  return (
    <GlassViewLayout
      icon={Users}
      title="Gestión de personal"
      filtersContent={
        <ViewTabBar
          searchValue={searchTerm}
          onSearchChange={setSearchTerm}
          placeholder="Buscar por nombre, cargo o sucursal..."
        />
      }
    >
      <div className="animate-in fade-in space-y-6 p-4 duration-[var(--dur-lento)] md:p-6 lg:p-8">

        <div className="flex justify-end">
          <FilterBar
            onClear={() => { setSearchTerm(''); setSelectedBranch?.('ALL'); }}
            activeCount={[selectedBranch && selectedBranch !== 'ALL'].filter(Boolean).length}
            acciones={acciones}
          >
            {/* La ranura es del ALCANCE, no del catálogo: con alcance de una
                sala, elegir otra devolvería una vista vacía sin explicar por
                qué, y un filtro que no puede encontrar nada es peor que no
                estar. Mismo criterio que el listado. */}
            {getScope('staff_list') === 'ALL' && (
              <FilterBar.Section active={selectedBranch && selectedBranch !== 'ALL'} label="sucursal">
                <FilterBar.Sucursal
                  value={selectedBranch || 'ALL'}
                  onChange={val => setSelectedBranch?.(val)}
                  options={opcionesDeSucursal}
                />
              </FilterBar.Section>
            )}
          </FilterBar>
        </div>

        {cargando && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} data-surface="card" className="h-28 animate-pulse opacity-60" />
            ))}
          </div>
        )}

        {!cargando && !secciones.length && (
          <EmptyState
            icon={Search}
            title="Sin personal"
            subtitle={busqueda ? 'Prueba con otro nombre o cargo.' : 'Todavía no hay personal cargado.'}
            action={busqueda
              ? <Button variant="secondary" size="sm" onClick={() => setSearchTerm('')}>Limpiar búsqueda</Button>
              : undefined}
          />
        )}

        {/* Los puestos intermedios vacíos, dichos una sola vez. Sin esto la
            tarjeta de una regente de enfermería diría «responde al Supervisor
            del Departamento Médico», que es cierto en el organigrama y falso
            en la sala: ese puesto no lo ocupa nadie. */}
        {!cargando && !!vacantes.length && (
          <Notice variant="warning" icon={AlertCircle}>
            {vacantes.map(v => `${v.nombre} (${v.personas} ${v.personas === 1 ? 'persona' : 'personas'})`).join(' · ')}
            {' — '}
            {vacantes.length === 1 ? 'este puesto está' : 'estos puestos están'} sin cubrir, así que
            {' '}quienes dependen de {vacantes.length === 1 ? 'él' : 'ellos'} responden a la jefatura de su sala.
          </Notice>
        )}

        {!cargando && secciones.map(s => (
          <SeccionSucursal key={s.id} seccion={s} roles={roles} nombreDeSucursal={nombreDeSucursal} abrir={abrir} />
        ))}

      </div>
    </GlassViewLayout>
  );
}
