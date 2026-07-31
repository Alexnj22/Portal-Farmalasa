SET lock_timeout = '5s';

-- Backfill de la ficha fiscal de los 93 clientes que facturan CCF.
--
-- Extraídos del ERP el 2026-07-31 (`editar_cliente.php?id_cliente=N`, sólo
-- lectura), cruzados por nombre normalizado contra el maestro de 27,545: 87
-- cruzaron 1:1 y 6 estaban DUPLICADOS en el ERP —una ficha con datos fiscales y
-- otra vacía—, resueltos tomando la que los tiene. Cero sin match.
--
-- 82 de los 93 traen NRC. Los 11 restantes no lo tienen porque en el ERP están
-- como categoría "Consumidor": se les emitió un CCF a alguien sin registro de
-- contribuyente, que es una irregularidad del ERP y no un hueco de este cruce.
--
-- **Dos pares son la MISMA persona con el nombre invertido**, duplicada en los
-- dos sistemas — lo detectó el índice único de `nit`, que abortó el primer
-- intento en vez de escribir basura:
--
--     494  ALVARENGA ALVARENGA FRANCISCO ANTONIO  ≡  17015 (5 CCF)  ← gana
--     7414 NERIS ORTIZ PALMA                      ≡  21268 (3 CCF)  ← gana
--
-- El NIT y el NRC van al registro con más facturas; el gemelo recibe teléfono,
-- correo, dirección y giro pero queda SIN identificadores fiscales, marcado
-- para fusionar. Fusionarlos es una decisión aparte: hay facturas colgando de
-- los dos.
--
-- **Sólo se llena lo VACÍO.** `coalesce(columna, nuevo)` en vez de asignación
-- directa: si alguien ya corrigió un dato a mano en el portal, no se lo pisa.
UPDATE public.customers c SET
    erp_id    = coalesce(c.erp_id,    v.erp_id),
    nit       = coalesce(nullif(btrim(c.nit),  ''), v.nit),
    dui       = coalesce(nullif(btrim(c.dui),  ''), v.dui),
    nrc       = coalesce(nullif(btrim(c.nrc),  ''), v.nrc),
    phone     = coalesce(nullif(btrim(c.phone),''), v.telefono1),
    telefono2 = coalesce(c.telefono2, v.telefono2),
    email     = coalesce(nullif(btrim(c.email),''), v.correo),
    pasaporte = coalesce(c.pasaporte, v.pasaporte),
    direccion = coalesce(c.direccion, v.direccion),
    municipio = coalesce(c.municipio, v.municipio),
    categoria = coalesce(c.categoria, v.categoria),
    giro      = coalesce(c.giro,      v.giro),
    updated_at = now()
FROM (VALUES
    (494, '14318', NULL, NULL, NULL, '7987-2550', NULL, 'franalvarenga90@gmail.com', NULL, 'CALLE SAN MARTIN, BO EL CENTRO', 'Chalatenango Sur', 'Contribuyente', 'Venta al por menor de artículos de bazar'),
    (21408, '14272', '0082-8912--9', '00828912-9', '273226-9', '7586-1208', NULL, 'amilcarlopez29@gmail.com', NULL, 'CTON. EL ZAPOTE CRIO LAS VICTORIA . CALUCO ,SONSONATE', 'Sonsonate Centro', 'Contribuyente', 'Servicios profesionales y científicos ncp'),
    (22061, '6313', NULL, '03386699-8', NULL, '7698-1917', NULL, NULL, NULL, 'LAS MINAS', 'Chalatenango Sur', 'Consumidor', NULL),
    (3141891, '26517', '0416-120499-101-2', NULL, '151016-1', '7928-5902', NULL, 'apanc.nuevaconcepcion@gmail.com', NULL, 'ENTRE 2A Y 8VA CALLE ORIENTE 12 AV. SUR, Bº EL ROSARIO, NUEVA CONCEPCION, CHALATENANGO', 'Chalatenango Centro', 'Contribuyente', 'Venta de productos para uso agropecuario'),
    (8522, '25061', '0617-200623-101-0', NULL, '331462-6', '6982-8271', NULL, 'oranteszaira@gmail.com', NULL, NULL, 'San Salvador Norte', 'Gran Contribuyente', 'Actividades de clubes deportivos'),
    (2085, '9743', '0511-040295-101-8', NULL, '83086-0', '7118-9084', '7707-9246', 'ccf-dte-operaciones@promerica.com.sv', NULL, 'Edificio Promerica, Centro Comercial La Gran Vía, Entre Calle Chilitupán y Carretera Panamericana', 'La Libertad Sur', 'Gran Contribuyente', 'Bancos'),
    (14222, '3359', '9501-070381-101-6', '00848645-4', '227579-3', '7844-0814', NULL, 'gerenciarestaurantelaparrilla@gmail.com', NULL, 'AV. DR EMILIO ALVAREZ, LOCAL 8, COL. MEDICA EDIF. EMERSON, #301, SAN SALVADOR, SAN SALVADOR', 'Chalatenango Sur', 'Contribuyente', 'Servicios n.c.p.'),
    (2191, '3093', '0418-7969--6', '04187969-6', '354201-0', '7965-5879', NULL, 'elizabethaguilar112924@gmail.com', NULL, 'NUEVA CONCEPCION CHALATENANGO', 'Chalatenango Sur', 'Contribuyente', 'Venta de productos farmaceuticos y medicinales'),
    (680, '23437', '0360-1992--2', '03601992-2', '305996-4', '7206-8788', NULL, 'irisdoradea8@gmail.com', NULL, 'CHALATENANGO', 'Chalatenango Sur', 'Contribuyente', 'Venta en tiendas de articulos de primera necesidad'),
    (6378, '3782', NULL, '03951384-4', NULL, '7655-7613', NULL, NULL, NULL, 'COL LOS PINARES', 'Chalatenango Sur', 'Consumidor', NULL),
    (12100, '21688', '0418-070853-001-0', NULL, '158163-9', '6002-6492', NULL, 'f.electronicarm2023@gmail.com', NULL, 'AV. FAJARDO #3 BARRIO SAN JOSE CHALATENANGO CHALATENANGO', 'Chalatenango Sur', 'Contribuyente', 'Actividades Inmobiliarias Realizadas a Cambio de una Retribución o por Contrata'),
    (22283, '12829', '0436-280824-101-7', NULL, '348005-4', '7090-2097', NULL, 'Centromedico@cmisach.com', NULL, 'CARRETERA A CHALATENANGO , LOTIFICACION PRIMAVERA 2 ,DISTRITO DE CHALATENANGO, MUNICIPIO DE CHALATENANGO SUR, DEPARTAMENTO DE CHALATENANGO', 'Chalatenango Sur', 'Contribuyente', 'Clínicas médicas'),
    (3380, '13471', NULL, '02677227-7', NULL, '7074-1277', NULL, NULL, NULL, 'CHALATENANGO', 'Chalatenango Sur', 'Consumidor', 'Venta al por mayor de revistas, periódicos, libros, artículos de librería y artículos de papel y cartón en general'),
    (22085, '8254', NULL, NULL, NULL, '1111-1111', NULL, NULL, NULL, 'CHALATENANGO, CHALATENANGO', 'Chalatenango Sur', 'Consumidor', NULL),
    (3299, '-1', NULL, NULL, NULL, '7961-9622', NULL, NULL, NULL, 'LUGAR DE PRUEBA', 'Chalatenango Sur', 'Consumidor', NULL),
    (232, '20935', '0614-031270-004-2', NULL, '9415-3', '7472-3461', NULL, 'recepcion@cofarsal.com.sv', NULL, 'COL, BUENOS AIRES, SAN SALVADOR', 'San Salvador Centro', 'Gran Contribuyente', 'Venta de productos farmaceuticos y medicinales'),
    (8362, '22119', '02677302--9', NULL, '120478-6', '7074-1277', NULL, 'clariel.alfaro6@yahoo.com', NULL, 'Calle Final 6a. Avenida Norte. Bº El Calvario #3', 'Chalatenango Sur', 'Contribuyente', 'Venta al por mayor de revistas, periódicos, libros, artículos de librería y artículos de papel y cartón en general'),
    (799, '21451', '0177-7948--2', NULL, '354446-7', '7588-1138', NULL, 'farmaciaelrosario25@gmail.com', NULL, 'CALLE LAS CARRERAS, BARRIO EL ROSARIO,#991,DISTRITO NUEVA CONCEPCION,MUNICIPIO CHALATENANGO CENTRO, DEPARTAMENTO DE CHALATENANGO.', 'Chalatenango Centro', 'Contribuyente', 'Venta de productos farmaceuticos y medicinales'),
    (1469, '9889', '0407-160705-101-0', '04071607-0', '166913-3', '7860-1755', '2335-2336', 'dihare1@outlook.com', NULL, 'CALLE MORAZAN, EL CALVARIO, CHALATENANGO, #36', 'Chalatenango Sur', 'Contribuyente', 'Venta de combustibles, lubricantes y otros (gasolineras)'),
    (11482, '23534', '0407-261179-102-5', NULL, '250651-9', '7364-4822', NULL, 'mongedouglas838@gmail.com', NULL, 'Bª EL CALVARIO CL DOLORES MARTELL ·6', 'Chalatenango Sur', 'Contribuyente', 'Actividades jurídicas'),
    (2188, '9997', '0309-5861--5', '03095861-5', '322260-9', '7160-3483', NULL, 'valdemarfuntes@gmail.com', NULL, 'COL VALLE NUEVO', 'Chalatenango Centro', 'Contribuyente', 'Servicios médicos'),
    (9782, '15096', '0614-240575-139-0', NULL, '206762-2', '7170-8664', NULL, 'dra.irisiglesias@gmail.com', NULL, 'San Miguel', 'San Miguel Centro', 'Contribuyente', 'Servicios médicos'),
    (3141950, '15944', '0405-9437--4', '04059437-4', '383031-1', '7681-7906', NULL, 'CLINICA.LAB.ARCATAO@GMAIL.COM', NULL, 'CALLE ERNESTO DUBON DUBON, BARRIO EL CENTRO A UN COSTA DE LA IGLESIA CATOLICA DISTRITO DE ARCATAO MUNICIPIO DE CHALATENANGO SUR DEPARTAMENTO DE CHALATENANGO', 'Chalatenango Sur', 'Contribuyente', 'Servicios médicos'),
    (16195, '4373', '0113-7497--5', '01137497-5', '320082-1', '7021-8341', NULL, 'edgaralfredomar@gmail.com', NULL, 'FINAL 6 CALLE PONIENTE, BO EL CHILE 57 CHALATENANGO', 'Chalatenango Sur', 'Contribuyente', 'Venta al por menor de materiales de construcción y artículos conexos'),
    (1404, '5187', '0614-260466-012-1', '01086191-1', '113485-1', '7852-7233', NULL, 'facturasclimafen2025@gmail.com', NULL, 'BARRIO EL CHILE. CLINICA MATERNO FAMILIAR', 'Chalatenango Sur', 'Contribuyente', 'Servicios médicos'),
    (3174808, '27117', '0435-040626-101-3', NULL, '387370-3', '7713-8594', NULL, 'erssi.facturae@gmail.com', NULL, '1RA AV.NORTE,BARRIO EL ROSARIO,DISTRITO DE NVA CONCEPCION', 'Chalatenango Centro', 'Contribuyente', 'Servicios médicos'),
    (3636, '24052', '0019-5557--5', NULL, '263916-8', '7988-0015', NULL, 'drapalma1@gmail.com', NULL, 'PSJ.1 COL.LA FLORESTA,#78,ATRAS DE GRUPO Q', 'San Salvador Centro', 'Contribuyente', 'Servicios médicos'),
    (7188, '17808', '0407-040290-101-5', '04219757-6', '292171-6', '7803-9630', NULL, 'dr.casamalhuapaz@gmail.com', NULL, 'COL CAYAGUANCA PAJ 4 #13', 'Chalatenango Sur', 'Contribuyente', 'Servicios médicos'),
    (9778, '5377', '0539-7994--9', '05397994-9', '341356-1', '7019-1855', NULL, 'ltcontadores25@gmail.com', NULL, 'CANTON UPATORO,CHALATENANGO, CHALATENANGO', 'Chalatenango Sur', 'Contribuyente', 'Actividades de contabilidad, teneduría de libros y auditoría; asesoramiento en materia de impuestos'),
    (19171, '2930', '0140-5740-9', '01405740-9', '195501-2', '7945-7949', NULL, 'ERNESTOALONSOGARCIA65@GMAIL.COM', NULL, '15 CALLE PONIENTE, COL. ATONALT, CASA 6, SONSONATE, SONSONATE', 'Chalatenango Sur', 'Contribuyente', 'Actividades de consultoria en gestión empresarial'),
    (19029, '3533', '0195-7974--9', '01957974-9', '240149-3', '72961550', NULL, 'flormejicanos32@gmail.com', NULL, 'calle san martin,bo.el centro#5distrito de chalatenango municipio de chalatenango sur', 'Chalatenango Sur', 'Contribuyente', 'Servicios de análisis y estudios de diagnóstico'),
    (17015, '4324', '0407-051066-002-0', '02239849-1', '105181-4', '7234-8991', NULL, 'franalvarenga90@gmail.com', NULL, 'CALLE SAN MARTIN, BARRIO EL CENTRO, CHALATENANGO, CHALATENANGO', 'Chalatenango Sur', 'Contribuyente', 'Venta al por menor de artículos de bazar'),
    (18978, '4284', '0407-260670-101-8', '01307747-2', '97361-0', '7600-6161', NULL, 'chicoperaza_16@hotmail.com', NULL, 'FIINAL CLLE MORAZAN, BA EL CALVARIO,', 'Chalatenango Sur', 'Contribuyente', 'Fabricación de productos de madera, corcho, paja y materiales trenzables ncp'),
    (18096, '1419', '0185-7026--3', '01857026-3', '121857-0', '7874-1598', NULL, 'corazondemaria321@gmail.com', NULL, 'BO EL CENTRO, AGUA CALIENTE, CHALATENANGO', 'Chalatenango Centro', 'Contribuyente', NULL),
    (21449, '19520', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
    (489, '13968', '0263-1965--5', '02631965-5', '131742-2', '7966-3072', NULL, 'scontablesguardado@gmail.com', NULL, 'calle principal, bo la vega, distrito de sn mig mercedes, municipio de chalatenango sur, depto de chalatenango', 'Chalatenango Sur', 'Contribuyente', 'Servicios para el transporte ncp'),
    (10105, '10222', '0165-9791--8', NULL, '223276-5', '7875-1168', NULL, 'frejorf0478@yahoo.com', NULL, 'BARRIO SAN ANTONIO CHALATENANGO', 'Chalatenango Sur', 'Contribuyente', 'Clínicas médicas'),
    (1830090, '25953', '0614-280185-003-4', NULL, '497-9', '2278-8603', NULL, 'contabilidad@fessic.com', NULL, 'CHAPARRASTIQUE SANTA ELENA 4 ANTIGUO CUSCATLAN LA LIBERTAD', 'La Libertad Sur', 'Contribuyente', 'Construcción de obras de ingeniería civil n.c.p.'),
    (931, '15079', '0614-120110-104-7', NULL, '199010-7', '7093-3344', NULL, 'FUNERALESLANUEVAPROTECCION@HOTMAIL.COM', NULL, '2DA AVENIDA SUR Y 2DA CALLE ORIENTE, BARRIO SAN ANTONIO, DISTRITO DE CHALATENANGO, CHALATENANGO SUR, CHALATENANGO', 'Chalatenango Sur', 'Contribuyente', 'Pompas fúnebres y actividades conexas'),
    (10925, '22438', '0436-100625-101-0', NULL, '365435-2', '7862-9914', NULL, 'gerson06081994@gmail.com', NULL, '2DA. AV. SUR, BO SAN ANTONIO, FRENTE A PARQUEO DEL HOSPITAL, DISTRITO DE CHALATENANGO, CHALATENANGO SUR, CHALATENANGO', 'Chalatenango Sur', 'Contribuyente', 'Pompas fúnebres y actividades conexas'),
    (9074, '21081', '0503-4487--8', NULL, '265693-8', '6003-0092', NULL, 'gerson06081994@gmail.com', NULL, '2 AV SUR BARRIO SAN ANTONIO, FRENTE A PARQUEO DE HOSPITAL', 'Chalatenango Sur', 'Contribuyente', 'Cultivo de cereales excepto arroz y para forrajes'),
    (1855682, '26123', '1217-280920-101-6', NULL, '293512-0', '7841-4446', NULL, 'FACTURASDEGLOBAL@GMAIL.COM', NULL, '99AV.NORTE BLOCK1285.L15,COL.ESCALON,#651,SAN SALVADOR, SAN SALVADOR', 'San Salvador Centro', 'Contribuyente', 'Servicios de ingeniería'),
    (19466, '16276', '0210-0342--9', '02100342-9', '330951-8', '7112-0313', NULL, 'walteralexander1030@gmail.com', NULL, 'LOT LOS ALMENDROS FINAL CL CANYUCO', 'Chalatenango Sur', 'Contribuyente', 'Venta al por mayor de alimentos'),
    (20608, '24082', '0614-131285-003-8', NULL, '241-0', '7856-8552', NULL, 'cojutepeque@impressarepuestos.com', NULL, 'CARR. A QUEZALTEPEQUE KM 17 1/2 POLIG. 2, CTON, JOYA GALANA, HDA. EL ANGEL LOTIF, LAS VENTANAS, #9, APOPA, SAN SALVADOR, SAN SALVADOR OESTE, SAN SALVADOR', 'San Salvador Oeste', 'Contribuyente', 'Venta de partes, piezas y accesorios nuevos para vehículos automotores'),
    (15578, '11865', '0614-021014-104-7', NULL, '236421-3', '7655-0731', NULL, 'inversionesrodriguezayala@gmail.com', NULL, 'CLL PASEO GENERAL ESCALON APTO #36B COL ESCALON COND ALTOS DEL PASEO,', 'Chalatenango Sur', 'Contribuyente', 'Servicios de ingeniería'),
    (8860, '8432', NULL, '06918351-4', NULL, '7128-0440', NULL, NULL, NULL, 'CHALATENANGO, CHALATENANGO', 'Chalatenango Sur', 'Consumidor', NULL),
    (17941, '15550', '0407-190481-101-6', '02330781-1', '140569-9', '7852-0252', NULL, 'jhumberto20s@hotmail.com', NULL, '6TA AV SUR, B°EL CALVARIO, CHALATENANGO', 'Chalatenango Sur', 'Contribuyente', 'Venta al por menor de libros, periódicos y artículos de papelería en comercios especializados'),
    (8636, '19954', '0416-281077-102-4', NULL, '207430-0', '7213-7098', NULL, 'farma.provida@gmail.com', NULL, 'BARRIO EL ROSARIO, NVA CONCEPCION', 'Chalatenango Centro', 'Contribuyente', 'Venta de productos farmaceuticos y medicinales'),
    (3277, '3650', NULL, '05038930-7', NULL, '7697-7197', NULL, NULL, NULL, 'BARRIO LA SIERPE  SECTOR 1 #2', 'Chalatenango Sur', 'Consumidor', NULL),
    (3073, '5072', '0407-120781-102-4', '02374209-5', '366787-5', '7677-9938', NULL, 'mvzmejia.dte@gmail.com', NULL, 'BARRIO EL CALVARIO', 'Chalatenango Sur', 'Contribuyente', 'Actividades veterinarias'),
    (18484, '21749', '0108-5617--8', NULL, '241812-0', '7988-8963', NULL, 'JAIMESALGUERO233@GMAIL.COM', NULL, NULL, 'Chalatenango Sur', 'Contribuyente', 'Reparación de llantas de vehículos automotores'),
    (21495, '21083', '0207-300784-106-4', NULL, '236608-2', '7842-5883', NULL, 'contabilidad@omninet.com.sv', NULL, 'CARRETERA CHALATENANGO. LOCAL 1CTRIO.COM.PLACITA SANTA FE,FTE COLONIA SANTA FE EL PARAISO CHALTENANGO', 'Chalatenango Centro', 'Contribuyente', 'Actividades de suscripción y difusión de televisión por cable y/o suscripción'),
    (919, '22747', '0614-281186-106-6', NULL, '272165-6', '7459-0035', NULL, 'joseluisorellana.facturae@gmail.com', NULL, 'calle francisco parilla, local 2 , nueva concepcion chalatenango', 'Chalatenango Centro', 'Contribuyente', 'Servicios médicos'),
    (11708, '15270', NULL, '02689119-4', NULL, '7434-3012', NULL, NULL, NULL, 'CALLE PRINCIPAL', 'Chalatenango Sur', 'Consumidor', NULL),
    (871, '19574', '0416-230764-001-9', NULL, '78749-3', '7051-2289', NULL, 'pollomejia_66@hotmail.com', NULL, 'chalatenango', 'Chalatenango Sur', 'Contribuyente', 'Servicios médicos'),
    (16102, '13700', '0614-240775-001-0', NULL, '32757-3', '2251-9797', NULL, 'info@vijosa.com', NULL, 'CALLE PRIMAVERA Y 23 AV SUR CARRETERA PANAMERICANA', 'La Libertad Este', 'Gran Contribuyente', 'Manufactura de productos farmacéuticos, sustancias químicas y productos botánicos'),
    (3119, '6549', '0431-081084-101-3', '02572085-3', '234522-0', '7069-0219', NULL, 'divinonjesus.lab@gmail.com', NULL, 'LOS GUARDADOS SAN RAFAEL', 'Chalatenango Sur', 'Contribuyente', 'Servicios de análisis y estudios de diagnóstico'),
    (3161287, '26825', '0614-090608-107-3', NULL, '188516-3', '7746-7705', NULL, 'facturacionmaelsa@gmail.com', NULL, NULL, 'San Salvador Norte', 'Contribuyente', 'Servicios n.c.p.'),
    (14472, '23198', '0601-070580-102-6', NULL, '231654-0', '7636-4080', NULL, 'lic.castillomenjivar80@gmail.com', NULL, 'NUEVA CONCEPCION', 'Chalatenango Centro', 'Contribuyente', 'Servicios de análisis y estudios de diagnóstico'),
    (1043, '19713', '0614-160715-001-5', NULL, '21019-6', '2257-6666', NULL, 'zzlSVfacturaciontecnica@mapfre.com.sv', NULL, 'ALAMEDA ROOSEVELT, EDIFICIO LA CENTRO AMERICANA, #3107, SAN SALVADOR, SAN SALVADOR', 'San Salvador Centro', 'Contribuyente', 'Seguros generales de todo tipo'),
    (3967, '7026', NULL, '01610689-8', NULL, '1111-1111', NULL, NULL, NULL, 'CTON LOS HERNANDEZ', 'Chalatenango Sur', 'Consumidor', NULL),
    (1863, '22776', '0431-7503--0', NULL, '364786-5', '7673-4680', NULL, 'recinos1antonio@gmail.com', NULL, NULL, 'Chalatenango Sur', 'Contribuyente', 'Actividades de telecomunicación n.c.p.'),
    (6730, '13386', '0402-171077-101-6', '02305121-6', '147887-7', '7987-4810', NULL, 'Facturasquelyorellana@gmail.com', NULL, '2 AV SUR, BA SAN ANTONIO, CHALATENANGO, CHALATENANGO', 'Chalatenango Sur', 'Contribuyente', 'Fabricación de artículos de papel y cartón de uso personal y doméstico'),
    (11247, '24501', '0433-060577-101-1', NULL, '310925-0', '7930-2630', NULL, 'docmilandaverde@yahoo.com', NULL, '9 calle ote 4av , nte ,bo, el rosario , nva concepcion ,chalatenago', 'Chalatenango Centro', 'Contribuyente', NULL),
    (14901, '11728', '0407-270391-101-9', '04428764-4', '274979-0', '7203-5557', NULL, NULL, NULL, 'POL F LOT ALVARENGA LOTE#12 CHALATENANGO', 'Chalatenango Sur', 'Contribuyente', 'Venta de productos farmaceuticos y medicinales'),
    (18302, '19692', '0407-180477-101-7', NULL, '277537-0', '7601-1518', NULL, 'nelsonan180477@gmail.com', NULL, NULL, 'Chalatenango Sur', 'Contribuyente', 'Empleados'),
    (19479, '19338', '0411-7680--2', NULL, '257668-1', '7028-0459', NULL, 'NELSY2929@GMAIL.COM', NULL, '3º CALLE PONIENTE AV NORTE, COL.SAN GENARO #510-A SONSONATE,SONSONATE', 'Chalatenango Sur', 'Contribuyente', 'Actividades de consultoria en gestión empresarial'),
    (7414, '20011', NULL, NULL, NULL, '7278-0110', NULL, 'clinic.gastroenterologia2018@gmail.com', NULL, NULL, 'Chalatenango Sur', 'Contribuyente', 'Servicios de Odontología'),
    (21268, '15973', '0462-3018--0', '04623018-0', '283306-2', '7282-6621', NULL, 'clinic.gastroenterologia2018@gmail.com', NULL, 'LAS VUELTAS CHALATENANGO', 'Chalatenango Sur', 'Contribuyente', 'Servicios de Odontología'),
    (19398, '18837', '1217-260423-102-8', NULL, '329577-1', '7871-4232', NULL, 'peraciones@tumundolaboral.com.sv', NULL, 'CALLE LOS ALMENDROS URB VILLA FONTANA #4 SAN MIGUEL', 'San Miguel Centro', 'Contribuyente', 'Venta al por mayor de computadoras, equipo periférico y programas informáticos'),
    (22177, '3954', '0355-1817--7', '03551817-7', '365764-1', '7968-3894', NULL, 'osper2901@gmail.com', NULL, 'calle cuba av.independencia,bo.el centro distrito de concepcion quezaltepeque,chalatenango sur,chalatenango', 'Chalatenango Sur', 'Contribuyente', 'Servicios médicos'),
    (6329, '22807', '0343-7079--6', NULL, '266749-2', '7205-0974', NULL, 'farmaciacastaneda2025@outlook.com', NULL, 'AV. PROFESOR SILVESTRE J.D LAS VICTORIAS , #21 BIS, DISTRITO NUEVA CONCEPCION, MUNICIPIO DE CHALATENANGO CENTRO, DEPARTAMENTO DE CHALTENANGO', 'Chalatenango Centro', 'Contribuyente', 'Servicios médicos'),
    (3189247, '27467', '0436-020425-101-1', NULL, '363506-1', '7084-4559', NULL, 'fact.clinicasantalucia@gmail.com', NULL, '4 CALLE ORIENTE , SAN ANTONIO #15 CONTIGUO A COCINA DE DOÑA LUISA, DISTRITO DE CHALATENANGO', 'Chalatenango Sur', 'Contribuyente', 'Cultivo de cereales excepto arroz y para forrajes'),
    (3971, '24805', '0539-1795--5', NULL, '377094-2', '6420-8768', NULL, 'elizethportillo96@gmail.com', NULL, 'CALLE MASQUILISHUAT, APTO COL BUENOS AIRES', 'San Salvador Centro', 'Contribuyente', 'Servicios médicos'),
    (5083, '21305', '0089-5743--9', '00895743-9', '347021-9', '7094-6351', NULL, 'vallelemusreina@gmail.com', NULL, '4TA CALLE AV.NORTE, 5TA CALLE ORIENTE BO EL ROSARIO 737-B FRENTE A UNIDAD DE SALUD, NUEVA CONCEPCION CHALATENANGO', 'Chalatenango Centro', 'Contribuyente', 'Venta de productos farmaceuticos y medicinales'),
    (19493, '23949', '0472-9150--3', '04729150-3', '331248-7', '7282-5066', NULL, 'mobileethics@gmail.com', NULL, '6 CALLE PONIENTE, BO. EL CENTRO,#1310, FRENTE A PARQUE NUEVA CONCEPCION, NVA CONCEPCION CHALATENANGO', 'Chalatenango Centro', 'Contribuyente', 'Venta de equipo y accesorios de telecomunicación'),
    (2639, '6784', '0821-010269-104-4', '00415398-6', '248067-2', '7506-8991', NULL, 'tornoponce2025@gmail.com', NULL, 'CHALATENANGO, CHALATENANGO', 'Chalatenango Sur', 'Contribuyente', 'Servicios n.c.p.'),
    (8512, '9581', '0407-181268-101-9', '00074736-9', '190621-6', '7556-5498', NULL, 'rosarecinos63@gmail.com', NULL, 'CLL. MORAZAN, Y 2DA AV. SUR', 'Chalatenango Sur', 'Contribuyente', 'Venta de productos farmaceuticos y medicinales'),
    (15431, '2711', NULL, '00176888-9', NULL, '7816-7741', NULL, NULL, NULL, 'LAS MESITAS, SAN JOSE', 'Chalatenango Sur', 'Consumidor', NULL),
    (3185365, '27384', '0614-220208-102-0', NULL, '185353-2', '6062-0542', NULL, 'factura@siconsv.com', NULL, NULL, 'San Salvador Centro', 'Contribuyente', 'Obtención y dotación de personal'),
    (5387, '19428', '0329-8791--1', NULL, '307423-8', '7600-0091', NULL, 'sttefany.alvarenga@gmail.com', NULL, 'CALLE MORAZAN, BO. EL CALVARIO.', 'Chalatenango Sur', 'Contribuyente', 'Servicios médicos'),
    (3996, '21188', '0416-200981-102-2', NULL, '295744-6', '7284-3660', NULL, 'sussymarg4@gmail.com', NULL, 'av.chicunhuexo,Bo, el rosario #22, frente a hospedaje, nva concepcion,chalatenango', 'Chalatenango Centro', 'Contribuyente', 'Venta al por menor de medicamentos farmacéuticos y otros materiales y artículos de uso médico, odontológico y veterinario'),
    (8999, '23613', '0417-150373-101-4', NULL, '281319-4', '7915-8802', NULL, 'vicentamenjivar3@gmail.com', NULL, 'CANTON CARASQUE, NUEVA TRINIDAD, CHALATENANGO', 'Chalatenango Sur', 'Contribuyente', 'Actividades de consultoria en gestión empresarial'),
    (14808, '9370', '01274208-2', '01274208-2', '250887-5', '7562-5463', NULL, 'waltermancia24@gmail.com', NULL, 'CALLE PONIENTE, BO. EL CENTRO, DISTRITO DE AGUA CALIENTE, MUNICIPIO DE CHALATENANGO CENTRO', 'Chalatenango Centro', 'Contribuyente', 'Servicios médicos'),
    (2506, '20562', '0220-3331--2', '02203331-2', '329633-2', '7694-2465', NULL, 'limpiayrecicla555@gmail.com', NULL, 'COLONIA NUEVA VISTA, LA CABAÑA', 'San Salvador Norte', 'Contribuyente', 'Reciclaje de desperdicios y desechos de papel y cartón'),
    (11180, '2738', '0407-220383-101-9', '01069225-7', '286233-8', '7989-9118', NULL, 'rayosxchalatenango@gmail.com', NULL, 'BA SAN ANTONIO', 'Chalatenango Sur', 'Contribuyente', 'Servicios de análisis y estudios de diagnóstico'),
    (10493, '9795', '0418-140373-101-2', NULL, '296959-7', '7854-2691', NULL, 'yaniraaracelyaguilarayala@gmail.com', NULL, 'OJOS DE AGUA', 'Chalatenango Sur', 'Contribuyente', 'Venta de productos farmaceuticos y medicinales'),
    (9495, '26428', '0462-8803--6', NULL, '375864-3', '7726-7407', NULL, 'blancamendez20140206@gmail.com', NULL, 'CANT. VALLE NUEVO, CRIO, LOS CORTECES, DISTRITO DE EL PARAISO, MUNICIPIO DE CHALATENANGO CENTRO, DEPARTAMENTO DE CHALATENANGO', 'Chalatenango Centro', 'Contribuyente', 'Cultivo de otros cereales excepto arroz y forrajeros n.c.p.'),
    (11318, '20454', '0614-280317-101-8', NULL, '258637-7', '6994-9998', NULL, 'constructorabaruc022@gmail.com', NULL, 'AV. MONTERREY, COL 14 DE JULIO, ·14. SAN MIGUEL, SAN MIGUEL', 'San Miguel Centro', 'Contribuyente', 'Servicios de ingeniería'),
    (15465, '22736', '0432-250575-101-0', '00945168-0', '267366-7', '6456-8629', NULL, 'josegerardogutierez0000@gmail.com', NULL, 'SANTA RITA', 'Chalatenango Centro', 'Contribuyente', 'Cría y obtención de productos animales n.c.p.'),
    (7250, '8016', '0407-190381-101-2', '02509522-4', '185071-4', '7729-6443', NULL, 'jmmenjivar.fdigital@gmail.com', NULL, 'CHALATENANGO, CHALATENANGO', 'Chalatenango Sur', 'Contribuyente', 'Venta al por mayor de artículos de óptica'),
    (3178166, '27195', '0614-010491-138-0', NULL, '309507-4', '7000-3983', NULL, 'lorena.carrillo5556@gmail.com', NULL, 'SAN SALVADOR', 'San Salvador Centro', 'Contribuyente', 'Servicios médicos'),
    (17518, '26151', '0407-290795-102-8', NULL, '273974-8', '7913-9938', NULL, 'mayalibreria16@gmail.com', NULL, '2 CALLE ORIENTE 6AV.SUR,BO. SAN ANTONIO, CHALATENANGO', 'Chalatenango Sur', 'Contribuyente', 'Venta al por menor de libros, periódicos y artículos de papelería en comercios especializados')
) AS v(portal_id, erp_id, nit, dui, nrc, telefono1, telefono2, correo,
       pasaporte, direccion, municipio, categoria, giro)
WHERE c.id = v.portal_id;
