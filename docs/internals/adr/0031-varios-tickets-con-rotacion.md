# 0031. Varios tickets con rotación

- **Estado:** aceptada (16-oct-2026), a pedido del dueño
- **Origen:** 2.10.0, MEJORA-006 de Hermes (T1–T6)

**Contexto:** con un solo ticket, un 429 o una revocación detienen la instalación, y la vigilancia termina avisando «no puede revisar». El dueño eligió la rotación completa, no solo un ticket de respaldo.

**Decisión:** `COMPRA_AGIL_TICKETS` acepta una lista, y `COMPRA_AGIL_TICKET` sigue valiendo como el primero.
- **Reparto:** las consultas se reparten por turno entre los tickets activos.
- **429:** un ticket con 429 se salta hasta que pase su espera.
- **401/403:** se marca rechazado por la sesión y se avisa.
- **Cuota:** se lleva por ticket, con la clave guardada como hash.
- **Concurrencia:** el limitador sigue siendo uno solo y compartido.
- **Velocidad:** el freno de 15 consultas por minuto es uno solo para todos los tickets. Varios tickets dan redundancia, no más velocidad (decidido el 16-oct, al cerrar la fase 3: una primera versión daba un freno a cada ticket y duplicaba la velocidad con dos).

**Advertencia, que va en la documentación:** el ticket se pide con Clave Única y es personal. Repartir la carga entre tickets de distintas personas para multiplicar la cuota puede ir contra los términos de uso de ChileCompra, y conviene confirmarlo con ellos. La redundancia (sobrevivir a un ticket revocado) y el uso de tickets de la propia organización no tienen ese problema.

**Consecuencias:** con un ticket, todo sigue igual. Con varios, un 429 deja de detener la vigilancia.
