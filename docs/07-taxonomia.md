# 07 · Taxonomía de discovery: frentes, verticales, subsector y rol

Estado: **propuesta para decidir** (30/09/2026). La taxonomía provisoria ya está cargada con códigos estables
(V01–V17 en `verticals.code`) y **no bloquea** el piloto: reetiquetar cambia el nombre, no el código, y no pierde historia.

## Cuatro dimensiones distintas (no mezclarlas)

| Dimensión | Qué responde | Controlada | Ejemplo |
|---|---|---|---|
| **Frente** | Dónde miramos (agrupa verticales para la agenda de campo) | Sí, 6 | F2 Flotas y logística |
| **Vertical** | Qué necesidad o mercado se investiga (unidad de cobertura y de la ficha común) | Sí, V01–V17 | V04 Gomerías + neumáticos |
| **Subsector / actividad** | Qué hace la empresa, con el lenguaje del Sheet | No (texto libre, se conserva) | "Housing + facility management" |
| **Rol en el ecosistema** | Qué papel juega el actor (puede tener varios) | Sí, lista cerrada | contratista, comprador corporativo, broker |

Texto libre **nunca** crea una vertical. RELEVO propone la asignación (del sector y subsector) y una persona la aprueba; lo ambiguo va a revisión.

## Propuesta: 6 frentes, 16 verticales + V17

| Frente (kickoff) | Verticales |
|---|---|
| F1 Operación industrial y abastecimiento | V02 Ferreterías + suministros industriales · V07 Lavanderías industriales + textiles · V08 Limpieza + facility management · V14 Construcción + mantenimiento · V15 Servicios industriales especializados |
| F2 Flotas y logística | V04 Gomerías + neumáticos · V05 Lavaderos de vehículos · V06 Estaciones de servicio · V10 Repuestos / talleres / lubricentros · V11 Logística / almacenamiento / última milla |
| F3 Alojamiento y servicios corporativos | V09 Alojamiento + campamentos · V01 Viandas / restaurantes / catering |
| F4 Activos y operadores | **V17 Inmuebles, activos y fondos de comercio** (provisoria) |
| F5 Vida cotidiana | V03 Farmacias + salud cotidiana · V12 Comercio cotidiano · V13 Servicios para trabajadores + familias |
| F6 Tecnología y productividad | V16 Software + automatización B2B |

## Las 17 verticales: qué entra, qué no y qué pregunta responde

La vertical se asigna por **la pregunta que se investiga**, no por el objeto: el mismo hotel puede estudiarse como servicio (V09) o como activo (V17).

| Código | Vertical | Frente | Entra | No entra (va a) | Pregunta central |
|---|---|---|---|---|---|
| V01 | Viandas / restaurantes / catering | F3 | Viandas B2B, catering de campamento, comedores, restaurantes, comida preparada para turnos | Supermercado y kiosco (V12) | ¿Quién come qué, cuándo, quién paga y qué falla en horario o entrega? |
| V02 | Ferreterías + suministros industriales | F1 | Ferretería, EPP, hidráulica, electricidad, consumibles, MRO | Repuestos de vehículos (V10); materiales de obra (V14) | ¿Qué SKU críticos faltan, con qué urgencia y cómo compra mantenimiento? |
| V03 | Farmacias + salud cotidiana | F5 | Farmacia, consultorio, estudios, salud ocupacional | Servicios HSE técnicos de campo (V15) | ¿Qué se resuelve acá y qué obliga a viajar? |
| V04 | Gomerías + neumáticos | F2 | Gomería, auxilio en ruta, neumáticos de flota y livianos | Talleres mecánicos (V10) | ¿Cuánto cuesta un neumático o auxilio que no llega a tiempo? |
| V05 | Lavaderos de vehículos | F2 | Lavado de flota, maquinaria y pickups; certificación de limpieza | — | ¿Pesa más horario, certificación o precio? |
| V06 | Estaciones de servicio | F2 | Combustible, tienda y café en ruta, servicios al tránsito, convenios de flota | Venta de una estación (V17 + V06) | ¿Dónde hay picos, colas y servicios anexos que faltan? |
| V07 | Lavanderías industriales + textiles | F1 | Ropa de cama de hoteles y campamentos, uniformes, EPP textil | Limpieza de instalaciones (V08) | ¿Capacidad, retiros y reposición alcanzan para el housing? |
| V08 | Limpieza + facility management | F1 | Limpieza, mantenimiento liviano, paquetes de facility para hoteles, campamentos y bases | Construcción y mantenimiento edilicio mayor (V14) | ¿Qué servicio tercerizado falla cuando cambia la dotación? |
| V09 | Alojamiento + campamentos | F3 | **El servicio de alojamiento**: hoteles y apart en operación, campamentos, módulos, housing corporativo (camas o unidades contratadas por empresas), ocupación, tarifas, rotación | Comprar, vender o desarrollar el inmueble (V17); construir módulos (V14) | ¿Quién compra camas, cuántas, a qué precio y qué pasa con la vacancia? |
| V10 | Repuestos / talleres / lubricentros | F2 | Taller mecánico, repuestos, lubricentro, diagnóstico de flotas | Neumáticos (V04) | ¿Cuántos días queda parado un vehículo y por qué? |
| V11 | Logística / almacenamiento / última milla | F2 | Transporte liviano, depósitos como servicio, entregas urgentes, transporte de personal, arena | Comprar o alquilar el depósito como activo (V17) | ¿Dónde se espera, cuánto cuesta y quién lo contrata? |
| V12 | Comercio cotidiano | F5 | Supermercados, kioscos, indumentaria, hogar, fuga de gasto a Neuquén | Restaurantes (V01) | ¿Qué se compra afuera y por qué (surtido, precio, horario)? |
| V13 | Servicios para trabajadores + familias | F5 | Gimnasios, peluquerías, guarderías, educación, recreación, movilidad personal | Salud (V03); vivienda (V17) | ¿Qué servicio se usa de verdad y qué lo limita (turnos, horario)? |
| V14 | Construcción + mantenimiento | F1 | Obra, materiales, instalaciones, refrigeración, grupos electrógenos, construcción modular, mantenimiento edilicio | Desarrollar o invertir en el inmueble (V17) | ¿Quién contrata obra y qué subcontrato es difícil de cubrir? |
| V15 | Servicios industriales especializados | F1 | Inspección, HSE, residuos, alquiler de equipos, servicios técnicos a operadoras | Software (V16) | ¿Qué servicio habilitado falta para urgencias y qué barrera tiene? |
| V16 | Software + automatización B2B | F6 | Procesos con doble carga: compras, certificación, partes, logística, administración | — | ¿Qué fricción medible pagaría alguien por eliminar? |
| V17 | Inmuebles, activos y fondos de comercio (provisoria) | F4 | **La transacción o la tenencia de un activo**: terrenos, naves y depósitos, inmuebles comerciales, hoteles o complejos en venta, desarrollos inmobiliarios y de housing, vivienda y alquiler residencial, fondos de comercio, negocios operativos en venta, activos subutilizados | La operación del servicio que el activo presta (su vertical de uso) | ¿Conviene comprar, desarrollar, alquilar o asociarse, a qué precio real y con qué renta? |

## Alojamiento, housing, real estate y activos: una sola regla

**V09 = el servicio de alojamiento** (alguien paga por noches, camas o unidades). **V17 = el activo como negocio** (alguien compra, vende, desarrolla o alquila el inmueble o el fondo de comercio). **V14 = el servicio de construirlo o mantenerlo.** Nada se duplica: cada caso tiene una pregunta y una vertical principal; si importa la otra mirada, se suma como vertical secundaria.

| Caso | Vertical principal | Secundaria | Rol típico |
|---|---|---|---|
| Hotel o apart en operación (ocupación, clientes, tarifas) | V09 | — | operador de activo |
| Hotel o complejo en venta (La Forestada) | V17 | V09 (uso) | propietario, broker |
| Housing corporativo: camas contratadas por empresas | V09 | — | operador de activo, comprador corporativo |
| Desarrollo de housing o de un complejo nuevo | V17 | V09 (uso futuro) | desarrollador, inversor |
| Vivienda y alquiler residencial para familias | V17 | V13 (demanda de residentes) | propietario, broker |
| Terreno (sobre ruta, loteo, parque industrial) | V17 | la del uso previsto, si existe | propietario, broker |
| Nave o depósito en venta o alquiler (dos naves) | V17 | V11 (uso logístico) | propietario, operador / inquilino |
| Fondo de comercio (p. ej. una lavandería en venta) | V17 | la del negocio (V07) | propietario |
| Activo operativo subutilizado (playa ferroviaria) | V17 | V11 | propietario (público o privado) |
| Constructora de módulos o de housing | V14 | V09 | proveedor, contratista |
| Inmobiliaria o broker | V17 | — | broker |
| Mountain Suites (proyecto) | V17 | V09 | — |

**Por qué 16 + 1 y no 16 ni 18**, contra los cinco criterios:

1. **Presentación de verticales**: las 16 conservan su definición, su ficha común (oferta, demanda, economía, barreras, evidencia, siguiente paso) y su numeración = H-VA-01…16. No se tocan: son la base de comparación.
2. **Kickoff**: define un frente entero "Activos + operadores" (fondos de comercio, empresas familiares, inmuebles comerciales y depósitos, activos subutilizados), una de las 7 preguntas de negocio (¿qué negocio o activo puede comprarse, asociarse o mejorar?) y un día de campo (21/10). Con 16, ese frente no tiene dónde registrarse.
3. **CRM real**: ~40 de 102 empresas son desarrollo inmobiliario, housing, inmobiliarias u operadores de activos; HAL-001 y HAL-002 son activos en venta; Mountain Suites es un proyecto sobre un activo. Forzarlos a V09 mezcla "¿hay demanda de camas?" con "¿conviene comprar este activo?", que se investigan distinto.
4. **Trabajo de campo**: la ficha de V17 es otra (precio publicado vs. real, ocupación, renta, contratos, propietario / broker / operador, motivo de venta) y ya existe como sección del Morning Brief ("Radar de activos + negocios").
5. **Preguntas que RELEVO debe responder**: "¿qué activos detectamos y con qué evidencia?", "¿dónde tengo punto ciego?" necesitan que activos tenga cobertura medible como cualquier vertical.

**Regla de convivencia**: un activo o empresa puede tener **vertical de uso** (p. ej. un hotel en venta: V09) **y** V17 cuando lo que se evalúa es la transacción o el operador. No hace falta V18: "comprador corporativo" y "contratista industrial" son **roles**, no verticales.

**Qué quedaría para revisar con el campo**: si V05 (lavaderos) y V06 (estaciones) justifican seguir separadas o se agrupan bajo F2 como "servicios al tránsito" (con pocas empresas y señales, fusionarlas facilita comparar); decidir después del 26/10 con evidencia, no antes.

## Roles (varios por empresa)

operadora · contratista · proveedor · comprador corporativo · desarrollador · broker / inmobiliaria · propietario · operador de activo · inversor · cámara / institución · potencial socio · competidor.
Hoy `companies.kind` admite uno solo: el siguiente paso es una tabla `company_roles` (empresa, rol, fuente, desde) para permitir varios.

## Activos y fondos de comercio

- **Activo** = entidad propia (`assets`), con partes con rol (`asset_parties`: propietario, broker, operador, inquilino), historia de precio y fuente de cada precio.
- **Fondo de comercio / negocio operativo** = empresa + activo vinculados; la oportunidad es la transacción (V17), el mercado donde opera es su vertical de uso.
- Nada de esto crea una oportunidad: un aviso publicado es una señal (DECLARACIÓN del anunciante), no una intención de venta validada.

## Cobertura medible por vertical (recorrido común)

**fuente / respuesta → evidencia → segmento o empresa → vertical → hipótesis → pregunta de campo → decisión**

Implementado ya: evidencia ↔ hipótesis (`finding_evidence`, a favor / en contra / contexto), hipótesis ↔ vertical (`findings.vertical_id`), hipótesis ↔ preguntas (`question_findings`), hipótesis ↔ empresas del universo (`finding_companies`), respuestas Voice → evidencia (`evidence.survey_response_id`), señales del Morning Brief → vertical e hipótesis, decisiones (`decisions`). Nada se promueve solo.

## Correspondencia de etiquetas actuales

### Sector del CRM (102 empresas, 47 etiquetas) → propuesta

Empresas por vertical propuesta (una empresa puede sumar a dos): V01: 13, V02: 5, V03: 3, V04: 1, V04/V05: 3, V07: 5, V08: 2, V09: 21, V10: 4, V11: 7, V12: 3, V13: 1, V14: 10, V14/V15: 4, V15: 4, V16: 2, V17: 25.

| Sector en el Sheet | Empresas | Vertical propuesta | Rol probable |
|---|---|---|---|
| Gastronomía / viandas | 13 | V01 | proveedor |
| Desarrollo inmobiliario / housing | 12 | V17 | desarrollador |
| Alojamiento | 7 | V09 | operador de activo |
| Lavandería / limpieza | 5 | V07 / V08 | proveedor |
| Comprador corporativo | 5 | — (rol, no vertical) | comprador corporativo / operadora |
| Suministros industriales | 4 | V02 | proveedor |
| Contratista industrial | 4 | — (rol) + V14/V15 según servicio | contratista |
| Automotor y flotas | 3 | V10 (V04/V05 según el caso) | proveedor |
| Alojamiento corporativo / housing | 3 | V09 | operador de activo |
| Housing corporativo | 3 | V09 | operador de activo |
| Servicios industriales | 2 | V15 | contratista |
| Comercio cotidiano | 2 | V12 | proveedor |
| Construcción modular / servicios industriales | 2 | V09 + V14 | proveedor |
| Construcción / housing | 2 | V17 + V14 | desarrollador |
| Desarrollo inmobiliario / urbanismo | 2 | V17 | desarrollador |
| Desarrollo inmobiliario / construcción | 2 | V17 + V14 | desarrollador |
| Comercio / servicios | 1 | V12 | proveedor |
| Construcción e infraestructura | 1 | V14 | contratista |
| Logística petrolera | 1 | V11 | contratista |
| Logística | 1 | V11 | proveedor |
| Servicios integrales | 1 | V08 | proveedor |
| Obras y maquinaria | 1 | V14 | contratista |
| Logística y construcción | 1 | V11 + V14 | contratista |
| Servicios a trabajadores y familias | 1 | V13 | proveedor |
| Repuestos / talleres / lubricentros | 1 | V10 | proveedor |
| Gomerías / neumáticos | 1 | V04 | proveedor |
| Farmacias / salud | 1 | V03 | proveedor |
| Logística / almacenamiento / última milla | 1 | V11 | proveedor |
| Salud ocupacional / servicios a empresas | 1 | V03 (V15 si es HSE) | proveedor |
| Tecnología / conectividad / seguridad | 1 | V16 | proveedor |
| Software / productividad / gestión | 1 | V16 | proveedor |
| Abastecimiento industrial / MRO | 1 | V02 | proveedor |
| Talento / recursos humanos | 1 | V15 (servicio a empresas) | proveedor |
| Movilidad / flotas | 1 | V11 | proveedor |
| Almacenamiento / productividad industrial | 1 | V11 | proveedor |
| Salud ocupacional / medicina laboral | 1 | V03 | proveedor |
| Movilidad / transporte de personal | 1 | V11 | proveedor |
| Desarrollo inmobiliario / alojamiento | 1 | V17 + V09 | desarrollador |
| Alojamiento / desarrollo inmobiliario | 1 | V09 + V17 | operador de activo / desarrollador |
| Inmobiliaria / operador de activos | 1 | V17 | broker / operador de activo |
| Inmobiliaria / desarrollo / housing | 1 | V17 | broker / desarrollador |
| Desarrollo inmobiliario / hotelería | 1 | V17 + V09 | desarrollador |
| Desarrollo inmobiliario / inversión | 1 | V17 | desarrollador / inversor |
| Construcción / housing corporativo | 1 | V09 + V14 | proveedor |
| Operador de housing corporativo | 1 | V09 | operador de activo |
| Inmobiliaria / housing | 1 | V17 | broker |
| Facility management / housing | 1 | V08 + V09 | proveedor |

### Verticales creadas antes en producción (desde texto libre) → código

| Vertical vieja | Pasa a |
|---|---|
| Gastronomía / Gastronomía / viandas | V01 |
| Alojamiento | V09 |
| Fitness | V13 |
| Servicios | revisar caso por caso (V08 / V15) |
| Comercios | V12 |
| Inmuebles y tierra / Fondos de comercio | V17 |
| Logística | V11 |
| Comprador corporativo | rol (no vertical) |
| Construcción modular / servicios industriales | V09 + V14 |

### Morning Brief

Usa la misma lista (V01–V17 + "Transversal"). Al fijar la taxonomía se reetiquetan las señales por código.

## Decisión que falta

1. ¿Aprobamos los 6 frentes del kickoff y V17 (provisoria → definitiva)?
2. ¿Rol múltiple por empresa como dimensión aparte? (propuesto: sí)
3. Con eso: RELEVO propone la vertical de las 102 empresas, se aprueban en bloque y se revisan las ambiguas (≈ 15, las que tienen dos códigos).
