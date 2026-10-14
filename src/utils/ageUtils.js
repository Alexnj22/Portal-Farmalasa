// Edad real en años a partir de una fecha "YYYY-MM-DD" — compartido entre
// EmployeeFormModal, StaffManagementView y PracticanteModal para decidir si
// alguien es menor de edad (DUI vs documento alterno, Art. 23.2 CT).
import { hoySV } from './fecha';

export const MINOR_AGE = 18;

// «Hoy» es el de la sala (`hoySV`), no el del reloj del equipo: con
// `new Date()` una computadora con otra zona —o una tableta sin configurar—
// cumplía años un día antes o después, y un menor pasaba a pedir DUI el día
// equivocado. Las cuentas son de calendario puro, con los tres números.
export const calcAge = (birthDateStr, hoy = hoySV()) => {
    if (!birthDateStr) return null;
    const [by, bm, bd] = String(birthDateStr).slice(0, 10).split('-').map(Number);
    if (!by || !bm || !bd) return null;
    const [ty, tm, td] = String(hoy).slice(0, 10).split('-').map(Number);
    let age = ty - by;
    if (tm < bm || (tm === bm && td < bd)) age--;
    return age;
};
