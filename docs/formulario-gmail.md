# Activar el formulario con Gmail

Los dos formularios envían por POST a `/api/cotizacion`. La función de Vercel
usa SMTP cifrado de Gmail para enviar a **fyftraducciones@gmail.com** desde esa
misma cuenta. `Reply-To` contiene el correo validado del cliente. El destinatario
y el asunto se fijan en el servidor; el navegador no puede cambiarlos.

## Configuración necesaria antes de llevar el PR a producción

1. Entrar a la cuenta **fyftraducciones@gmail.com** y activar la verificación
   en dos pasos si todavía no está activa.
2. Crear una [contraseña de aplicación de Google](https://support.google.com/accounts/answer/185833?hl=es)
   para este sitio. Usar esa contraseña, no la contraseña habitual de Gmail.
   La opción puede no estar disponible según la política o configuración de la cuenta.
3. En el proyecto `fftraducciones` de Vercel, abrir **Settings → Environment Variables**
   y agregar `GMAIL_APP_PASSWORD` con la contraseña de aplicación. Guardarla como
   variable sensible, sin prefijos públicos. Incluir **Production** y, para probar
   la rama antes del merge, **Preview**.
4. Volver a desplegar el preview después de guardar la variable; los despliegues
   anteriores no reciben variables nuevas automáticamente.
5. Probar una solicitud controlada en el preview y comprobar la recepción en Gmail
   (incluida la carpeta de spam). Después de esa comprobación se puede revisar y
   mergear el PR manualmente. Este cambio no hace merge ni modifica producción.

No pegar la contraseña en chats, commits, HTML o `script.js`. `.env.example`
documenta solo el nombre de la variable; los archivos `.env` reales están ignorados.
Para pruebas locales se puede exportar la variable y usar `vercel dev`;
un servidor de archivos estáticos no ejecuta la API.

## Comportamiento y límites

- Sin `GMAIL_APP_PASSWORD`, la API responde 503 y el formulario muestra el mensaje
  de error ES/EN con el correo como alternativa; **no simula un envío exitoso**.
- Se conservan validación, honeypot, `_subject`, mensajes, loading y atributos de
  conversión. El asunto enviado es fijo, aunque se manipule `_subject`.
- La API valida nombre, correo, servicio y mensaje, limita tamaños y admite
  solamente POST con JSON o campos URL-encoded desde los dominios del sitio,
  el preview actual de Vercel o localhost en desarrollo.
- El honeypot evita el correo y devuelve una respuesta neutra. Hay un límite de
  cinco intentos por minuto/IP **por instancia activa**, no un límite distribuido
  garantizado. Origin y honeypot no reemplazan una protección anti-bots completa.
- El mensaje es texto plano. Los archivos y adjuntos no están admitidos.
- Un 200 significa que Gmail SMTP aceptó el mensaje, no una garantía de entrega
  en la bandeja principal. Gmail puede imponer límites o rechazar autenticación;
  esos fallos se muestran como error y mantienen los datos para reintentar.
- No se envían correos de confirmación al visitante ni se usa Formspree.

## Validación sin correos reales

```sh
npm ci --ignore-scripts
npm test
node --check script.js
node --check api/cotizacion.js
node --check lib/cotizacion.js
git diff --check
```

Las pruebas de servidor inyectan un transporte simulado y nunca contactan Gmail.
La prueba real de entrega requiere la credencial privada y la configuración de Vercel.
