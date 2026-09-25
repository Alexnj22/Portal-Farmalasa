// Los íconos de la pantalla de resultado del kiosco, por NOMBRE.
//
// La lógica de marcación (`timeClock.rules`, `timeClock.audit`,
// `useTimeClockEngine`) dice QUÉ ícono va —`iconKey: 'shield'`— y esta tabla
// dice CÓMO se dibuja. Antes la lógica importaba los componentes de
// `lucide-react` y los metía en el estado: una app nativa no puede reutilizar
// una regla que trae adentro un componente de la web. Plan en
// `docs/PLAN-NUCLEO-PORTABLE-2026-09-24.md`.
import {
    CheckCircle2, Utensils, Baby, LogOut, ShieldAlert, AlertTriangle,
    CalendarHeart, DoorOpen, CircleCheck, XCircle,
} from 'lucide-react';

const ICONOS = {
    check: CheckCircle2,
    utensils: Utensils,
    baby: Baby,
    logout: LogOut,
    alert: AlertTriangle,
    shield: ShieldAlert,
    calendarHeart: CalendarHeart,
    plus: CircleCheck,
    doorOpen: DoorOpen,
    x: XCircle,
};

/** El ícono de un `iconKey`, ya dibujado. Sin clave, nada — igual que antes,
 *  cuando el estado venía sin `icon`. Con una clave que no está, el de éxito,
 *  que era el respaldo de `buildFeedbackState`.
 *
 *  Es un componente y no una función que devuelve uno: elegir el componente
 *  durante el render de OTRO lo marca el compilador de React como «crear un
 *  componente en el render». */
export function IconoDelKiosco({ clave, ...props }) {
    if (!clave) return null;
    const Icono = ICONOS[clave] ?? CheckCircle2;
    return <Icono {...props} />;
}
