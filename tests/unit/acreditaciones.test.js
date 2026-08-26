// ─────────────────────────────────────────────────────────────────────────────
// Qué acreditación le corresponde a quién
// ─────────────────────────────────────────────────────────────────────────────
//
// Dos cosas se prueban acá y ninguna es «detecta al enfermero»:
//
//  1. Que contaduría NO figure como del CSSP. Las tres juntas de salud sí lo
//     son; ésa es de otro organismo, y afirmar lo contrario manda a quien vaya
//     a verificarla al lugar equivocado.
//  2. Que un ISSS/AFP sin preguntar NO cuente como «no tiene». Hoy las 49
//     fichas están en silencio: tratar el silencio como una respuesta haría que
//     el portal empiece 49 trámites que nadie pidió.

import { describe, it, expect } from 'vitest';
import { acreditacionesDe, pendientesPrevisionales, ACREDITACIONES } from '../../src/utils/acreditaciones';

const ids = (ctx) => acreditacionesDe(ctx).map(a => a.id);

describe('acreditacionesDe', () => {
    it('detecta por cargo y por profesión, con o sin tildes', () => {
        expect(ids({ cargo: 'Regente de Farmacia' })).toContain('QUIMICO');
        expect(ids({ profesion: 'Químico Farmacéutico' })).toContain('QUIMICO');
        expect(ids({ cargo: 'Regente de Enfermeria' })).toContain('ENFERMERIA');
        expect(ids({ profesion: 'Licenciada en Enfermería' })).toContain('ENFERMERIA');
        expect(ids({ profesion: 'Técnico en enfermeria' })).toContain('ENFERMERIA');
        expect(ids({ profesion: 'Doctor en Medicina' })).toContain('MEDICO');
        expect(ids({ profesion: 'Contador Público' })).toContain('CONTADURIA');
        expect(ids({ cargo: 'Contador Externo' })).toContain('CONTADURIA');
    });

    it('«Regente de Enfermeria» es enfermería, NO químico', () => {
        // El cargo real de la empresa, sin tilde, y es el caso que rompe una
        // detección ingenua: contiene «regente» y no es del JVPQF.
        const r = ids({ cargo: 'Regente de Enfermeria' });
        expect(r).toContain('ENFERMERIA');
        expect(r).not.toContain('QUIMICO');
    });

    it('a un dependiente de farmacia no le corresponde ninguna junta profesional', () => {
        // La acreditación de dependiente existe y es del CSSP, pero no es una
        // junta de profesión: se pregunta aparte.
        expect(ids({ cargo: 'Dependiente de Farmacia', profesion: 'Bachiller' })).toEqual([]);
    });

    it('contaduría NO es del Consejo Superior de Salud Pública', () => {
        const contaduria = ACREDITACIONES.find(a => a.id === 'CONTADURIA');
        expect(contaduria.organismo).not.toMatch(/Salud/);
        expect(contaduria.junta).toBe('CVPCPA');
        // Y las tres de salud sí lo son.
        for (const id of ['QUIMICO', 'ENFERMERIA', 'MEDICO']) {
            expect(ACREDITACIONES.find(a => a.id === id).organismo).toMatch(/Salud Pública/);
        }
    });

    it('cada acreditación tiene dónde guardar su número y su documento', () => {
        for (const a of ACREDITACIONES) {
            expect(a.campo).toBeTruthy();
            expect(a.doc).toBeTruthy();
        }
    });
});

describe('pendientesPrevisionales', () => {
    it('«sin preguntar» no es «no tiene»', () => {
        const p = pendientesPrevisionales({});
        expect(p.map(x => x.estado)).toEqual(['SIN_PREGUNTAR', 'SIN_PREGUNTAR']);
    });

    it('un TIENE declarado no deja pendiente', () => {
        expect(pendientesPrevisionales({ isss_estado: 'TIENE', afp_estado: 'TIENE' })).toEqual([]);
    });

    it('el ISSS lo hace la empresa y la AFP la persona', () => {
        const p = pendientesPrevisionales({ isss_estado: 'NO_TIENE', afp_estado: 'NO_TIENE' });
        expect(p.find(x => x.clave === 'isss').quienLoHace).toBe('la empresa');
        expect(p.find(x => x.clave === 'afp').quienLoHace).toBe('la persona');
    });

    it('«en trámite» sigue siendo pendiente', () => {
        const p = pendientesPrevisionales({ isss_estado: 'EN_TRAMITE', afp_estado: 'TIENE' });
        expect(p).toHaveLength(1);
        expect(p[0].clave).toBe('isss');
    });
});
