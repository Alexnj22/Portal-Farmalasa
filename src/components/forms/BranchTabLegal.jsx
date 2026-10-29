import React, { useMemo } from 'react';
import Badge from '../common/Badge';
import { ShieldCheck, FileBadge, ShieldAlert, FileWarning, Syringe, AlertCircle } from 'lucide-react';
import { LazyInput, Switch, FileUploader, SeccionDeFormulario } from './BranchHelpers';
import LiquidDatePicker from '../common/LiquidDatePicker';
import LiquidSelect from '../common/LiquidSelect';
import Checkbox from '../common/Checkbox';
import Notice from '../common/Notice';
import { EmptyState } from '../common/StateViews';
import { rotuloCampo } from '@nucleo/utils/rotuloDeCampo';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { OPCIONES_CATEGORIA_SRS, idsDeEnfermeria } from '@nucleo/utils/edicionDeSucursal';

// Un vencimiento se rotula en naranja con su ícono: es la fecha que dispara el
// aviso de documentos por vencer, y se distingue de una fecha cualquiera.
const RotuloVencimiento = ({ children }) => (
    <span className={rotuloCampo('text-warning-text')}>
        <span className="flex items-center gap-1.5"><AlertCircle size={12} strokeWidth={3} aria-hidden="true" /> {children}</span>
    </span>
);

const Vencimiento = ({ rotulo, value, onChange }) => (
    <div>
        <RotuloVencimiento>{rotulo}</RotuloVencimiento>
        <LiquidDatePicker tono="warning" value={value || ""} onChange={onChange} />
    </div>
);

// El documento va al pie de su sección, separado por una línea.
const PieDocumento = ({ children }) => <div className="pt-4 border-t border-divider mt-auto">{children}</div>;

const Desactivado = ({ icon }) => <EmptyState linea icon={icon} title="Desactivado" />;

const BranchTabLegal = ({
    legal, updateNestedSetting, availableRegents,
    availablePharmacovigilance, availableNurses, toggleNurse
}) => {
    // El nombre de una persona sale del canónico (`shortEmployeeName`), también
    // en las opciones de un select.
    const regentOptions = useMemo(() =>
        availableRegents.map(e => ({ value: e.id, label: shortEmployeeName(e) }))
        , [availableRegents]);

    const pharmaOptions = useMemo(() =>
        availablePharmacovigilance.map(e => ({ value: e.id, label: shortEmployeeName(e) }))
        , [availablePharmacovigilance]);

    // Quién está en enfermería: de `nursingRegents` (núcleo), no de `legal.nurses`.
    const enfermeriaIds = useMemo(() => idsDeEnfermeria(legal).map(String), [legal]);

    const archivo = (campoArchivo, campoUrl) => (f) => {
        updateNestedSetting('legal', campoArchivo, f);
        if (!f) updateNestedSetting('legal', campoUrl, null);
    };

    return (
        <div className="space-y-4 w-full">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">

                <SeccionDeFormulario icon={ShieldCheck} titulo="Licencia de funcionamiento (CSSP/DNM)">
                    <LazyInput
                        label="Número de resolución"
                        name="suc-srs-resolucion"
                        placeholder="Ej: SRS-2024-001"
                        value={legal.srsPermit || ""}
                        onChange={(val) => updateNestedSetting('legal', 'srsPermit', val)}
                    />
                    {/* Uno debajo del otro: la sección ocupa media columna del
                        modal y a dos columnas el select se cortaba en «Ca…». */}
                    <div className="grid grid-cols-1 gap-4">
                        <div>
                            <span id="suc-srs-categoria" className={rotuloCampo('text-content-3')}>Categoría SRS</span>
                            <LiquidSelect
                                ariaLabelledBy="suc-srs-categoria"
                                value={legal.srsCategoria || ""}
                                onChange={(val) => updateNestedSetting('legal', 'srsCategoria', val || '')}
                                options={OPCIONES_CATEGORIA_SRS}
                                placeholder="Sin categoría"
                                clearLabel="Ninguna"
                            />
                        </div>
                        <LazyInput
                            label="Nº de inscripción SRS"
                            name="suc-srs-inscripcion"
                            placeholder="Ej: 0123"
                            value={legal.srsInscripcion || ""}
                            onChange={(val) => updateNestedSetting('legal', 'srsInscripcion', val)}
                        />
                    </div>
                    <Vencimiento rotulo="Vencimiento de la licencia" value={legal.srsExpiration}
                        onChange={(val) => updateNestedSetting('legal', 'srsExpiration', val)} />
                    <PieDocumento>
                        <FileUploader label="Licencia (PDF)" file={legal.srsPermitFile} url={legal.srsPermitUrl}
                            onChange={archivo('srsPermitFile', 'srsPermitUrl')} />
                    </PieDocumento>
                </SeccionDeFormulario>

                <SeccionDeFormulario icon={FileBadge} titulo="Regencia farmacéutica">
                    <div>
                        <span id="suc-regente" className={rotuloCampo('text-content-3')}>
                            Regente asignado
                            {availableRegents.length === 0 && <Badge size="sm" variant="warning" uppercase={false}>Sin personal</Badge>}
                        </span>
                        <LiquidSelect
                            ariaLabelledBy="suc-regente"
                            value={legal.regentEmployeeId || ""}
                            onChange={(val) => updateNestedSetting('legal', 'regentEmployeeId', val)}
                            options={regentOptions}
                            placeholder="Elegir regente"
                            clearLabel="Ninguno"
                        />
                    </div>
                    <Vencimiento rotulo="Vencimiento de la credencial" value={legal.regentCredentialExp}
                        onChange={(val) => updateNestedSetting('legal', 'regentCredentialExp', val)} />
                    <PieDocumento>
                        <FileUploader label="Contrato de regencia (PDF)" file={legal.regentCredentialFile} url={legal.regentCredentialUrl}
                            onChange={archivo('regentCredentialFile', 'regentCredentialUrl')} />
                    </PieDocumento>
                </SeccionDeFormulario>

                <SeccionDeFormulario icon={ShieldAlert} titulo="Referente de farmacovigilancia">
                    <div>
                        <span id="suc-farmacovigilancia" className={rotuloCampo('text-content-3')}>
                            Referente asignado
                            {availablePharmacovigilance.length === 0 && <Badge size="sm" variant="warning" uppercase={false}>Sin personal</Badge>}
                        </span>
                        <LiquidSelect
                            ariaLabelledBy="suc-farmacovigilancia"
                            value={legal.pharmacovigilanceEmployeeId || ""}
                            onChange={(val) => updateNestedSetting('legal', 'pharmacovigilanceEmployeeId', val)}
                            options={pharmaOptions}
                            placeholder="Elegir referente"
                            clearLabel="Ninguno"
                        />
                    </div>
                    <Vencimiento rotulo="Vencimiento de la credencial" value={legal.pharmacovigilanceExp}
                        onChange={(val) => updateNestedSetting('legal', 'pharmacovigilanceExp', val)} />
                    <PieDocumento>
                        <FileUploader label="Contrato o designación (PDF)" file={legal.farmacovigilanciaAuthFile} url={legal.farmacovigilanciaAuthUrl}
                            onChange={archivo('farmacovigilanciaAuthFile', 'farmacovigilanciaAuthUrl')} />
                    </PieDocumento>
                </SeccionDeFormulario>

                <SeccionDeFormulario icon={Syringe} titulo="Área de inyectables" tono="chart-9"
                    accion={<Switch label="Aplica inyecciones" on={legal.injections || false}
                        onToggle={() => updateNestedSetting('legal', 'injections', !legal.injections)} />}>
                    {legal.injections ? (
                        <>
                            <fieldset>
                                <legend className={rotuloCampo('text-content-3')}>Enfermería autorizada</legend>
                                {availableNurses.length === 0 ? (
                                    <Notice variant="warning">No hay personal de enfermería en esta sucursal</Notice>
                                ) : (
                                    // Casillas, no botones con «✓» en el texto: lo
                                    // que se elige es un sí/no por persona, y un
                                    // botón no anuncia si está marcado.
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                                        {availableNurses.map(emp => (
                                            <Checkbox key={emp.id}
                                                checked={enfermeriaIds.includes(String(emp.id))}
                                                onChange={() => toggleNurse(emp.id)}
                                                label={shortEmployeeName(emp)} />
                                        ))}
                                    </div>
                                )}
                            </fieldset>
                            <PieDocumento>
                                <FileUploader label="Permiso del área (PDF)" file={legal.nursingServicePermitFile} url={legal.nursingServicePermitUrl}
                                    onChange={archivo('nursingServicePermitFile', 'nursingServicePermitUrl')} />
                            </PieDocumento>
                        </>
                    ) : <Desactivado icon={Syringe} />}
                </SeccionDeFormulario>
            </div>

            <SeccionDeFormulario icon={FileWarning} titulo="Libros controlados" tono="warning"
                accion={<Switch label="Libros controlados" on={legal.controlledBooks || false}
                    onToggle={() => updateNestedSetting('legal', 'controlledBooks', !legal.controlledBooks)} />}>
                {legal.controlledBooks ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <LazyInput
                            label="Nº de resolución de autorización"
                            name="suc-libros-resolucion"
                            placeholder="Ej: RES-LIB-2025"
                            value={legal.controlledBooksRes || ""}
                            onChange={(val) => updateNestedSetting('legal', 'controlledBooksRes', val)}
                        />
                        <Vencimiento rotulo="Vencimiento de la autorización" value={legal.controlledBooksExp}
                            onChange={(val) => updateNestedSetting('legal', 'controlledBooksExp', val)} />
                        <div className="md:col-span-2">
                            <FileUploader label="Resolución de libros (PDF)" file={legal.controlledBooksFile} url={legal.controlledBooksUrl}
                                onChange={archivo('controlledBooksFile', 'controlledBooksUrl')} />
                        </div>
                    </div>
                ) : <Desactivado icon={FileWarning} />}
            </SeccionDeFormulario>
        </div>
    );
};

export default React.memo(BranchTabLegal);
