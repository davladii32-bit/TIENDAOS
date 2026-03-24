# TiendaOS — Guía de Despliegue

## ¿Qué incluye el sistema?

- ✅ Login con roles (Dueño / Administrador / Cajero)
- ✅ Punto de venta con escaneo de código de barras (cámara o lector USB)
- ✅ Inventario completo con alertas de stock bajo
- ✅ Historial de ventas con detalle por transacción
- ✅ Corte de caja (efectivo, tarjeta, transferencia)
- ✅ Panel de usuarios (solo dueño puede activar/desactivar accesos)
- ✅ Dashboard con resumen del día
- ✅ Base de datos SQLite (cero costo, sin servidor externo)

---

## OPCIÓN 1: Railway (Recomendada — Gratis)

### Paso 1: Crear cuenta
1. Ve a https://railway.app
2. Regístrate con tu cuenta de GitHub (gratis)

### Paso 2: Subir el código a GitHub
1. Crea cuenta en https://github.com (si no tienes)
2. Crea un repositorio nuevo llamado "tiendaos"
3. Sube los archivos: server.js, package.json, y la carpeta public/

### Paso 3: Desplegar en Railway
1. En Railway → "New Project" → "Deploy from GitHub repo"
2. Selecciona tu repositorio "tiendaos"
3. Railway detecta automáticamente que es Node.js
4. Agrega estas variables de entorno en Railway:
   - JWT_SECRET = (una cadena larga y secreta, ej: MiTiendaSecreta2026XYZ)
   - NODE_ENV = production

### Paso 4: Base de datos persistente
En Railway → Add Plugin → Volume
- Mount path: /app
- Esto guarda tu base de datos aunque el servidor se reinicie

### Paso 5: Acceder
Railway te dará una URL como: https://tiendaos-production.up.railway.app
Esa URL funciona desde cualquier dispositivo con internet.

---

## OPCIÓN 2: Render (También gratis)

1. Ve a https://render.com
2. New → Web Service → conecta tu GitHub
3. Build Command: npm install
4. Start Command: node server.js
5. Agrega variable de entorno: JWT_SECRET

---

## OPCIÓN 3: VPS (Más control, ~$5/mes)

Si quieres más control, puedes usar DigitalOcean, Hostinger VPS, o cualquier servidor Linux.

```bash
# En el servidor
sudo apt update && sudo apt install nodejs npm -y
git clone tu-repositorio
cd tiendaos
npm install
JWT_SECRET=tusecreto node server.js

# Para que corra siempre (con PM2)
npm install -g pm2
pm2 start server.js --name tiendaos
pm2 startup
pm2 save
```

---

## CREDENCIALES POR DEFECTO

Al iniciar por primera vez se crea automáticamente:
- Email: dueno@tienda.com
- Contraseña: dueno123

**⚠️ IMPORTANTE: Cambia la contraseña del dueño inmediatamente después de entrar por primera vez.**

Para cambiar la contraseña, por ahora puedes hacerlo directamente en la base de datos o agregar un endpoint de cambio de contraseña (te lo puedo crear).

---

## CÓMO USAR EL SCANNER

### Opción A: Lector de código de barras USB
- Conecta el lector a la computadora
- Haz clic en el campo "Escanear código..."
- El lector funciona como teclado, escribe el código y presiona Enter automáticamente

### Opción B: Cámara del dispositivo
- Haz clic en el botón "📷 Cámara"
- Apunta la cámara al código de barras
- El sistema lo detecta automáticamente

---

## FLUJO DE TRABAJO DIARIO

1. **Apertura**: Cajero entra al sistema → Punto de Venta listo
2. **Venta**: Escanea productos → Selecciona método de pago → Cobrar
3. **Inventario**: Cuando llega mercancía → Inventario → Ajustar Stock → Entrada
4. **Cierre**: Corte de Caja → Selecciona hora de inicio → Genera corte
5. **Control remoto**: Dueño entra desde su celular a la misma URL → Ve dashboard y puede desactivar usuarios

---

## PERSONALIZACIÓN PENDIENTE (próximas versiones)

- [ ] Cambio de contraseña desde la app
- [ ] Impresión de tickets
- [ ] Reportes por semana/mes
- [ ] Exportar ventas a Excel
- [ ] Múltiples sucursales
- [ ] Backup automático de base de datos

Cualquiera de estas funciones te las puedo agregar cuando la necesites.
