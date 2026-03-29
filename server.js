const express = require('express');
const sqlite3 = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'tienda_secret_2026_cambiar_en_produccion';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DB_PATH = process.env.DATABASE_PATH || './tienda.db';
const db = new sqlite3(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    rol TEXT NOT NULL DEFAULT 'admin',
    activo INTEGER DEFAULT 1,
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS productos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo TEXT UNIQUE NOT NULL,
    nombre TEXT NOT NULL,
    categoria TEXT DEFAULT 'General',
    precio_compra REAL DEFAULT 0,
    precio_venta REAL NOT NULL,
    stock REAL DEFAULT 0,
    stock_minimo REAL DEFAULT 5,
    unidad TEXT DEFAULT 'pza',
    tipo_venta TEXT DEFAULT 'pieza',
    unidad_inventario TEXT,
    unidad_venta TEXT,
    activo INTEGER DEFAULT 1,
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
    actualizado_en DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS ventas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folio TEXT UNIQUE NOT NULL,
    usuario_id INTEGER,
    total REAL NOT NULL,
    descuento REAL DEFAULT 0,
    metodo_pago TEXT DEFAULT 'efectivo',
    notas TEXT,
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
  );

  CREATE TABLE IF NOT EXISTS venta_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venta_id INTEGER,
    producto_id INTEGER,
    cantidad REAL NOT NULL,
    cantidad_venta REAL,
    unidad_venta TEXT,
    es_granel INTEGER DEFAULT 0,
    precio_unitario REAL NOT NULL,
    subtotal REAL NOT NULL,
    FOREIGN KEY (venta_id) REFERENCES ventas(id),
    FOREIGN KEY (producto_id) REFERENCES productos(id)
  );

  CREATE TABLE IF NOT EXISTS movimientos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    producto_id INTEGER,
    tipo TEXT NOT NULL,
    cantidad REAL NOT NULL,
    stock_anterior REAL,
    stock_nuevo REAL,
    nota TEXT,
    usuario_id INTEGER,
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (producto_id) REFERENCES productos(id),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
  );

  CREATE TABLE IF NOT EXISTS cortes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER,
    fecha_inicio DATETIME,
    fecha_fin DATETIME DEFAULT CURRENT_TIMESTAMP,
    total_ventas REAL DEFAULT 0,
    num_ventas INTEGER DEFAULT 0,
    efectivo REAL DEFAULT 0,
    tarjeta REAL DEFAULT 0,
    transferencia REAL DEFAULT 0,
    notas TEXT,
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
  );

  CREATE TABLE IF NOT EXISTS deudas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    monto REAL DEFAULT 0,
    envases INTEGER DEFAULT 0,
    notas TEXT,
    usuario_id INTEGER,
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
  );
`);

// Migrar columnas granel si no existen (para bases de datos ya creadas)
try { db.exec(`ALTER TABLE productos ADD COLUMN tipo_venta TEXT DEFAULT 'pieza'`); } catch(e) {}
try { db.exec(`ALTER TABLE productos ADD COLUMN unidad_inventario TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE productos ADD COLUMN unidad_venta TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE venta_items ADD COLUMN cantidad_venta REAL`); } catch(e) {}
try { db.exec(`ALTER TABLE venta_items ADD COLUMN unidad_venta TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE venta_items ADD COLUMN es_granel INTEGER DEFAULT 0`); } catch(e) {}

// Crear dueño por defecto
const duenoExiste = db.prepare('SELECT id FROM usuarios WHERE rol = ?').get('dueno');
if (!duenoExiste) {
  const hash = bcrypt.hashSync('dueno123', 10);
  db.prepare('INSERT INTO usuarios (nombre, email, password, rol) VALUES (?, ?, ?, ?)').run('Dueño', 'dueno@tienda.com', hash, 'dueno');
  console.log('✅ Usuario dueño creado: dueno@tienda.com / dueno123');
}

// Crear usuario OS por defecto si no existe
const osExiste = db.prepare("SELECT id FROM usuarios WHERE rol = 'os'").get();
if (!osExiste) {
  const hashOS = bcrypt.hashSync('OS-iker-2026', 10);
  db.prepare('INSERT INTO usuarios (nombre, email, password, rol) VALUES (?, ?, ?, ?)').run('OS Admin', 'os@iker.com', hashOS, 'os');
  console.log('✅ Usuario OS creado: os@iker.com / OS-iker-2026');
}

const corpExiste = db.prepare('SELECT id FROM usuarios WHERE rol = ?').get('corporativo');
if (!corpExiste) {
  const hash = bcrypt.hashSync('corp2026', 10);
  db.prepare('INSERT INTO usuarios (nombre, email, password, rol) VALUES (?, ?, ?, ?)').run('Corporativo', 'corp@tienda.com', hash, 'corporativo');
  console.log('✅ Usuario corporativo creado: corp@tienda.com / corp2026');
}

// MIDDLEWARE
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Token inválido' }); }
}

function solodueno(req, res, next) {
  if (req.user.rol !== 'dueno' && req.user.rol !== 'os') return res.status(403).json({ error: 'Sin permisos suficientes' });
  next();
}

function soloOS(req, res, next) {
  if (req.user.rol !== 'os') return res.status(403).json({ error: 'Solo el rol OS puede hacer esto' });
  next();
}

// ===== AUTH =====
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM usuarios WHERE email = ? AND activo = 1').get(email);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  const token = jwt.sign({ id: user.id, nombre: user.nombre, rol: user.rol }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, user: { id: user.id, nombre: user.nombre, rol: user.rol, email: user.email } });
});

// ===== USUARIOS =====
app.get('/api/usuarios', authMiddleware, soloCorporativoODueno, (req, res) => {
  res.json(db.prepare('SELECT id, nombre, email, rol, activo, creado_en FROM usuarios').all());
});

app.post('/api/usuarios', authMiddleware, soloCorporativoODueno, (req, res) => {
  const { nombre, email, password, rol } = req.body;
  const hash = bcrypt.hashSync(password, 10);
  try {
    // Solo OS puede crear dueños
    const rolFinal = rol || 'admin';
    if (rolFinal === 'dueno' && req.user.rol !== 'os') return res.status(403).json({ error: 'Solo el rol OS puede crear dueños' });
    if (rolFinal === 'os' && req.user.rol !== 'os') return res.status(403).json({ error: 'No puedes crear rol OS' });
    const r = db.prepare('INSERT INTO usuarios (nombre, email, password, rol) VALUES (?, ?, ?, ?)').run(nombre, email, hash, rolFinal);
    res.json({ id: r.lastInsertRowid, mensaje: 'Usuario creado' });
  } catch { res.status(400).json({ error: 'Email ya existe' }); }
});

app.patch('/api/usuarios/:id/toggle', authMiddleware, soloCorporativoODueno, (req, res) => {
  const user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (user.rol === 'os') return res.status(400).json({ error: 'No puedes desactivar al rol OS' });
  if (user.rol === 'dueno' && req.user.rol !== 'os') return res.status(400).json({ error: 'Solo el rol OS puede gestionar dueños' });
  db.prepare('UPDATE usuarios SET activo = ? WHERE id = ?').run(user.activo ? 0 : 1, req.params.id);
  res.json({ mensaje: `Usuario ${user.activo ? 'desactivado' : 'activado'}` });
});

// ===== PRODUCTOS =====
app.get('/api/productos', authMiddleware, (req, res) => {
  const { buscar, categoria, bajo_stock } = req.query;
  let query = 'SELECT * FROM productos WHERE activo = 1';
  const params = [];
  if (buscar) { query += ' AND (nombre LIKE ? OR codigo LIKE ?)'; params.push(`%${buscar}%`, `%${buscar}%`); }
  if (categoria) { query += ' AND categoria = ?'; params.push(categoria); }
  if (bajo_stock === '1') query += ' AND stock <= stock_minimo';
  query += ' ORDER BY nombre ASC';
  res.json(db.prepare(query).all(...params));
});

app.get('/api/productos/codigo/:codigo', authMiddleware, (req, res) => {
  const prod = db.prepare('SELECT * FROM productos WHERE codigo = ? AND activo = 1').get(req.params.codigo);
  if (!prod) return res.status(404).json({ error: 'Producto no encontrado' });
  res.json(prod);
});

app.post('/api/productos', authMiddleware, (req, res) => {
  const { codigo, nombre, categoria, precio_compra, precio_venta, stock, stock_minimo, unidad, tipo_venta, unidad_inventario, unidad_venta } = req.body;
  try {
    const r = db.prepare(`INSERT INTO productos (codigo, nombre, categoria, precio_compra, precio_venta, stock, stock_minimo, unidad, tipo_venta, unidad_inventario, unidad_venta)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      codigo, nombre, categoria || 'General', precio_compra || 0, precio_venta,
      stock || 0, stock_minimo || 5, unidad || 'pza',
      tipo_venta || 'pieza', unidad_inventario || null, unidad_venta || null
    );
    res.json({ id: r.lastInsertRowid, mensaje: 'Producto creado' });
  } catch { res.status(400).json({ error: 'Código ya existe' }); }
});

app.put('/api/productos/:id', authMiddleware, (req, res) => {
  const { nombre, categoria, precio_compra, precio_venta, stock_minimo, unidad, tipo_venta, unidad_inventario, unidad_venta } = req.body;
  db.prepare(`UPDATE productos SET nombre=?, categoria=?, precio_compra=?, precio_venta=?, stock_minimo=?, unidad=?,
    tipo_venta=?, unidad_inventario=?, unidad_venta=?, actualizado_en=CURRENT_TIMESTAMP WHERE id=?`
  ).run(nombre, categoria, precio_compra, precio_venta, stock_minimo, unidad, tipo_venta || 'pieza', unidad_inventario || null, unidad_venta || null, req.params.id);
  res.json({ mensaje: 'Producto actualizado' });
});

app.patch('/api/productos/:id/stock', authMiddleware, (req, res) => {
  const { cantidad, tipo, nota } = req.body;
  const prod = db.prepare('SELECT * FROM productos WHERE id = ?').get(req.params.id);
  if (!prod) return res.status(404).json({ error: 'Producto no encontrado' });
  const nuevo_stock = tipo === 'entrada' ? prod.stock + cantidad : prod.stock - cantidad;
  if (nuevo_stock < 0) return res.status(400).json({ error: 'Stock insuficiente' });
  db.prepare('UPDATE productos SET stock = ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?').run(nuevo_stock, req.params.id);
  db.prepare('INSERT INTO movimientos (producto_id, tipo, cantidad, stock_anterior, stock_nuevo, nota, usuario_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(req.params.id, tipo, cantidad, prod.stock, nuevo_stock, nota || '', req.user.id);
  res.json({ mensaje: 'Stock actualizado', stock_nuevo: nuevo_stock });
});

app.delete('/api/productos/:id', authMiddleware, solodueno, (req, res) => {
  db.prepare('UPDATE productos SET activo = 0 WHERE id = ?').run(req.params.id);
  res.json({ mensaje: 'Producto eliminado' });
});

// ===== VENTAS (con soporte granel) =====
app.post('/api/ventas', authMiddleware, (req, res) => {
  const { items, metodo_pago, descuento, notas } = req.body;
  if (!items?.length) return res.status(400).json({ error: 'Sin productos' });
  const folio = 'V' + Date.now();
  let total = 0;

  const insertVenta = db.transaction(() => {
    // Validar stock
    for (const item of items) {
      const prod = db.prepare('SELECT * FROM productos WHERE id = ? AND activo = 1').get(item.producto_id);
      if (!prod) throw new Error(`Producto ${item.producto_id} no encontrado`);
      // cantidad siempre en unidades de inventario
      if (prod.stock < item.cantidad) throw new Error(`Stock insuficiente: ${prod.nombre}`);
    }

    // Calcular total
    for (const item of items) {
      const prod = db.prepare('SELECT * FROM productos WHERE id = ?').get(item.producto_id);
      if (item.es_granel) {
        // precio_venta está por unidad de inventario; cantidad es fracción de esa unidad
        total += prod.precio_venta * item.cantidad;
      } else {
        total += prod.precio_venta * item.cantidad;
      }
    }
    total -= (descuento || 0);

    const venta = db.prepare('INSERT INTO ventas (folio, usuario_id, total, descuento, metodo_pago, notas) VALUES (?, ?, ?, ?, ?, ?)').run(folio, req.user.id, total, descuento || 0, metodo_pago || 'efectivo', notas || '');

    for (const item of items) {
      const prod = db.prepare('SELECT * FROM productos WHERE id = ?').get(item.producto_id);
      const precio_unitario = item.es_granel
        ? prod.precio_venta * item.cantidad  // subtotal granel
        : prod.precio_venta;
      const subtotal = item.es_granel
        ? prod.precio_venta * item.cantidad
        : prod.precio_venta * item.cantidad;

      // precio_unitario en venta_items: para granel guardamos precio por unidad de venta
      let precio_unit_display = prod.precio_venta;
      if (item.es_granel && item.cantidad_venta && item.cantidad_venta > 0) {
        precio_unit_display = (prod.precio_venta * item.cantidad) / item.cantidad_venta;
      }

      db.prepare(`INSERT INTO venta_items (venta_id, producto_id, cantidad, cantidad_venta, unidad_venta, es_granel, precio_unitario, subtotal)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        venta.lastInsertRowid, item.producto_id,
        item.cantidad,                          // en unidades de inventario
        item.cantidad_venta || item.cantidad,   // en unidades de venta (para mostrar)
        item.unidad_venta || null,
        item.es_granel ? 1 : 0,
        precio_unit_display,
        subtotal
      );

      db.prepare('UPDATE productos SET stock = stock - ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?').run(item.cantidad, item.producto_id);
      db.prepare('INSERT INTO movimientos (producto_id, tipo, cantidad, stock_anterior, stock_nuevo, nota, usuario_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        item.producto_id, 'venta', item.cantidad, prod.stock, prod.stock - item.cantidad, `Venta ${folio}`, req.user.id
      );
    }
    return venta.lastInsertRowid;
  });

  try {
    const id = insertVenta();
    res.json({ id, folio, total, mensaje: 'Venta registrada' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/ventas', authMiddleware, (req, res) => {
  const { desde, hasta, usuario_id } = req.query;
  let query = `SELECT v.*, u.nombre as cajero FROM ventas v LEFT JOIN usuarios u ON v.usuario_id = u.id WHERE 1=1`;
  const params = [];
  if (desde) { query += ' AND datetime(v.creado_en) >= datetime(?)'; params.push(desde); }
  if (hasta) { query += ' AND datetime(v.creado_en) <= datetime(?)'; params.push(hasta); }
  if (usuario_id) { query += ' AND v.usuario_id = ?'; params.push(usuario_id); }
  query += ' ORDER BY v.creado_en DESC LIMIT 200';
  res.json(db.prepare(query).all(...params));
});

app.get('/api/ventas/:id', authMiddleware, (req, res) => {
  const venta = db.prepare('SELECT v.*, u.nombre as cajero FROM ventas v LEFT JOIN usuarios u ON v.usuario_id = u.id WHERE v.id = ?').get(req.params.id);
  if (!venta) return res.status(404).json({ error: 'Venta no encontrada' });
  const items = db.prepare('SELECT vi.*, p.nombre, p.codigo FROM venta_items vi LEFT JOIN productos p ON vi.producto_id = p.id WHERE vi.venta_id = ?').all(req.params.id);
  res.json({ ...venta, items });
});

// ===== CORTE =====
app.post('/api/cortes', authMiddleware, (req, res) => {
  const { fecha_inicio, notas } = req.body;
  const desde = fecha_inicio || new Date().toISOString().split('T')[0] + 'T00:00:00.000Z';
  const ventas = db.prepare('SELECT * FROM ventas WHERE datetime(creado_en) >= datetime(?) AND datetime(creado_en) <= datetime(CURRENT_TIMESTAMP)').all(desde);
  const total = ventas.reduce((s, v) => s + v.total, 0);
  const efectivo = ventas.filter(v => v.metodo_pago === 'efectivo').reduce((s, v) => s + v.total, 0);
  const tarjeta = ventas.filter(v => v.metodo_pago === 'tarjeta').reduce((s, v) => s + v.total, 0);
  const transferencia = ventas.filter(v => v.metodo_pago === 'transferencia').reduce((s, v) => s + v.total, 0);
  const r = db.prepare('INSERT INTO cortes (usuario_id, fecha_inicio, total_ventas, num_ventas, efectivo, tarjeta, transferencia, notas) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(req.user.id, desde, total, ventas.length, efectivo, tarjeta, transferencia, notas || '');
  res.json({ id: r.lastInsertRowid, total_ventas: total, num_ventas: ventas.length, efectivo, tarjeta, transferencia });
});

app.get('/api/cortes', authMiddleware, (req, res) => {
  res.json(db.prepare('SELECT c.*, u.nombre as cajero FROM cortes c LEFT JOIN usuarios u ON c.usuario_id = u.id ORDER BY c.creado_en DESC LIMIT 50').all());
});

// ===== DASHBOARD =====
app.get('/api/dashboard', authMiddleware, (req, res) => {
  const now = new Date(); const hoy = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().split('T')[0];
  const ventas_hoy = db.prepare(`SELECT COUNT(*) as num, COALESCE(SUM(total),0) as total FROM ventas WHERE date(creado_en, 'localtime') = ?`).get(hoy);
  const productos_total = db.prepare('SELECT COUNT(*) as num FROM productos WHERE activo = 1').get();
  const bajo_stock = db.prepare('SELECT COUNT(*) as num FROM productos WHERE activo = 1 AND stock <= stock_minimo').get();
  const ultimas_ventas = db.prepare('SELECT v.folio, v.total, v.metodo_pago, v.creado_en, u.nombre as cajero FROM ventas v LEFT JOIN usuarios u ON v.usuario_id = u.id ORDER BY v.creado_en DESC LIMIT 5').all();
  const alertas = db.prepare('SELECT nombre, codigo, stock, stock_minimo FROM productos WHERE activo = 1 AND stock <= stock_minimo ORDER BY stock ASC LIMIT 10').all();
  const actividad_cajeros = db.prepare(`
    SELECT u.id, u.nombre, u.activo,
      COUNT(v.id) as num_ventas,
      COALESCE(SUM(v.total), 0) as total_vendido,
      MAX(v.creado_en) as ultima_venta
    FROM usuarios u
    LEFT JOIN ventas v ON v.usuario_id = u.id AND date(v.creado_en, 'localtime') = ?
    WHERE u.rol != 'dueno'
    GROUP BY u.id ORDER BY total_vendido DESC
  `).all(hoy);
  const alertas_actividad = [];
  const fuera = db.prepare(`SELECT COUNT(*) as num FROM ventas WHERE date(creado_en, 'localtime') = ? AND (CAST(strftime('%H', creado_en, 'localtime') AS INTEGER) < 7 OR CAST(strftime('%H', creado_en, 'localtime') AS INTEGER) >= 22)`).get(hoy);
  if (fuera.num > 0) alertas_actividad.push({ tipo: 'warning', mensaje: `${fuera.num} venta(s) fuera de horario normal` });
  const desc = db.prepare(`SELECT u.nombre, COUNT(v.id) as num_descuentos FROM ventas v LEFT JOIN usuarios u ON v.usuario_id = u.id WHERE date(v.creado_en, 'localtime') = ? AND v.descuento > 0 GROUP BY v.usuario_id HAVING num_descuentos >= 3`).all(hoy);
  desc.forEach(d => alertas_actividad.push({ tipo: 'danger', mensaje: `${d.nombre} aplicó descuentos en ${d.num_descuentos} ventas hoy` }));
  // deudas pendientes para el dashboard
  const deudas_count = db.prepare('SELECT COUNT(*) as num FROM deudas').get();
  res.json({ ventas_hoy, productos_total, bajo_stock, ultimas_ventas, alertas, actividad_cajeros, alertas_actividad, deudas_pendientes: deudas_count.num });
});

// ===== MONITOREO =====
app.get('/api/cajeros/actividad', authMiddleware, solodueno, (req, res) => {
  const dia = req.query.fecha || new Date().toISOString().split('T')[0];
  const actividad = db.prepare(`
    SELECT u.id, u.nombre, u.email, u.rol, u.activo,
      COUNT(v.id) as num_ventas,
      COALESCE(SUM(v.total), 0) as total_vendido,
      COALESCE(SUM(CASE WHEN v.metodo_pago = 'efectivo' THEN v.total ELSE 0 END), 0) as efectivo,
      COALESCE(SUM(CASE WHEN v.metodo_pago = 'tarjeta' THEN v.total ELSE 0 END), 0) as tarjeta,
      COALESCE(SUM(CASE WHEN v.metodo_pago = 'transferencia' THEN v.total ELSE 0 END), 0) as transferencia,
      COALESCE(SUM(v.descuento), 0) as total_descuentos,
      MAX(v.creado_en) as ultima_venta
    FROM usuarios u
    LEFT JOIN ventas v ON v.usuario_id = u.id AND date(v.creado_en, 'localtime') = ?
    WHERE u.rol != 'dueno'
    GROUP BY u.id ORDER BY total_vendido DESC
  `).all(dia);
  res.json({ fecha: dia, cajeros: actividad });
});


// ===== ENDPOINTS EXCLUSIVOS OS =====
app.get('/api/os/usuarios', authMiddleware, soloOS, (req, res) => {
  res.json(db.prepare('SELECT id, nombre, email, rol, activo, creado_en FROM usuarios ORDER BY rol, nombre').all());
});

app.post('/api/os/usuarios', authMiddleware, soloOS, (req, res) => {
  const { nombre, email, password, rol } = req.body;
  const hash = bcrypt.hashSync(password, 10);
  try {
    const r = db.prepare('INSERT INTO usuarios (nombre, email, password, rol) VALUES (?, ?, ?, ?)').run(nombre, email, hash, rol || 'dueno');
    res.json({ id: r.lastInsertRowid, mensaje: 'Usuario creado' });
  } catch { res.status(400).json({ error: 'Email ya existe' }); }
});

// ===== DEUDAS =====
app.get('/api/deudas', authMiddleware, (req, res) => {
  const deudas = db.prepare('SELECT d.*, u.nombre as registrado_por FROM deudas d LEFT JOIN usuarios u ON d.usuario_id = u.id ORDER BY d.creado_en DESC').all();
  res.json(deudas);
});

app.post('/api/deudas', authMiddleware, (req, res) => {
  const { nombre, monto, envases, notas } = req.body;
  if (!nombre) return res.status(400).json({ error: 'El nombre es requerido' });
  const r = db.prepare('INSERT INTO deudas (nombre, monto, envases, notas, usuario_id) VALUES (?, ?, ?, ?, ?)').run(nombre, monto || 0, envases || 0, notas || '', req.user.id);
  res.json({ id: r.lastInsertRowid, mensaje: 'Deuda registrada' });
});

app.put('/api/deudas/:id', authMiddleware, (req, res) => {
  const { nombre, monto, envases, notas } = req.body;
  const deuda = db.prepare('SELECT * FROM deudas WHERE id = ?').get(req.params.id);
  if (!deuda) return res.status(404).json({ error: 'Deuda no encontrada' });
  db.prepare('UPDATE deudas SET nombre=?, monto=?, envases=?, notas=? WHERE id=?').run(nombre, monto || 0, envases || 0, notas || '', req.params.id);
  res.json({ mensaje: 'Deuda actualizada' });
});

app.delete('/api/deudas/:id', authMiddleware, (req, res) => {
  const deuda = db.prepare('SELECT * FROM deudas WHERE id = ?').get(req.params.id);
  if (!deuda) return res.status(404).json({ error: 'Deuda no encontrada' });
  db.prepare('DELETE FROM deudas WHERE id = ?').run(req.params.id);
  res.json({ mensaje: 'Deuda eliminada' });
});

// ===== EXPORTAR =====
app.get('/api/exportar/ventas', authMiddleware, solodueno, (req, res) => {
  const { desde, hasta } = req.query;
  let query = `SELECT v.folio, v.creado_en as fecha, u.nombre as cajero, v.metodo_pago, v.descuento, v.total, v.notas FROM ventas v LEFT JOIN usuarios u ON v.usuario_id = u.id WHERE 1=1`;
  const params = [];
  if (desde) { query += ' AND v.creado_en >= ?'; params.push(desde); }
  if (hasta) { query += ' AND v.creado_en <= ?'; params.push(hasta); }
  query += ' ORDER BY v.creado_en DESC';
  const ventas = db.prepare(query).all(...params);
  let csv = 'Folio,Fecha,Cajero,Método de Pago,Descuento,Total,Notas\n';
  ventas.forEach(v => { csv += `"${v.folio}","${v.fecha}","${v.cajero||''}","${v.metodo_pago}","${v.descuento}","${v.total}","${v.notas||''}"\n`; });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="ventas_${new Date().toISOString().split('T')[0]}.csv"`);
  res.send('\uFEFF' + csv);
});

app.get('/api/exportar/detalle-ventas', authMiddleware, solodueno, (req, res) => {
  const { desde, hasta } = req.query;
  let query = `SELECT v.folio, v.creado_en as fecha, u.nombre as cajero, p.codigo, p.nombre as producto, vi.cantidad, vi.cantidad_venta, vi.unidad_venta, vi.es_granel, vi.precio_unitario, vi.subtotal
    FROM venta_items vi LEFT JOIN ventas v ON vi.venta_id = v.id LEFT JOIN productos p ON vi.producto_id = p.id LEFT JOIN usuarios u ON v.usuario_id = u.id WHERE 1=1`;
  const params = [];
  if (desde) { query += ' AND v.creado_en >= ?'; params.push(desde); }
  if (hasta) { query += ' AND v.creado_en <= ?'; params.push(hasta); }
  query += ' ORDER BY v.creado_en DESC';
  const items = db.prepare(query).all(...params);
  let csv = 'Folio,Fecha,Cajero,Código,Producto,Cantidad (inv),Cantidad (venta),Unidad Venta,Precio Unitario,Subtotal\n';
  items.forEach(i => { csv += `"${i.folio}","${i.fecha}","${i.cajero||''}","${i.codigo||''}","${i.producto||''}","${i.cantidad}","${i.cantidad_venta||i.cantidad}","${i.unidad_venta||''}","${i.precio_unitario}","${i.subtotal}"\n`; });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="detalle_ventas_${new Date().toISOString().split('T')[0]}.csv"`);
  res.send('\uFEFF' + csv);
});

app.get('/api/exportar/inventario', authMiddleware, solodueno, (req, res) => {
  const productos = db.prepare('SELECT codigo, nombre, categoria, precio_compra, precio_venta, stock, stock_minimo, unidad, tipo_venta, unidad_inventario, unidad_venta FROM productos WHERE activo = 1 ORDER BY nombre').all();
  let csv = 'Código,Nombre,Categoría,Precio Compra,Precio Venta,Stock Actual,Stock Mínimo,Unidad,Tipo Venta,Unidad Inventario,Unidad Venta\n';
  productos.forEach(p => { csv += `"${p.codigo}","${p.nombre}","${p.categoria}","${p.precio_compra}","${p.precio_venta}","${p.stock}","${p.stock_minimo}","${p.unidad}","${p.tipo_venta||'pieza'}","${p.unidad_inventario||''}","${p.unidad_venta||''}"\n`; });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="inventario_${new Date().toISOString().split('T')[0]}.csv"`);
  res.send('\uFEFF' + csv);
});

app.get('/api/exportar/cortes', authMiddleware, solodueno, (req, res) => {
  const cortes = db.prepare(`SELECT c.creado_en as fecha, u.nombre as cajero, c.num_ventas, c.efectivo, c.tarjeta, c.transferencia, c.total_ventas, c.notas FROM cortes c LEFT JOIN usuarios u ON c.usuario_id = u.id ORDER BY c.creado_en DESC`).all();
  let csv = 'Fecha,Cajero,Num Ventas,Efectivo,Tarjeta,Transferencia,Total,Notas\n';
  cortes.forEach(c => { csv += `"${c.fecha}","${c.cajero||''}","${c.num_ventas}","${c.efectivo}","${c.tarjeta}","${c.transferencia}","${c.total_ventas}","${c.notas||''}"\n`; });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="cortes_${new Date().toISOString().split('T')[0]}.csv"`);
  res.send('\uFEFF' + csv);
});

// ===== BACKUP =====
app.get('/api/backup', authMiddleware, solodueno, (req, res) => {
  try {
    if (!fs.existsSync(DB_PATH)) return res.status(404).json({ error: 'Base de datos no encontrada' });
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="tienda_backup_${new Date().toISOString().split('T')[0]}.db"`);
    res.send(fs.readFileSync(DB_PATH));
  } catch(e) { res.status(500).json({ error: 'Error al generar backup: ' + e.message }); }
});

// Servir index.html para cualquier ruta no API
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => console.log(`✅ Servidor corriendo en puerto ${PORT}`));
