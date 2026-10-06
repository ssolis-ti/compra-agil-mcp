# 0010. El Oficio chileno se declara con dimensiones explícitas

- **Estado:** aceptada
- **Origen:** `docs/internals/decisiones.md` (julio 2026), borrado en `6be7402` y recuperado tal cual en la 2.8.0.

**Decisión:** `@page { size: 216mm 330mm }` en vez de `size: legal`.

**Por qué:** el `legal` de CSS es el **US Legal: 216 × 356 mm**. El oficio/folio
chileno mide **216 × 330 mm**. Usar `legal` estiraría la hoja 26 mm y descuadraría
la caja de texto en cada impresión.

Hay un test de regresión explícito:
```ts
expect(PAPEL.oficio.size).not.toBe('legal');
```
