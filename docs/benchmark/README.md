# Benchmark Morning Brief: RELEVO vs ChatGPT

Comparación diaria y temporal mientras ChatGPT siga generando su Morning Brief en paralelo (decisión de Tano, 01/10/2026).
Sin intake automático: Juan pega el brief de ChatGPT y se guarda acá por fecha. Recién se construye un intake si después
de una o dos semanas el paso manual molesta y el benchmark sigue haciendo falta.

- `chatgpt/AAAA-MM-DD.md`: el brief de ChatGPT tal como llegó.
- `comparaciones/AAAA-MM-DD.md`: la comparación del día contra el brief de RELEVO de la misma fecha.

**RELEVO no lee esta carpeta.** El brief de ChatGPT no se carga como documento de contexto ni como fuente: si RELEVO lo
viera, la comparación dejaría de medir su propia cobertura.

## Qué se mide cada día

Conteo, con el detalle de cada caso:

| Dimensión | Qué cuenta |
| --- | --- |
| Encontrado por ambos | mismo hecho en los dos briefs |
| Solo RELEVO / solo ChatGPT | hechos que trae uno y el otro no |
| Duplicados | el mismo hecho dos veces dentro del mismo brief |
| Falsos NUEVO | presentado como nuevo cuando ya se conocía (fuente nueva ≠ señal nueva) |
| Actualizaciones bien detectadas | cambio material marcado como ACTUALIZADO, repetición marcada como CONFIRMADO |
| Activos, empresas, contactos, señales, historias, candidatos | cuántos y cuáles en cada brief |
| Acciones sugeridas | concretas y con responsable o próximo paso |
| Información realmente útil | lo que cambia una decisión o una próxima acción |

### Qué hizo RELEVO con lo que encontró

Encontrar la noticia no alcanza. Para cada hecho de RELEVO se marca hasta dónde llegó:

**encontró → entendió → relacionó → persistió → propuso acción**

- **entendió**: hecho vs. declaración vs. inferencia, tipo de señal y vertical correctos.
- **relacionó**: lo vinculó con empresas, activos, hipótesis o historias que RELEVO ya conocía.
- **persistió**: quedó en RELEVO (señal, historia, precio de activo, candidato) con su fuente.
- **propuso acción**: siguiente paso concreto (a quién hablar, qué verificar, qué preguntar).

## Criterio para apagar ChatGPT

No alcanza con que RELEVO encuentre más noticias. Se apaga el proceso paralelo cuando, durante varios días consecutivos, RELEVO:

- tiene cobertura externa comparable o superior;
- detecta bien los cambios y no genera falsos NUEVO;
- encuentra activos y mantiene su historial;
- relaciona con el conocimiento previo, persiste correctamente y no pierde evidencia;
- propone mejores próximas acciones;
- y su brief final es igual o más útil para decidir.

Ahí RELEVO pasa a ser el sistema único.
