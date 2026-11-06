# Estilo del CRM

Cómo se ve, se lee y se mueve la app. Complementa a `docs/MAPA.md` (dónde va cada cosa).

## Movimiento

El movimiento está para **responder a lo que hace la persona**, no para decorar. La app tiene que
sentirse rápida aunque la pantalla nueva tarde medio segundo en llegar.

### Reglas

1. **Respuesta inmediata a cada toque.** Nada queda «muerto» después de tocar: el ítem del menú o la
   pestaña se marca al instante, aparece la barrita de arriba y, donde la pantalla tarda, el esqueleto.
2. **Corto y que frena al final.** Entre 120 y 200 ms, curva `var(--ease-out)`. Sin rebotes ni resortes.
3. **Solo opacidad y posición** (`opacity`, `transform`). Nunca animar alto, ancho, márgenes ni sombras:
   traban el celular.
4. **Nada se mueve solo.** Sin animaciones al entrar a una pantalla ni efectos de hover en cada tarjeta.
   Lo único que se anima sin que la persona toque algo es la confirmación de que algo se guardó.
5. **«Reducir movimiento» se respeta siempre**: con esa opción del teléfono no se anima nada (está resuelto
   en `globals.css`; no hace falta repetirlo en cada componente).

### Piezas que ya existen (usar estas, no inventar otras)

| Situación | Qué usar | Dónde |
|---|---|---|
| Tocar un ítem del menú o una pestaña | Se marca al instante + barrita de arriba (`LinkPending`, `useTappedHref`) | `nav-links.tsx`, `section-tabs.tsx` |
| La pantalla nueva tarda | Esqueleto (`loading.tsx`) | `src/app/(app)/loading.tsx` |
| Apretar un botón | Se achica a 0,97 (`.btn:active`) | `globals.css` |
| Botón que guarda algo | `SubmitButton`: «Guardando...» con ruedita, no se toca dos veces; `doneText` muestra «✓ ...» si la acción no devuelve error a la pantalla | `components/submit-button.tsx` |
| Se guardó y se volvió a otra pantalla | La acción redirige con `?listo=<código>` y aparece «✓ Turno guardado» abajo (`DoneToast`) | `components/done-toast.tsx` |
| Deshacer algo recién hecho | Aviso abajo con «Deshacer», 10 segundos | `leads/undo.tsx` |
| Cambio de pantalla | El contenido aparece con un fundido de 150 ms (`.page-in`) | `src/app/(app)/template.tsx` |
| Cambiar de pestaña | La marca de la activa se desliza (`.tab-slider`, solo `transform`) | `section-tabs.tsx` |
| Abrir un plegable (`<details>`) | Lo de adentro entra deslizando y la flecha gira; cualquier `<details>` lo hace solo | `globals.css` |
| Una fila con una acción en curso | Se atenúa sola (`li:has([aria-busy])`) mientras guarda | `globals.css` |
| Algo recién llegado a un bloque | Destello suave del color de la marca, 1,2 s (`.flash`) | leads (recién escrito), agenda (`?ultimo=<turno>`) |

Todo botón de un formulario que llama a una acción del servidor usa `SubmitButton` (con un `pendingText`
que diga lo que está pasando: «Guardando...», «Descartando...»). Un `<button>` suelto en un formulario
es un error.

Para que una fila se atenúe mientras guarda, su botón tiene que marcar `aria-busy` (lo hace `SubmitButton`).

## Textos

- Español rioplatense, en segunda persona («Tocá», «Elegí»). Botones con verbo: «Guardar», «Darle turno».
- La misma acción se llama igual en todo el recorrido: el botón «Descartar» → «Descartando...».
- Los errores dicen qué pasó y qué hacer, sin pedir perdón. Un estado vacío invita a hacer algo.
