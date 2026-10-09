// «Mis avisos» — los comunicados internos que le tocan a UNA persona, escritos
// una vez para el portal (`EmployeeAnnouncementsView`) y la app
// (`app/comunicados.js`). Vivía dentro de la vista: qué le aplica, qué ya leyó,
// el orden de cada pestaña y los subfiltros de «Leídos».
import { announcementAppliesToUser } from './announcementAudience';

const idDeLector = (r) => String(typeof r === 'object' && r !== null ? r.employeeId : r);

/** ¿Esta persona ya lo leyó? */
export const yaLoLeyo = (ann, userId) => (ann?.readBy || []).some((r) => idDeLector(r) === String(userId));

/** Lo leyó ANTES de la última edición: el aviso cambió y vale volver a mirarlo. */
export const loLeyoAntesDeEditarse = (ann, userId) => !!ann?.editedAt
    && (ann.prevReadBy || []).some((r) => idDeLector(r) === String(userId));

const urgenteAntes = (a, b) => (a.priority === 'URGENT' ? 0 : 1) - (b.priority === 'URGENT' ? 0 : 1);

/**
 * Los que le tocan: no archivados, ya publicados (los programados esperan su
 * día) y con su destino. Urgentes primero y después del más viejo al más
 * nuevo — el orden del mazo «Sin leer».
 */
export function comunicadosDeLaPersona(announcements, user, roles, ahora = new Date()) {
    if (!user) return [];
    return (announcements || []).filter((a) => {
        if (a.isArchived) return false;
        if (a.scheduledFor && new Date(a.scheduledFor) > ahora) return false;
        return announcementAppliesToUser(a, user, roles);
    }).sort((a, b) => urgenteAntes(a, b) || (new Date(a.date) - new Date(b.date)));
}

/** El mes en curso, «AAAA-MM», que es lo que «Leídos» muestra sin pedir más. */
export const mesDe = (ahora = new Date()) => ahora.toISOString().slice(0, 7);

/**
 * Una pestaña: 'UNREAD' (orden del mazo) o 'READ' (día más reciente primero,
 * urgentes antes dentro del día). Los leídos de meses anteriores sólo con
 * `verViejos`.
 */
export function comunicadosDeLaPestana(lista, pestana, userId, { verViejos = false, ahora = new Date() } = {}) {
    if (pestana === 'UNREAD') return lista.filter((a) => !yaLoLeyo(a, userId));
    const mes = mesDe(ahora);
    let leidos = lista.filter((a) => yaLoLeyo(a, userId));
    if (!verViejos) leidos = leidos.filter((a) => (a.date || '').slice(0, 7) === mes);
    return [...leidos].sort((a, b) => {
        const da = (a.date || '').slice(0, 10); const db = (b.date || '').slice(0, 10);
        if (db !== da) return db > da ? 1 : -1;
        return urgenteAntes(a, b) || (new Date(b.date) - new Date(a.date));
    });
}

/** ¿Hay leídos de meses anteriores escondidos? (el botón «Ver anteriores»). */
export const hayLeidosViejos = (lista, userId, ahora = new Date()) => {
    const mes = mesDe(ahora);
    return lista.some((a) => yaLoLeyo(a, userId) && (a.date || '').slice(0, 7) !== mes);
};

/** Los subfiltros de «Leídos», con su cuenta; los vacíos no se ofrecen. */
export function filtrosDeLeidos(lista) {
    return [
        { key: 'ALL', label: 'Todos', count: lista.length },
        { key: 'URGENT', label: 'Urgentes', count: lista.filter((a) => a.priority === 'URGENT').length },
        { key: 'GLOBAL', label: 'Global', count: lista.filter((a) => a.targetType === 'GLOBAL').length },
        { key: 'BRANCH', label: 'Sucursal', count: lista.filter((a) => a.targetType === 'BRANCH').length },
        { key: 'ROLE', label: 'Cargo', count: lista.filter((a) => a.targetType === 'ROLE').length },
        { key: 'EMPLOYEE', label: 'Personal', count: lista.filter((a) => a.targetType === 'EMPLOYEE').length },
    ].filter((f) => f.key === 'ALL' || f.count > 0);
}

/** Aplica un subfiltro de los de arriba. */
export const aplicarFiltroDeLeidos = (lista, filtro) => {
    if (filtro === 'URGENT') return lista.filter((a) => a.priority === 'URGENT');
    if (!filtro || filtro === 'ALL') return lista;
    return lista.filter((a) => a.targetType === filtro);
};

/** El rótulo del destino («Global», «Sucursal», «Cargo», «Personal»). */
export const destinoDelComunicado = (a) => ({ GLOBAL: 'Global', BRANCH: 'Sucursal', ROLE: 'Cargo' }[a?.targetType] || 'Personal');

/** Las constancias, por su código. */
export const TIPO_DE_CONSTANCIA = { LABORAL: 'Constancia Laboral', SALARIO: 'Constancia de Salario', BANCARIA: 'Constancia Bancaria' };
