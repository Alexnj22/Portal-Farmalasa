import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    guardarPromocionNueva, avisoDelGuardado, filtrarPromociones, motivoDeCierre, rotuloDeCierre,
    descSalaFuera, problemasDelDescuentoDeLaPromocion, proveedorDelRenglon, OPCIONES_ESTADO_PROMOCION,
    estadoVisible,
} from '@nucleo/utils/promocionesUtils';

/**
 * Lo que el arreglo de Promociones del 2026-11-10 movió al núcleo.
 *
 * El caso que lo trajo: «Guardar y activar» con descuento. Si activar fallaba,
 * el portal seguía, mandaba el descuento y cerraba — el aviso «quedó en
 * borrador» nunca se veía—; la app decía «Quedó en borrador» y en la línea
 * siguiente «Ya está activa». Estas pruebas fijan que la activación fallida
 * NUNCA se cierre como si estuviera activa.
 */

const salas = [{ id: 1, name: 'Salud 1' }, { id: 2, name: 'Salud 2' }, { id: 3, name: 'Salud 3' }];
const renglones = [{
    erp_product_id: 7, producto: 'X', factor_unidades: null, inicio: '2026-11-01', fin: '2026-11-30',
    lote_total: '', tiene_bono: false, paga: 'empresa', supplier_id: '', bono_vendedor: '0', bono_adm: '0',
    bono_bodega: '0', unidades_por_bono: '1', salas: {}, reparto: {},
}];
const DESC_OFF = { activo: false, tipo: '%', monto: '', todas: true, branchId: '', finPropio: '' };
const DESC_ON = { ...DESC_OFF, activo: true, monto: '10' };

function datos({ crear = { id: 55 }, activar = null, descuento = {} } = {}) {
    return {
        crearPromocion: vi.fn(async () => { if (crear instanceof Error) throw crear; return crear; }),
        activarPromocion: vi.fn(async () => { if (activar instanceof Error) throw activar; return {}; }),
        guardarDescuento: vi.fn(async () => { if (descuento instanceof Error) throw descuento; return descuento; }),
    };
}
const base = (extra) => ({ nombre: ' Leches ', nota: '', renglones, salas, marcadas: {}, desc: DESC_OFF, ...extra });

describe('guardarPromocionNueva', () => {
    it('crea y activa: cierra diciendo «activa»', async () => {
        const d = datos();
        const res = await guardarPromocionNueva(base({ activar: true }), d);
        expect(res).toMatchObject({ creada: true, id: 55, activada: true, descuento: 'ninguno' });
        expect(d.activarPromocion).toHaveBeenCalledWith(55, true);
        const a = avisoDelGuardado(res, 'Leches');
        expect(a.cerrar).toBe(true);
        expect(a.exito).toBe('Ya está activa.');
    });

    it('en borrador no activa y lo dice', async () => {
        const d = datos();
        const res = await guardarPromocionNueva(base({ activar: false }), d);
        expect(res.activada).toBeNull();
        expect(d.activarPromocion).not.toHaveBeenCalled();
        expect(avisoDelGuardado(res, 'Leches')).toMatchObject({ cerrar: true, exito: 'Quedó en borrador.' });
    });

    it('activar falla CON descuento: el descuento se manda igual, pero NO se cierra ni se dice activa', async () => {
        const d = datos({ activar: new Error('x'), descuento: { ok: true } });
        const res = await guardarPromocionNueva(base({ activar: true, desc: DESC_ON }), d);
        expect(res).toMatchObject({ creada: true, activada: false, descuento: 'ok' });
        expect(res.errorActivar).toBeTruthy();
        const a = avisoDelGuardado(res, 'Leches');
        expect(a.cerrar).toBe(false);
        expect(a.fallos.join(' ')).toMatch(/quedó creada en borrador, pero no se pudo activar/);
        expect(a.exito).not.toMatch(/activa/i);
    });

    it('activar falla SIN descuento: tampoco se cierra en silencio', async () => {
        const res = await guardarPromocionNueva(base({ activar: true }), datos({ activar: new Error('x') }));
        const a = avisoDelGuardado(res, 'Leches');
        expect(a.cerrar).toBe(false);
        expect(a.fallos).toHaveLength(1);
    });

    it('crear falla: no activa ni manda descuento', async () => {
        const d = datos({ crear: new Error('boom') });
        const res = await guardarPromocionNueva(base({ activar: true, desc: DESC_ON }), d);
        expect(res.creada).toBe(false);
        expect(res.errorCrear).toBeTruthy();
        expect(d.activarPromocion).not.toHaveBeenCalled();
        expect(d.guardarDescuento).not.toHaveBeenCalled();
        expect(avisoDelGuardado(res, 'Leches').cerrar).toBe(false);
    });

    it('el descuento va con la promoción ligada, el nombre recortado y la sala de `destinoDelDescuento`', async () => {
        const d = datos({ descuento: {} });
        await guardarPromocionNueva(base({ desc: DESC_ON, marcadas: { 2: true } }), d);
        expect(d.guardarDescuento).toHaveBeenCalledWith(expect.objectContaining({
            descripcion: 'Leches', promocion_id: 55, todas_las_salas: false, branch_id: 2,
            inicio: '2026-11-01', fin: '2026-11-30', productos: [7], forzar: false,
        }));
    });

    it('avisos del descuento: queda pendiente, no se cierra', async () => {
        const avisos = [{ texto: 'Se cruza con otro', tipo: 'solape' }];
        const res = await guardarPromocionNueva(base({ desc: DESC_ON }), datos({ descuento: { avisos } }));
        expect(res).toMatchObject({ descuento: 'avisos', avisos });
        expect(avisoDelGuardado(res, 'Leches').cerrar).toBe(false);
    });

    it('el descuento falla: la promoción quedó y se ofrece reintentar sólo esa mitad', async () => {
        const res = await guardarPromocionNueva(base({ desc: DESC_ON }), datos({ descuento: new Error('caja') }));
        expect(res).toMatchObject({ creada: true, id: 55, descuento: 'error' });
        expect(avisoDelGuardado(res, 'Leches').fallos.join(' ')).toMatch(/reintentar sólo el descuento/);
    });

    it('reintentar con la promoción ya creada: no la crea ni la activa otra vez', async () => {
        const d = datos({ descuento: {} });
        const res = await guardarPromocionNueva(base({ promoCreada: 55, activar: true, desc: DESC_ON, forzarDescuento: true }), d);
        expect(d.crearPromocion).not.toHaveBeenCalled();
        expect(d.activarPromocion).not.toHaveBeenCalled();
        expect(d.guardarDescuento).toHaveBeenCalledWith(expect.objectContaining({ promocion_id: 55, forzar: true }));
        expect(res).toMatchObject({ creada: true, activada: null, descuento: 'ok' });
        expect(avisoDelGuardado(res, 'Leches').cerrar).toBe(true);
    });

    it('creada sin número: no activa ni liga un descuento a ciegas', async () => {
        const d = datos({ crear: {} });
        const res = await guardarPromocionNueva(base({ activar: true, desc: DESC_ON }), d);
        expect(res).toMatchObject({ creada: true, id: null, activada: false, descuento: 'error' });
        expect(d.activarPromocion).not.toHaveBeenCalled();
        expect(d.guardarDescuento).not.toHaveBeenCalled();
    });
});

describe('filtrarPromociones', () => {
    afterEach(() => { vi.useRealTimers(); });
    const promos = [
        { id: 1, nombre: 'Leches Nido', tipo: 'producto', estado: 'activa', fin: '2026-12-31', laboratorios: ['NESTLE'] },
        { id: 2, nombre: 'Abbott nivel', tipo: 'laboratorio', estado: 'borrador', fin: '2026-12-31', laboratorios: ['ABBOTT'] },
        { id: 3, nombre: 'Vieja', tipo: 'producto', estado: 'finalizada', fin: '2026-01-31', laboratorios: ['NESTLE'] },
        { id: 4, nombre: 'Vence pronto', tipo: 'producto', estado: 'activa', fin: '2026-11-12', laboratorios: ['BAYER'] },
    ];
    const ids = (l) => l.map((p) => p.id);

    it('sin filtros: vivas y terminadas', () => {
        const r = filtrarPromociones(promos);
        expect(ids(r.vivas)).toEqual([1, 2, 4]);
        expect(ids(r.terminadas)).toEqual([3]);
    });
    it('por texto, tipo y laboratorio', () => {
        expect(ids(filtrarPromociones(promos, { q: 'leches' }).filtradas)).toEqual([1]);
        expect(ids(filtrarPromociones(promos, { tipo: 'laboratorio' }).vivas)).toEqual([2]);
        expect(ids(filtrarPromociones(promos, { lab: 'NESTLE' }).filtradas)).toEqual([1, 3]);
    });
    it('el estado es el VISIBLE y sólo recorta las vivas', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-10T18:00:00Z'));
        const r = filtrarPromociones(promos, { estado: 'por_vencer' });
        expect(ids(r.vivas)).toEqual([4]);
        expect(ids(r.terminadas)).toEqual([3]);
    });
    it('las opciones de estado salen del mismo catálogo, sin «Terminada» ni opción vacía', () => {
        expect(OPCIONES_ESTADO_PROMOCION.map((o) => o.value)).toEqual(['activa', 'por_vencer', 'vencida', 'borrador']);
        expect(OPCIONES_ESTADO_PROMOCION.every((o) => o.value && o.label)).toBe(true);
        expect(OPCIONES_ESTADO_PROMOCION.find((o) => o.value === 'borrador').label)
            .toBe(estadoVisible({ estado: 'borrador' }).rotulo);
    });
});

describe('motivoDeCierre', () => {
    it('dice el motivo en palabras y nunca la clave cruda', () => {
        expect(motivoDeCierre('lote_agotado')).toBe('Se vendió el lote');
        expect(motivoDeCierre('otra_clave')).toBe('Terminado');
        expect(motivoDeCierre(null)).toBe('Terminado');
        expect(rotuloDeCierre('fin_de_vigencia')).toBe('Terminado · Se cumplió la fecha');
        expect(rotuloDeCierre('otra_clave')).toBe('Terminado');
    });
});

describe('descSalaFuera', () => {
    const desc = { activo: true, todas: false, branchId: '3', tipo: '%', monto: '10' };
    it('la sala elegida ya no está entre las marcadas', () => {
        expect(descSalaFuera(salas, { 1: true, 2: true }, desc)).toBe(true);
        expect(descSalaFuera(salas, { 1: true, 3: true }, desc)).toBe(false);
    });
    it('con una o ninguna marcada no aplica (el destino lo decide la promoción)', () => {
        expect(descSalaFuera(salas, { 1: true }, desc)).toBe(false);
        expect(descSalaFuera(salas, {}, desc)).toBe(false);
    });
    it('«en todas» o sin descuento no aplica', () => {
        expect(descSalaFuera(salas, { 1: true, 2: true }, { ...desc, todas: true })).toBe(false);
        expect(descSalaFuera(salas, { 1: true, 2: true }, { ...desc, activo: false })).toBe(false);
    });
    it('entra en los problemas del descuento de la promoción', () => {
        const l = problemasDelDescuentoDeLaPromocion(renglones, desc, { alcanceTodo: true, salas, marcadas: { 1: true, 2: true } });
        expect(l).toContain('La sala del descuento ya no está entre las salas de la promoción.');
        expect(problemasDelDescuentoDeLaPromocion(renglones, { ...desc, monto: '0' }, { salas, marcadas: { 1: true, 3: true } }))
            .toEqual(['El descuento tiene que ser mayor que cero.']);
    });
});

describe('proveedorDelRenglon', () => {
    const lista = [{ value: '44', label: 'Droguería Médica' }, { value: '45', label: 'ACME' }];
    it('por supplier_id cuando la base lo trae, aunque el nombre no coincida', () => {
        expect(proveedorDelRenglon({ supplier_id: 45, proveedor: 'Otro nombre' }, lista)).toBe('45');
    });
    it('por nombre de respaldo: exacto y después normalizado', () => {
        expect(proveedorDelRenglon({ proveedor: 'ACME' }, lista)).toBe('45');
        expect(proveedorDelRenglon({ proveedor: ' drogueria  medica ' }, lista)).toBe('44');
        expect(proveedorDelRenglon({ proveedor: 'Nadie' }, lista)).toBeNull();
    });
});
