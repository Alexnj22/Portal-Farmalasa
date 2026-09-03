import React, { useMemo, useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, Search, MapPin, Phone, MessageCircle, AlertCircle, ShieldAlert,
  Cake, Medal, CornerDownRight, UserPlus, Download, GraduationCap,
  Pencil, Trash2, RefreshCw, ShieldCheck, CalendarDays,
} from 'lucide-react';

import GlassViewLayout from '../../components/GlassViewLayout';
import FilterBar from '../../components/common/FilterBar';
import ViewTabBar from '../../components/common/ViewTabBar';
import Notice from '../../components/common/Notice';
import Badge from '../../components/common/Badge';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import OjoDeTarjeta from '../../components/common/OjoDeTarjeta';
import ConfirmModal from '../../components/common/ConfirmModal';
// El formulario del practicante sólo existe si alguien aprieta «Nuevo
// practicante», y trae su propio validador, sus catálogos y su red. Estático
// viajaba en el paquete de una pantalla que se abre para MIRAR — es la regla de
// «librerías pesadas sólo por await import()» aplicada a un formulario: al
// absorber lo que hacía el listado, esta vista pasó de 37 a 54 kB y cruzó su
// techo. Diferido vuelve a entrar.
const PracticanteModal = lazy(() => import('../../components/practicantes/PracticanteModal'));
import { EmptyState } from '../../components/common/StateViews';
import Button from '../../components/common/Button';

import { useStaffStore as useStaff } from '../../store/staffStore';
import { useAuth } from '../../context/AuthContext';
import { clickable } from '../../utils/clickable';
import { estadoDePersona, estaAusenteHoy } from '../../utils/estadoDePersona';
import { getRoleTheme } from '../../utils/scheduleHelpers';
import { cadenaDeSuperiores } from '../../utils/roles';
import { repartirSala } from '../../utils/mandoDeSala';
import { getExpiringDocuments } from '../../utils/documentExpiry';
import { soloPersonalEnPlanilla, soloNoEmpleados, esFichaQueNoEsEmpleado } from '../../utils/tipoDeFicha';
import { exportarDirectorio } from '../../utils/directorioCsv';
import { shortEmployeeName } from '../../utils/nameUtils';
import { usePestanaEnUrl } from '../../hooks/usePestanaEnUrl';
import { useToastStore } from '../../store/toastStore';
import { mensajeAmigable } from '../../utils/errorMessages';
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

// ── Las cinco vistas que ofrece la píldora ────────────────────────────────
//
// Los valores son SLUGS y viajan en la dirección (`?tab=practicantes`): un
// rótulo como `?tab=Externos+y+sistema` es feo de compartir, se rompe al
// escribirlo a mano, y deja de funcionar el día que alguien corrige el texto.
// Es «un rótulo no es una clave» aplicado a una pestaña.
const VISTAS = [
  { value: 'todos',        label: 'Todos' },
  { value: 'activos',      label: 'Activos' },
  { value: 'ausentes',     label: 'Ausentes' },
  { value: 'practicantes', label: 'Practicantes' },
  { value: 'externos',     label: 'Externos y sistema' },
];

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
  const menor = (calcAge(emp.birth_date) ?? 99) < MINOR_AGE;
  if (!emp.birth_date) faltan.push('fecha de nacimiento');

  // ── Sólo se acusa de faltar lo que se pudo mirar ─────────────────────────
  // El DUI, el ISSS y la AFP salieron de `employees_safe` el 2026-08-24 y hoy
  // llegan por `get_employee_identidad`, que contesta según quien pregunta:
  // sin `staff_detail` devuelve la fila PROPIA y nada más. Leerlos de la fila
  // sin más daba `undefined`, y `undefined` es indistinguible de «no lo tiene»
  // — o sea que a un cargo con el listado y sin el expediente la pantalla le
  // decía «Faltan 2 datos» sobre las 48 fichas, todas con su DUI cargado.
  //
  // Y le pasaba a TODOS por un instante: `persistEmployees` borra esos campos
  // del caché del disco, así que la primera pintura de cada recarga —la que
  // sale del caché, antes de que `fetchBoot` conteste— los tiene vacíos.
  //
  // `identidad_conocida` es la respuesta del servidor, no el permiso: una fila
  // que volvió con todo en `null` SÍ es un dato que falta. Sin ella no se
  // acusa, que es el lado correcto en el que equivocarse — el expediente tiene
  // la lista completa del Art. 23 y ahí el dato no se esconde.
  if (emp.identidad_conocida) {
    // A un menor no se le pide DUI: en El Salvador no se tramita hasta los 18,
    // y el Art. 23 nº2 le pide el documento alterno. Pedírselo igual era una
    // alerta que no se podía apagar cargando el dato.
    // «número de…» y no «documento de identidad» a secas: unas líneas abajo
    // se revisa la IMAGEN con ese mismo nombre, y la lista se muestra unida
    // por comas — repetido, se leería como un solo dato dicho dos veces.
    if (menor) {
      if (!emp.alt_identity_document) faltan.push('número de documento de identidad');
    } else if (!emp.dui) {
      faltan.push('DUI');
    }
    if (!emp.isss_number && !emp.afp_number) faltan.push('ISSS / AFP');
  }

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
function TarjetaPersona({ emp, sucursal, roles, nombreDeSucursal, destacada = false, conSuperior = false, lugar, abrir, editar, recontratar, puedeEditar }) {
  const estado = useMemo(() => estadoDePersona(emp), [emp]);
  // `!!estado` ya no alcanza: durante la cuenta regresiva hay estado y la
  // persona está en la sala. Ver `estaAusenteHoy`.
  const ausente = !!estado && !estado.faltan;
  const alertas = useMemo(() => alertasDe(emp), [emp]);
  const cargos = cargosDe(emp);
  const tel = soloDigitos(emp.phone);
  const inactiva = ['INACTIVO', 'Inactivo', 'LIQUIDADO', 'Liquidado'].includes(emp.status);

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
      /* Mismo recurso, otra pregunta: «¿esta tarjeta muestra a alguien que no
         está?». Desde afuera se contestaría por el gris de la foto o por el
         relleno del chip, y las dos son CSS —jsdom no calcula ninguna—. Acá se
         sabe en tiempo de render. */
      data-ausente={ausente ? '' : undefined}
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

      {/* La foto y su aro. La marca vive en `AvatarConEstado` —y no acá— porque
          el usuario pidió que valga «en todos lados que salga la foto», y son
          48 pantallas: repetirla sería garantizar que once se queden atrás. */}
      <AvatarConEstado emp={emp} px={destacada ? 64 : 48} className="rounded-xl" />

      <div className="min-w-0 flex-1 space-y-1.5">
        <p className={`truncate pr-6 font-black tracking-tight
          ${ausente ? 'text-content-2' : 'text-content'}
          ${destacada ? 'text-body' : 'text-body-sm'}`} title={emp.name}>
          {emp.name || shortEmployeeName(emp)}
        </p>

        {/* Va ARRIBA de los cargos: «¿está?» se pregunta antes que «¿qué
            hace?». Y `tone="solid"` lo saca de la conversación de las otras
            píldoras — sólidas no hay ninguna más en la tarjeta. */}
        {estado && (
          <Badge variant={estado.variante} tone="solid" size="md" icon={estado.icon} uppercase={false}>
            {estado.texto}{estado.hasta ? ` · vuelve el ${estado.hasta}` : ''}
          </Badge>
        )}

        <div className={`flex flex-wrap items-center gap-1 ${ausente ? 'opacity-65' : ''}`}>
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

        {!!alertas.length && (
          <div className="flex flex-wrap items-center gap-1">
            {alertas.map(a => (
              <Badge key={a.key} variant={a.variante} size="sm" icon={a.icon} uppercase={false} title={a.title}>
                {a.texto}
              </Badge>
            ))}
          </div>
        )}

        {/* ── La fila de abajo: dónde trabaja, y qué se puede hacer ──────────
            Las acciones van VISIBLES y no detrás de `hover`. Es la misma
            decisión que con el teléfono: en el teléfono no hay puntero que las
            revele, así que una acción escondida en hover es una acción que en
            la mitad de las pantallas no existe.

            `inactiva` en vez de `dado de baja`: la edición rápida está apagada
            para quien ya no trabaja acá —igual que en el listado— porque
            reincorporar es otra cosa y tiene su propio botón. */}
        <div className="flex items-center gap-2 pt-0.5">
          <span className="truncate text-micro font-black uppercase tracking-widest text-content-3">
            {sucursal || SIN_ASIGNAR}
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            {inactiva && puedeEditar && recontratar && (
              <Button tone="success" size="sm" icon={RefreshCw} iconOnly title="Recontratar"
                onClick={e => { e.stopPropagation(); recontratar(emp); }} />
            )}
            {editar && (
              <Button tone="warning" size="sm" icon={Pencil} iconOnly title="Edición rápida"
                disabled={!puedeEditar || inactiva}
                onClick={e => { e.stopPropagation(); editar(emp); }} />
            )}
          </span>
          {tel.length >= 8 && (
            <span className="flex items-center gap-1.5">
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

// ── El practicante ────────────────────────────────────────────────────────
//
// Tabla aparte de `employees` a propósito (migración 20260709): un practicante
// hace horas sociales, no está en planilla y no tiene DUI, ISSS, expediente ni
// nómina. Por eso NO se reusa `TarjetaPersona`: sus alertas —«faltan 4 datos»—
// se dispararían todas, sobre campos que en esta tabla no existen. Sería
// inventarle un problema a alguien por no ser un empleado.
const PRACTICANTE_ESTADO = {
  ACTIVO:     { icon: ShieldCheck, label: 'Activo',     variante: 'success' },
  FINALIZADO: { icon: CalendarDays, label: 'Finalizado', variante: 'neutral' },
  CANCELADO:  { icon: Trash2,      label: 'Cancelado',  variante: 'danger' },
};

const fechaCortaDMA = (d) => {
  if (!d) return '—';
  const [y, m, dd] = String(d).split('-');
  return `${dd}/${m}/${y}`;
};

function TarjetaPracticante({ p, sucursal, onEdit, onDelete, puedeEditar }) {
  const est = PRACTICANTE_ESTADO[p.estado] || PRACTICANTE_ESTADO.ACTIVO;
  const nombre = `${p.first_names || ''} ${p.last_names || ''}`.trim();

  return (
    <div data-surface="card" data-lugar="practicante"
      className="group relative flex gap-3 p-3.5 transition-all duration-[var(--dur-base)]">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl
        border border-chart-3/30 bg-chart-3/10 text-chart-3-text">
        <GraduationCap size={20} strokeWidth={2} />
      </span>

      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="truncate font-black tracking-tight text-content text-body-sm" title={nombre}>
          {nombre}
        </p>
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant="chart-3" size="sm" icon={GraduationCap}>Practicante</Badge>
          <Badge variant={est.variante} size="sm" icon={est.icon} uppercase={false}>{est.label}</Badge>
        </div>
        <p className="truncate text-micro font-bold text-content-2" title={p.institucion_educativa}>
          {p.institucion_educativa || 'Sin institución'}
        </p>
        <p className="text-micro font-bold text-content-3" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {fechaCortaDMA(p.fecha_inicio)} → {fechaCortaDMA(p.fecha_fin)}
        </p>

        <div className="flex items-center gap-2 pt-0.5">
          <span className="truncate text-micro font-black uppercase tracking-widest text-content-3">
            {sucursal || SIN_ASIGNAR}
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            <Button tone="warning" size="sm" icon={Pencil} iconOnly title="Editar practicante"
              disabled={!puedeEditar} onClick={() => onEdit(p)} />
            <Button variant="destructive" size="sm" icon={Trash2} iconOnly title="Eliminar practicante"
              disabled={!puedeEditar} onClick={() => onDelete(p)} />
          </span>
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
      const e = estadoDePersona(p);
      // Quien tiene la cuenta regresiva corriendo TODAVÍA está: cuenta como
      // activo. Si no, el pulso de la sala restaría gente presente.
      const k = e && !e.faltan ? e.texto : 'Activos';
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

function SeccionSucursal({ seccion, roles, nombreDeSucursal, abrir, editar, recontratar, puedeEditar }) {
  const { sucursal, sinSede, personas, jefe, segundos, vacantesDeSegundo, equipo, adscritos } = seccion;

  // `every` sobre una lista vacía es `true`, y una sección sin personas no
  // existe (se arma agrupando lo que hay) — pero el guard queda escrito para que
  // el aviso no cambie de significado si algún día se pinta una sala vacía.
  const soloCuentasDelSistema = personas.length > 0 && personas.every(esFichaQueNoEsEmpleado);

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

      {/* Sin sede es un PENDIENTE para una persona y el estado NORMAL para una
          cuenta del sistema. Con un solo aviso, el grupo salía siempre en
          amarillo pidiendo elegirle una sede a la cuenta de pruebas y al
          Administrador del Sistema —que no trabajan en ninguna sala—, o sea un
          hallazgo permanente que nadie puede cerrar. Un aviso así se aprende a
          ignorar, y el día que ahí caiga una persona real no lo va a distinguir
          nadie. */}
      {sinSede && (
        soloCuentasDelSistema ? (
          <Notice variant="neutral">
            Son cuentas del portal, no personas: no trabajan en ninguna sala, así
            que no llevan sede. A la de pruebas se le asigna una sólo mientras se
            prueba algo, y se le quita al terminar.
          </Notice>
        ) : (
          <Notice variant="warning" icon={AlertCircle}>
            Estas fichas no tienen sucursal, así que no aparecen en ningún equipo
            ni en el conteo de ninguna sala. Falta elegirles una sede.
          </Notice>
        )
      )}

      {/* La jefatura y su segundo, en su propia fila y siempre arriba. */}
      {(jefe || !!vacantesDeSegundo.length) && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {jefe && (
            <TarjetaPersona key={jefe.id} emp={jefe} sucursal={sucursal} roles={roles} nombreDeSucursal={nombreDeSucursal} destacada lugar="jefatura" abrir={abrir} editar={editar} recontratar={recontratar} puedeEditar={puedeEditar} />
          )}
          {segundos.map(emp => (
            <TarjetaPersona key={emp.id} emp={emp} sucursal={sucursal} roles={roles} nombreDeSucursal={nombreDeSucursal} destacada lugar="segundo" abrir={abrir} editar={editar} recontratar={recontratar} puedeEditar={puedeEditar} />
          ))}
          {vacantesDeSegundo.map(cargo => (
            <PuestoVacante key={cargo.id} cargo={cargo.name} />
          ))}
        </div>
      )}

      {!!equipo.length && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {equipo.map(emp => (
            <TarjetaPersona key={emp.id} emp={emp} sucursal={sucursal} roles={roles} nombreDeSucursal={nombreDeSucursal} lugar="equipo" abrir={abrir} editar={editar} recontratar={recontratar} puedeEditar={puedeEditar} />
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
              <TarjetaPersona key={emp.id} emp={emp} sucursal={sucursal} roles={roles} nombreDeSucursal={nombreDeSucursal} conSuperior lugar="adscrito" abrir={abrir} editar={editar} recontratar={recontratar} puedeEditar={puedeEditar} />
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
  const practicantes = useStaff(s => s.practicantes);
  const practicantesLoading = useStaff(s => s.practicantesLoading);
  const fetchPracticantes = useStaff(s => s.fetchPracticantes);
  const deletePracticante = useStaff(s => s.deletePracticante);
  const { user, getScope, hasPermission } = useAuth();
  const canEdit = hasPermission('staff_list', 'can_edit');
  // El CSV se lleva el padrón fuera del portal — permiso aparte de consultarlo
  // en pantalla (canon 2026-08-03).
  const canDownload = hasPermission('staff_list_descargar');
  // Qué columnas del directorio se pueden llenar. El DUI llega por
  // `get_employee_identidad` (llave `staff_detail`) y el código de carné por
  // `get_vendedores` (llave `ventas`): sin la llave vienen vacías, y una
  // columna vacía en un CSV que se comparte por correo se lee como «acá nadie
  // tiene DUI». La columna que no se puede llenar no va — ver `directorioCsv`.
  const llavesDelDirectorio = {
    identidad: hasPermission('staff_detail', 'can_view'),
    credenciales: hasPermission('ventas', 'can_view'),
  };

  const busqueda = (searchTerm || '').trim();

  // Cuál de las cinco vistas está abierta ES una pestaña —«Practicantes» ni
  // siquiera lista los mismos registros— y una pestaña vive en la DIRECCIÓN.
  // En `useState` se perdía con cualquier recarga, y acá la recarga llega sola:
  // la sesión de sala se cierra a los 5 minutos y el service worker recarga al
  // publicar. Quien estaba en Practicantes volvía a Todos sin que nada fallara.
  const [vista, setVista] = usePestanaEnUrl(VISTAS, 'todos');
  const esPracticantes = vista === 'practicantes';
  const esExternos = vista === 'externos';

  const [modalPracticante, setModalPracticante] = useState(false);
  // Se monta la PRIMERA vez que se abre y ya no se desmonta: con el montaje
  // atado a `modalPracticante` el diálogo desaparecería de golpe al cerrar, sin
  // su animación de salida.
  const [pidioModal, setPidioModal] = useState(false);
  const [practicanteEnEdicion, setPracticanteEnEdicion] = useState(null);
  const [practicanteABorrar, setPracticanteABorrar] = useState(null);
  const [borrando, setBorrando] = useState(false);

  useEffect(() => { fetchPracticantes(); }, [fetchPracticantes]);

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
    // «Externos y sistema» es la ÚNICA vista que muestra fichas que no son
    // personal contratado. Las otras parten de la planilla, así que ninguna las
    // cuenta ni las exporta.
    const conTipo = esExternos ? soloNoEmpleados(base) : soloPersonalEnPlanilla(base);

    const personas = conTipo
      // Un solo predicado, y sale de `estadoDePersona`: devuelve algo cuando la
      // persona NO está —de vacaciones, incapacitada, o dada de baja—, y `null`
      // cuando está. Escribir «activos» como «no inactivo Y sin ausencia» era
      // decir dos veces lo mismo y abrir la puerta a que las dos listas se
      // separaran. «Ausentes» incluye a quien ya no trabaja acá a propósito:
      // es la vista donde se lo va a buscar para reincorporarlo.
      .filter(e => {
        if (vista === 'activos') return !estaAusenteHoy(e);
        if (vista === 'ausentes') return estaAusenteHoy(e);
        return true;
      })
      .filter(e => !selectedBranch || selectedBranch === 'ALL' ||
        String(e.branchId ?? e.branch_id ?? '') === String(selectedBranch));
    if (!busqueda) return personas;
    return smartFilter(busqueda, personas, e => [
      e?.name, e?.role, e?.secondary_role,
      nombreDeSucursal.get(Number(e?.branchId || e?.branch_id)),
    ]).results;
  }, [employees, getScope, user?.branchId, busqueda, selectedBranch, vista, esExternos, nombreDeSucursal]);

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

  // Acá vivía un aviso que listaba los puestos intermedios sin cubrir
  // —«Supervisor del Departamento Médico (7 personas) · Asistente de Logística
  // (5)»— para explicar por qué esa gente cuelga de la jefatura de sala. Lo
  // sacó el usuario el 2026-08-26: «¿por qué dice eso? no es necesario».
  //
  // Y es correcto: eso explicaba el MECANISMO del reparto, no un hecho del
  // negocio. Quien mira la pantalla quiere ver su equipo, no por qué el
  // algoritmo puso a cada uno donde lo puso. El hueco que sí importa —el
  // segundo puesto de la sala— ya se ve como tarjeta, en su sección.
  // Practicantes: mismo alcance, misma sucursal y misma búsqueda que la gente,
  // pero en su propio carril — la tabla está separada a propósito y sus campos
  // no calzan con los de un empleado.
  const practicantesVisibles = useMemo(() => {
    if (!esPracticantes) return [];
    const base = getScope('staff_list') !== 'ALL'
      ? (practicantes || []).filter(p => String(p.branch_id) === String(user?.branchId))
      : (practicantes || []);
    const porSala = base.filter(p => !selectedBranch || selectedBranch === 'ALL' ||
      String(p.branch_id) === String(selectedBranch));
    if (!busqueda) return porSala;
    return smartFilter(busqueda, porSala, p => [
      `${p.first_names || ''} ${p.last_names || ''}`.trim(),
      p.institucion_educativa, p.tutor_nombre,
      nombreDeSucursal.get(Number(p.branch_id)),
    ]).results;
  }, [esPracticantes, practicantes, getScope, user?.branchId, selectedBranch, busqueda, nombreDeSucursal]);

  const practicantesPorSala = useMemo(() => {
    const m = new Map();
    practicantesVisibles.forEach(p => {
      const id = Number(p.branch_id) || 0;
      if (!m.has(id)) m.set(id, []);
      m.get(id).push(p);
    });
    return [...m.entries()]
      .map(([id, lista]) => ({ id, sucursal: nombreDeSucursal.get(id) || SIN_ASIGNAR, lista }))
      .sort((a, b) => {
        const pa = pesoDeSucursal(a.sucursal), pb = pesoDeSucursal(b.sucursal);
        return pa !== pb ? pa - pb : a.sucursal.localeCompare(b.sucursal);
      });
  }, [practicantesVisibles, nombreDeSucursal]);

  const abrir = (emp) => navigate(`/personal/empleado/${emp.id}`);

  // ── El freno del arranque, que viajó con la mudanza ──────────────────────
  //
  // Tras un boot fresco, `employees` arranca con el snapshot SANITIZADO de
  // `localStorage` —`persistEmployees` le quita DUI, ISSS, AFP, banco y el
  // código de carné a propósito, para no dejarlos en texto plano en el disco de
  // una computadora compartida— mientras el fetch real todavía no responde. Si
  // alguien abre «Editar» en esa ventana de milisegundos, esos campos se ven
  // vacíos, y si guarda sin notarlo se sobrescriben con NULL en la base.
  //
  // Vivía en el listado, y borrar el listado se lo habría llevado. Es un freno
  // que no se puede perder por una mudanza de pantalla.
  const editarRapido = useCallback((emp) => {
    if (employeesStatus !== 'ready') {
      useToastStore.getState().showToast(
        'Cargando datos completos…',
        'Espera un momento y vuelve a intentar — se están terminando de traer los datos del empleado.',
        'info');
      return;
    }
    openModal?.('editEmployee', emp);
  }, [openModal, employeesStatus]);

  const recontratar = useCallback((emp) => openModal?.('rehireEmployee', emp), [openModal]);

  const borrarPracticante = useCallback(async () => {
    if (!practicanteABorrar) return;
    setBorrando(true);
    try {
      await deletePracticante(practicanteABorrar.id);
      useToastStore.getState().showToast('Eliminado',
        `${practicanteABorrar.first_names} ${practicanteABorrar.last_names}`, 'success');
      setPracticanteABorrar(null);
    } catch (err) {
      useToastStore.getState().showToast('Error', mensajeAmigable(err), 'error');
    } finally {
      setBorrando(false);
    }
  }, [deletePracticante, practicanteABorrar]);

  const cargando = esPracticantes
    ? (practicantesLoading && !practicantes.length)
    : (employeesStatus !== 'ready' && !employees.length);

  const hayAlgo = esPracticantes ? practicantesPorSala.length > 0 : secciones.length > 0;
  const hayFiltros = !!busqueda || (selectedBranch && selectedBranch !== 'ALL') || vista !== 'todos';
  const limpiar = useCallback(() => {
    setSearchTerm('');
    setSelectedBranch?.('ALL');
    setVista('todos');
  }, [setSearchTerm, setSelectedBranch, setVista]);

  const opcionesDeSucursal = useMemo(() => ([
    { value: 'ALL', label: 'Todas las sucursales' },
    ...(branches || []).map(b => ({ value: String(b.id), label: b.name })),
  ]), [branches]);

  // Las tres acciones de la vista, en la píldora del cuerpo (§17).
  const acciones = [
    { key: 'empleado', icon: UserPlus, label: 'Nuevo empleado', variant: 'primary',
      disabled: !canEdit, onClick: () => openModal?.('newEmployee') },
    // `rotulo`: bajo el pulgar la columna mide 60px y «PRACTICANTE» pide 76,8 —
    // es la única palabra del portal que no entra por sí sola. Se dice
    // «PASANTE», que es la misma persona en una palabra que sí entra; el nombre
    // completo sigue en el `aria-label` y en la píldora de escritorio.
    { key: 'practicante', icon: GraduationCap, label: 'Nuevo practicante', rotulo: 'Pasante',
      tone: 'chart-3', disabled: !canEdit,
      onClick: () => { setPracticanteEnEdicion(null); setPidioModal(true); setModalPracticante(true); } },
    // En «Externos y sistema» no se ofrece: lo único que exporta esta vista es
    // el directorio de PERSONAL, y ahí no hay ninguno.
    ...(canDownload && !esExternos && !esPracticantes ? [{ key: 'exportar', icon: Download,
      label: 'Exportar', soloIcono: true,
      onClick: () => exportarDirectorio(visibles, nombreDeSucursal, llavesDelDirectorio) }] : []),
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
            onClear={limpiar}
            activeCount={[selectedBranch && selectedBranch !== 'ALL', vista !== 'todos'].filter(Boolean).length}
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

            <FilterBar.Section active={vista !== 'todos'} onClear={() => setVista('todos')} label="vista">
              <FilterBar.Opciones
                label="Vista"
                icon={ShieldCheck}
                value={vista}
                onChange={val => setVista(val || 'todos')}
                options={VISTAS}
                ancho="170px"
              />
            </FilterBar.Section>
          </FilterBar>
        </div>

        {cargando && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} data-surface="card" className="h-28 animate-pulse opacity-60" />
            ))}
          </div>
        )}

        {!cargando && !hayAlgo && (
          <EmptyState
            icon={esPracticantes ? GraduationCap : Search}
            title={esPracticantes ? 'Sin practicantes' : esExternos ? 'Sin cuentas externas' : 'Sin personal'}
            subtitle={busqueda
              ? 'Prueba con otro nombre o cargo.'
              : 'Ajusta el filtro de sucursal o cambia de vista.'}
            action={hayFiltros
              ? <Button variant="secondary" size="sm" onClick={limpiar}>Limpiar filtros</Button>
              : undefined}
          />
        )}

        {/* Practicantes: agrupados por sala como todo lo demás, pero sin
            jefatura — hacen horas sociales y no cuelgan de nadie del
            organigrama. Por eso la sección es una lista y no un reparto. */}
        {!cargando && esPracticantes && practicantesPorSala.map(g => (
          <section key={g.id} className="space-y-3">
            <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-divider pb-2">
              <h2 className="flex items-center gap-2 text-body font-black tracking-tight text-content">
                <MapPin size={15} strokeWidth={2.5} className="shrink-0 text-content-3" />
                {g.sucursal}
              </h2>
              <p className="text-caption font-bold text-content-2">
                {g.lista.length} practicante{g.lista.length === 1 ? '' : 's'}
              </p>
            </header>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {g.lista.map(p => (
                <TarjetaPracticante
                  key={p.id} p={p} sucursal={g.sucursal} puedeEditar={canEdit}
                  onEdit={pr => { setPracticanteEnEdicion(pr); setPidioModal(true); setModalPracticante(true); }}
                  onDelete={setPracticanteABorrar}
                />
              ))}
            </div>
          </section>
        ))}

        {!cargando && !esPracticantes && secciones.map(s => (
          <SeccionSucursal
            key={s.id} seccion={s} roles={roles} nombreDeSucursal={nombreDeSucursal}
            abrir={abrir} editar={editarRapido} recontratar={recontratar} puedeEditar={canEdit}
          />
        ))}

      </div>

      {pidioModal && (
        <Suspense fallback={null}>
          <PracticanteModal
            isOpen={modalPracticante}
            onClose={() => setModalPracticante(false)}
            practicante={practicanteEnEdicion}
            onSaved={() => fetchPracticantes()}
          />
        </Suspense>
      )}

      <ConfirmModal
        isOpen={!!practicanteABorrar}
        onClose={() => setPracticanteABorrar(null)}
        onConfirm={borrarPracticante}
        title="Eliminar registro"
        message={`¿Eliminar el registro de "${practicanteABorrar?.first_names} ${practicanteABorrar?.last_names}"? Esta acción no se puede deshacer.`}
        confirmText="Eliminar"
        cancelText="Cancelar"
        isProcessing={borrando}
        isDestructive
      />
    </GlassViewLayout>
  );
}
