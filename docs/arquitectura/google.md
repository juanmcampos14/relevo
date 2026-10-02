# Google como capa de contexto y acción

RELEVO no construye un Gmail, un Calendar, un Drive ni un Maps propios. Google es **fuente + contexto +
superficie de acción** de una misión, al servicio del ciclo:

> capturar → entender → conectar → recordar → decidir → actuar

## Principios

- **Por misión y con los permisos de la misión.** Lo que entra desde Google entra a una misión (la que
  corresponde) y lo ven sus miembros; nunca cruza a otra misión.
- **Autoría y origen.** Cada cosa conserva quién la trajo, de qué cuenta y el link al original (el mail, el
  evento, el archivo, el lugar). "Lo encontré acá" + un clic.
- **Contexto ≠ evidencia.** Un mail de un propietario confirmando un precio es evidencia; una invitación a
  una reunión es contexto; una planilla propia es contexto o evidencia según qué diga.
- **Nada se carga a mano dos veces.** Si ya existe en Google, RELEVO lo lee; no se copia y pega.

## Frentes

| Fuente | Qué aporta a la misión | Cómo se ve en RELEVO |
|---|---|---|
| **Gmail** | Respuestas de empresas, introducciones, cotizaciones, confirmaciones, lo que llegó después de una reunión. | Entra como captura (con el link al mail): RELEVO estructura personas, empresas, evidencia y seguimientos; "¿Respondió X?" se resuelve solo. |
| **Calendar** | Qué va a pasar y cuándo: reuniones, visitas, AOG, viajes, recorridos. | No es un calendario: alimenta Ahora ("Mañana es AOG: hay cuatro empresas que seguimos; priorizaría estas tres") y prepara cada reunión. Hoy: link prellenado; después, OAuth sobre el calendario de cada persona. |
| **Drive** | PDFs, planillas, presentaciones, propuestas, contratos, informes. | Otra fuente de memoria de la misión: documentos de contexto (plan, metodología) y evidencia con su archivo de origen. |
| **Maps** | Dónde está cada cosa y qué hay alrededor. | Hoy: todo lo que tiene ubicación o dirección se abre en Maps en un clic; Places ubica sin inventar precisión; "Cerca tuyo" y la investigación de calle usan el territorio. Después: clusters, huecos, recorridos y qué visitar juntos. |

## Orden propuesto (después del test con Fran)

1. **Gmail → captura** (lectura de los mails etiquetados o reenviados a la misión). Es lo que más carga manual saca.
2. **Calendar** con OAuth: leer eventos de la misión y preparar reuniones; escribir los que RELEVO agenda.
3. **Drive**: documentos de una carpeta por misión como contexto y evidencia.
4. **Maps** territorial: de los links a la lectura del territorio (clusters, huecos, recorridos).

Cada paso se mide con la misma pregunta: ¿RELEVO sabe más y yo cargo menos?
