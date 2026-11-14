import { describe, expect, it } from 'vitest';
import { pendientesDeLaRed, pendientesDeSala } from '@nucleo/utils/cumplimiento';

// El tablero de la red junta por obligación lo que antes se repetía en cada
// tarjeta de sala (2026-11-14).
const sala = (id, nombre, extra = {}) => ({
    branch_id: id, sala: nombre, tipo_sala: 'FARMACIA', fv_vencidas: 0, fv_abiertas: 0,
    fv_semestre_cubierto: false, fv_semestre: '2026-S1', vencidos_por_destruir: 0, retiros_abiertos: 0,
    ultima_autoinspeccion: null, ultima_revision_a_la_vista: '2026-10-01', capacitaciones_del_anio: 2,
    dependientes_sin_acreditacion: 0, ...extra,
});
const HOY = '2026-11-14';

describe('pendientesDeLaRed', () => {
    it('una obligación que falta en varias salas sale UNA vez, con sus salas', () => {
        const { grupos, totalSalas } = pendientesDeLaRed([sala(1, 'A'), sala(2, 'B'), sala(3, 'C', { fv_semestre_cubierto: true })], HOY);
        expect(totalSalas).toBe(3);
        const fv = grupos.find((g) => g.clave === 'fv_semestre');
        expect(fv.salas.map((s) => s.sala)).toEqual(['A', 'B']);
        expect(fv.crea).toBe('reporte_cero');
        expect(fv.titulo).toMatch(/enero a junio de 2026/i);
        expect(grupos.filter((g) => g.clave === 'autoinspeccion')).toHaveLength(1);
    });

    it('lo urgente va primero y cada sala lleva su número', () => {
        const { grupos } = pendientesDeLaRed([sala(1, 'A', { dependientes_sin_acreditacion: 2 }), sala(2, 'B')], HOY);
        expect(grupos[0].clave).toBe('acreditacion');
        expect(grupos[0].tono).toBe('danger');
        expect(grupos[0].salas).toEqual([{ branch_id: 1, sala: 'A', detalle: '2', tono: 'danger' }]);
    });

    it('lo que nadie debe sale en «al día»', () => {
        const { alDia } = pendientesDeLaRed([sala(1, 'A')], HOY);
        expect(alDia).toContain('Capacitación de este año');
        expect(alDia).toContain('Mostrador acreditado');
        expect(alDia).not.toContain('Autoinspección del año');
    });

    it('respeta las pestañas que la persona puede ver', () => {
        const { grupos, alDia } = pendientesDeLaRed([sala(1, 'A')], HOY, undefined, new Set(['capacitacion']));
        expect(grupos).toEqual([]);
        expect(alDia).toContain('Capacitación de este año');
    });

    it('cada pendiente de sala trae su clave (la app la ignora; el portal agrupa por ella)', () => {
        for (const p of pendientesDeSala(sala(1, 'A', { fv_abiertas: 1, retiros_abiertos: 1, vencidos_por_destruir: 3 }), HOY)) {
            expect(p.clave).toBeTruthy();
            expect(p.texto).toBeTruthy();
        }
    });
});

describe('mapaDeLaRed', () => {
    it('cruza cada obligación con cada sala y cuenta lo que aplica', async () => {
        const { mapaDeLaRed } = await import('@nucleo/utils/cumplimiento');
        const bodega = sala(9, 'Bodega', { tipo_sala: 'BODEGA' });
        const m = mapaDeLaRed([sala(1, 'A', { fv_abiertas: 1 }), bodega], HOY);
        const a = m.salas[0].celdas;
        expect(a.reacciones).toMatchObject({ estado: 'falta', tono: 'warning', detalle: '1' });
        expect(a.capacitacion.estado).toBe('ok');
        expect(m.salas[1].celdas.fv_semestre.estado).toBe('na');   // la bodega no reporta farmacovigilancia
        expect(m.salas[1].celdas.a_la_vista.estado).toBe('na');
        // 8 filas en la farmacia + 6 en la bodega
        expect(m.aplicables).toBe(14);
        expect(m.cumplidas + m.urgentes + m.pendientes).toBe(m.aplicables);
        expect(m.salasAlDia).toBe(0);
    });

    it('la fila de reacciones toma la fuera de plazo como urgente', async () => {
        const { mapaDeLaRed } = await import('@nucleo/utils/cumplimiento');
        const m = mapaDeLaRed([sala(1, 'A', { fv_vencidas: 2, fv_semestre_cubierto: true, ultima_autoinspeccion: '2026-05-01' })], HOY);
        expect(m.salas[0].celdas.reacciones).toMatchObject({ estado: 'falta', tono: 'danger' });
        expect(m.urgentes).toBe(1);
        expect(m.pct).toBe(Math.round((m.cumplidas / m.aplicables) * 100));
    });
});
