import { describe, it, expect } from 'vitest';
import { csvDelLibroBajoReceta } from '@nucleo/utils/libroBajoReceta';
import { cuantosOcultos, laboratoriosDeProductos, montoPrivado, productosSegunOcultos } from '@nucleo/utils/ventasPeriodo';
import {
    accionesDeIdea, colorEscrito, colorLibreDeMarca, colorValido, cuentaDeIdeas, faltaEnRecurso, feedDeMarca, ideasDeLaVista,
    prellenadoDeIdea, prellenadoDeSolicitud, recursosPorMarca,
} from '@nucleo/utils/marketing';

describe('libro bajo receta', () => {
    it('ordena por folio y nombra el archivo', () => {
        const c = csvDelLibroBajoReceta([{ folio: 2, folio_txt: '2', estado: 'completa' }, { folio: 1, folio_txt: '1', estado: 'pendiente' }],
            { sucursalNombre: 'Salud 1', periodo: '2026-10' });
        expect(c.rows.map((r) => r[0])).toEqual(['1', '2']);
        expect(c.nombre).toBe('libro-bajo-receta-salud-1-2026-10');
    });
});

describe('productos ocultos en Ventas', () => {
    const filas = [{ oculto_en_ventas: true, laboratorio_id: 2, laboratorio_nombre: 'B' }, { laboratorio_id: 1, laboratorio_nombre: 'A' }, { laboratorio_id: 1 }];
    it('muestra los visibles o sólo los ocultos', () => {
        expect(productosSegunOcultos(filas, false)).toHaveLength(2);
        expect(productosSegunOcultos(filas, true)).toHaveLength(1);
        expect(cuantosOcultos(filas)).toBe(1);
    });
    it('lista los laboratorios sin repetir', () => {
        expect(laboratoriosDeProductos(filas)).toEqual([{ value: '2', label: 'B' }, { value: '1', label: 'A' }].sort((a, b) => a.label.localeCompare(b.label)));
        expect(montoPrivado('$5', true)).toBe('••••••');
    });
});

describe('marketing', () => {
    it('ideas: vistas, conteos y acciones', () => {
        const ideas = [{ estado: 'nueva', autor_id: 1 }, { estado: 'usada' }, { estado: 'en_trabajo' }];
        expect(ideasDeLaVista(ideas, 'abiertas')).toHaveLength(2);
        expect(cuentaDeIdeas(ideas)).toMatchObject({ abiertas: 2, usada: 1, todas: 3 });
        expect(accionesDeIdea(ideas[0], { gestiona: true, puedeEditar: true, yoId: 1 })).toEqual(['tomar', 'crear_pieza', 'ligar', 'descartar', 'editar', 'quitar']);
        expect(accionesDeIdea(ideas[1], { gestiona: true, puedeEditar: false, yoId: 9 })).toEqual(['reabrir']);
        expect(prellenadoDeIdea({ id: 4, titulo: 'T' })).toMatchObject({ titulo: 'T', formato: 'post', idea_id: 4 });
    });
    it('solicitud aceptada va al mes que pidió', () => {
        expect(prellenadoDeSolicitud({ id: 1, titulo: 'X', fecha_deseada: '2026-11-05' }, '2026-10')).toMatchObject({ mes: '2026-11', prellenado: { fecha: '2026-11-05', solicitud_id: 1 } });
        expect(prellenadoDeSolicitud({ id: 1, titulo: 'X' }, '2026-10').prellenado.fecha).toBe('2026-10-01');
    });
    it('feed: historias aparte y lo más nuevo arriba', () => {
        const f = feedDeMarca([{ formato: 'post', fecha: '2026-10-01' }, { formato: 'post', fecha: '2026-10-05' }, { formato: 'historia', fecha: '2026-10-02' }], null);
        expect(f.cuadricula.map((p) => p.fecha)).toEqual(['2026-10-05', '2026-10-01']);
        expect(f.historias).toHaveLength(1);
    });
    it('biblioteca y marcas', () => {
        expect(colorEscrito('1a47c5')).toBe('#1a47c5');
        expect(colorValido('#1A47C5')).toBe(true);
        expect(faltaEnRecurso({ tipo: 'logo', nombre: 'L', enlace: 'ftp://x' }, false)).toBe(true);
        expect(faltaEnRecurso({ tipo: 'logo', nombre: 'L', enlace: 'https://x' }, false)).toBe(false);
        expect(recursosPorMarca([{ marca_id: null }, { marca_id: 2 }], [{ id: 2, nombre: 'S' }]).map((g) => g.nombre)).toEqual(['Todas las marcas', 'S']);
        expect(colorLibreDeMarca([{ color: 'chart-1' }])).toBe('chart-3');
    });
});
