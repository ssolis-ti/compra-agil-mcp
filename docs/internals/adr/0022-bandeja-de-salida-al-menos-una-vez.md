# 0022. Bandeja de salida persistente, entrega al menos una vez

- **Estado:** propuesta
- **Origen:** 2.9.0, fase 0 ([diseño §5](../specs/2.9.0-vigilancia-y-avisos/diseno.md#5-bandeja-de-salida))

**Contexto:** si se envía directo desde el ciclo, un Telegram caído o un reinicio a mitad del envío pierden la alerta: el ciclo ya la marcó como alertada. Entregar «exactamente una vez» a un sistema externo no se puede garantizar sin su cooperación.

**Decisión:** cada alerta crea un aviso por canal activo en una bandeja guardada en el estado, con un id estable (`sha256(canal:código:día)`). Un envío exitoso lo marca como entregado. Un error transitorio lo reintenta con espera creciente, honrando `retry_after`/`Retry-After`. Un error permanente o el octavo intento lo marcan como fallido y lo informan. Los repetidos posibles llevan el mismo id; el webhook lo entrega como `Idempotency-Key` para que el receptor los descarte.

**Consecuencias:** en un reinicio entre «enviado» y «guardado», un aviso puede llegar dos veces, nunca cero veces. Los avisos esperan a que termine el horario de silencio en vez de perderse. La bandeja vive en el mismo archivo que la vigilancia, para que alerta y aviso se guarden juntos, de forma atómica.
