# 0008. Percentil 25, no "5 % bajo el promedio"

- **Estado:** aceptada
- **Origen:** `docs/internals/decisiones.md` (julio 2026), borrado en `6be7402` y recuperado tal cual en la 2.8.0.

**Decisión:** el precio sugerido es el p25 de la distribución cotizada.

**Por qué:** el promedio se descalabra con un solo valor atípico, y las muestras
reales los tienen (se observó un rango de $4.800 a $5.000.000 en una misma
búsqueda). El p25 ubica la oferta en el cuarto más económico sin regalar margen y
resiste los extremos.

Complementado con un **control de dispersión**: si el máximo supera 10× la mediana,
la tool advierte que el término mezcla productos distintos en vez de entregar un
número con falsa precisión.
