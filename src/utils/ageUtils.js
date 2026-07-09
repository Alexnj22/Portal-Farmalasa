// Edad real en años a partir de una fecha "YYYY-MM-DD" — compartido entre
// EmployeeFormModal, StaffManagementView y PracticanteModal para decidir si
// alguien es menor de edad (DUI vs documento alterno, Art. 23.2 CT).
export const MINOR_AGE = 18;

export const calcAge = (birthDateStr) => {
    if (!birthDateStr) return null;
    const bd = new Date(birthDateStr + 'T00:00:00');
    if (isNaN(bd.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - bd.getFullYear();
    const m = today.getMonth() - bd.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < bd.getDate())) age--;
    return age;
};
