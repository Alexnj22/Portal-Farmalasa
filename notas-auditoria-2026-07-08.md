


                                                                              ▎ Voy a implementar la generación del contrato de trabajo para imprimir en Portal Farmalasa, tomando los datos ya capturados en el modal de creación/edición de empleado (EmployeeFormModal.jsx / tabla employees): nombre completo, DUI o documento alterno, nacionalidad, fecha de nacimiento, dirección, cargo, sucursal, tipo de contrato (Indefinido/Temporal/Servicios), fecha de inicio de contrato, fecha fin (si es Temporal, con base legal y motivo), horas semanales, salario base, y el archivo de "Contrato de Trabajo Firmado" ya vive en la pestaña Documentos.
▎
▎ Te voy a compartir el formato exacto del contrato (Word/PDF/imagen de referencia, o el texto completo con los espacios/campos a llenar). Con eso:
▎ 1. Identifica qué campos del formato ya existen en el modal vs. cuáles faltan capturar.
▎ 2. Genera el PDF usando pdfmake (ya es la librería usada en el proyecto para imprimir, ver pedidoPrint.js), respetando el formato que compartas línea por línea.
▎ 3. Agrega un botón "Generar Contrato" en la pestaña Documentos (o Contrato) del modal que arme el PDF con los datos ya en formData y lo abra para imprimir/descargar — sin necesidad de guardar el empleado primero si es posible, o inmediatamente después de guardar.
▎ 4. Si el formato exige texto legal fijo (cláusulas, testigos, etc.) que no varía por empleado, inclúyelo tal cual me lo compartas, sin resumir ni parafrasear.


