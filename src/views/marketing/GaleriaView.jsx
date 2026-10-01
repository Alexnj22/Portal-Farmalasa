import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Images, AlertTriangle } from 'lucide-react';
import GlassViewLayout from '../../components/GlassViewLayout';
import FilterBar from '../../components/common/FilterBar';
import Notice from '../../components/common/Notice';
import { LoadingState } from '../../components/common/StateViews';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { correrMes, mesSV } from '@nucleo/utils/fecha';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { FORMATOS, esDeMarca } from '@nucleo/utils/marketing';
import { fetchCatalogos, fetchGaleria, firmarDisenos } from '@nucleo/data/marketing';
import ViewTabBar from '../../components/common/ViewTabBar';
import Galeria from './Galeria';

const MESES_ATRAS = 6;

/**
 * Galería — el material de redes para las salas.
 *
 * Lo que Marketing libera (y ya está aprobado) aparece acá para descargarlo,
 * copiar su texto y publicarlo en el estado de WhatsApp de la sala. Quien sólo
 * tiene este módulo no ve borradores, ni versiones viejas, ni comentarios: lo
 * recorta el RLS (`marketing_piezas_galeria`), no esta pantalla.
 */
export default function GaleriaView() {
    const [piezas, setPiezas] = useState([]);
    const [marcas, setMarcas] = useState({});
    const [firmadas, setFirmadas] = useState(new Map());
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState(null);
    const [busqueda, setBusqueda] = useState('');
    const [fFormato, setFFormato] = useState('');
    const [fMarca, setFMarca] = useState('');

    const cargar = useCallback(async () => {
        setCargando(true);
        try {
            const [cat, ps] = await Promise.all([
                fetchCatalogos(),
                fetchGaleria({ desde: `${correrMes(mesSV(), -MESES_ATRAS)}-01` }),
            ]);
            // La sala ve sólo lo liberado y aprobado; quien también tiene
            // Marketing lo vería todo, así que acá se recorta igual.
            const liberadas = ps.filter((p) => p.liberada && ['aprobado', 'programado', 'publicado'].includes(p.estado));
            setMarcas(Object.fromEntries(cat.marcas.map((m) => [m.id, m])));
            setPiezas(liberadas);
            setFirmadas(await firmarDisenos(liberadas));
            setError(null);
        } catch (err) {
            setError(err);
        } finally {
            setCargando(false);
        }
    }, []);
    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- la carga inicial; no hay forma de tenerla antes de pedirla

    const visibles = useMemo(() => piezas
        .filter((p) => !fFormato || p.formato === fFormato)
        .filter((p) => !fMarca || esDeMarca(p, fMarca))
        .filter((p) => !busqueda || tokenMatch(busqueda, p.titulo, p.copy, p.hashtags)),
    [piezas, fFormato, fMarca, busqueda]);

    const filtros = (fFormato ? 1 : 0) + (fMarca ? 1 : 0);
    const marcasLista = Object.values(marcas);

    return (
        <GlassViewLayout icon={Images} title="Galería" transparentBody filtersContent={(
            <ViewTabBar tabs={[]} searchValue={busqueda} onSearchChange={setBusqueda} placeholder="Buscar pieza…" />
        )}>
            <div className="p-4 md:p-6 space-y-6">
                <div className="flex justify-end">
                    <FilterBar activeCount={filtros} onClear={filtros ? () => { setFFormato(''); setFMarca(''); } : undefined}>
                        <FilterBar.Section label="formato" active={!!fFormato} onClear={() => setFFormato('')}>
                            <FilterBar.Opciones value={fFormato} onChange={(v) => setFFormato(v || '')} label="Formato" placeholder="Formato"
                                options={[{ value: '', label: 'Formato' }, ...FORMATOS.map((f) => ({ value: f.value, label: f.label }))]} />
                        </FilterBar.Section>
                        {marcasLista.length > 1 && (
                            <FilterBar.Section label="marca" active={!!fMarca} onClear={() => setFMarca('')}>
                                <FilterBar.Opciones value={fMarca} onChange={(v) => setFMarca(v || '')} label="Marca" placeholder="Marca"
                                    umbral={0}
                                    options={[{ value: '', label: 'Marca' }, ...marcasLista.map((m) => ({ value: String(m.id), label: m.nombre }))]} />
                            </FilterBar.Section>
                        )}
                    </FilterBar>
                </div>
                {cargando ? <LoadingState label="Cargando la galería…" />
                    : error ? (
                        <Notice variant="danger" icon={AlertTriangle}>{mensajeAmigable(error, 'No se pudo cargar la galería.')}</Notice>
                    ) : (
                        <Galeria piezas={visibles} marcas={marcas} firmadas={firmadas} />
                    )}
            </div>
        </GlassViewLayout>
    );
}
