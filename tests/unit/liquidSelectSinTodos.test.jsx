// @vitest-environment jsdom
// Un campo de formulario con un valor elegido NO abre con una fila «Todos»
// (reportado por el usuario, 2026-11-11: «Motivo legal de la baja → Todos»).
// «Todos» es la vuelta de un filtro; en un formulario se limpia con la ✕.
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import LiquidSelect from '../../src/components/common/LiquidSelect';

afterEach(cleanup);
const OPCIONES = [{ value: 'A', label: 'Renuncia' }, { value: 'B', label: 'Despido' }];
const abrir = () => fireEvent.click(screen.getByRole('combobox'));

describe('LiquidSelect: la fila de limpiar del menú', () => {
    it('un campo de formulario con valor no ofrece «Todos»', () => {
        render(<LiquidSelect value="B" onChange={() => {}} options={OPCIONES} placeholder="Seleccionar causa..." />);
        abrir();
        expect(screen.queryByText('Todos')).toBeNull();
    });

    it('si el llamador la nombra, aparece con su nombre', () => {
        render(<LiquidSelect value="B" onChange={() => {}} options={OPCIONES} clearLabel="Ninguno" />);
        abrir();
        expect(screen.getByText('Ninguno')).toBeTruthy();
        expect(screen.queryByText('Todos')).toBeNull();
    });

    it('un filtro (opción vacía = rótulo) conserva su vuelta a «Todos»', () => {
        render(<LiquidSelect value="B" onChange={() => {}} clearable={false} placeholder="Sucursal"
            options={[{ value: '', label: 'Sucursal' }, ...OPCIONES]} />);
        abrir();
        expect(screen.getByText('Todos')).toBeTruthy();
    });
});
