# Tests — La Guantera

TDD rojo -> verde con Vitest (mismo patron que el resto de proyectos del reto).

Estructura en espejo con `src/`: cada modulo tiene su carpeta de tests correspondiente.
Estas carpetas empiezan vacias a proposito — el modo plan y la implementacion posterior
son quienes las llenan seccion por seccion, escribiendo primero la prueba que falla.

Correr:
- `npm test` -> corre toda la suite una vez
- `npm run test:watch` -> modo watch para desarrollo
