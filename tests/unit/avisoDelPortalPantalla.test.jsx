import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, cleanup, screen } from '@testing-library/react';

// La pantalla: con la lectura fallida no hay formulario ni «Guardar», hay
// «Reintentar». Ver avisoDelPortalSinLeer.test.jsx para el porqué.

const m = vi.hoisted(() => ({ estado: null, guardarBannerPortal: vi.fn() }));

vi.mock('@nucleo/hooks/useBannerPortal', () => ({ useBannerPortal: () => m.estado }));
vi.mock('@nucleo/data/bannerPortal', () => ({
    VARIANTES_BANNER: [{ value: 'obra', label: 'Obra' }],
    guardarBannerPortal: m.guardarBannerPortal,
    encenderBannerPortal: vi.fn(),
    apagarBannerPortal: vi.fn(),
}));

import AvisoDelPortal from '../../src/components/mantenimiento/AvisoDelPortal';

const boton = (t) => screen.queryAllByRole('button').find((b) => b.textContent.includes(t));

describe('AvisoDelPortal — sin el aviso leído no se escribe', () => {
    beforeEach(() => cleanup());

    it('lectura fallida → «Reintentar», sin «Guardar texto» ni campos', () => {
        m.estado = { banner: null, cargando: false, error: { message: 'Failed to fetch' }, recargar: vi.fn() };
        render(<AvisoDelPortal />);
        expect(boton('Reintentar')).toBeTruthy();
        expect(boton('Guardar texto')).toBeUndefined();
        expect(screen.queryByRole('textbox')).toBeNull();
    });

    it('cargando → «Guardar texto» apagado', () => {
        m.estado = { banner: null, cargando: true, error: null, recargar: vi.fn() };
        render(<AvisoDelPortal />);
        const g = boton('Guardar texto');
        expect(g).toBeTruthy();
        expect(g.disabled).toBe(true);
    });

    it('leído → el formulario de siempre', () => {
        m.estado = { banner: { activo: true, texto: 'Hay obra', texto_corto: '', variante: 'obra' }, cargando: false, error: null, recargar: vi.fn() };
        render(<AvisoDelPortal />);
        expect(screen.getByDisplayValue('Hay obra')).toBeTruthy();
        expect(boton('Reintentar')).toBeUndefined();
    });
});
