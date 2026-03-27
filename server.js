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

// DATABASE SETUP
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
    stock INTEGER DEFAULT 0,
    stock_minimo INTEGER DEFAULT 5,
    unidad TEXT DEFAULT 'pza',
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
    cantidad INTEGER NOT NULL,
    precio_unitario REAL NOT NULL,
    subtotal REAL NOT NULL,
    FOREIGN KEY (venta_id) REFERENCES ventas(id),
    FOREIGN KEY (producto_id) REFERENCES productos(id)
  );

  CREATE TABLE IF NOT EXISTS movimientos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    producto_id INTEGER,
    tipo TEXT NOT NULL,
    cantidad INTEGER NOT NULL,
    stock_anterior INTEGER,
    stock_nuevo INTEGER,
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
`);

// Crear dueño por defecto si no existe
const duenoExiste = db.prepare('SELECT id FROM usuarios WHERE rol = ?').get('dueno');
if (!duenoExiste) {
  const hash = bcrypt.hashSync('dueno123', 10);
  db.prepare('INSERT INTO usuarios (nombre, email, password, rol) VALUES (?, ?, ?, ?)').run('Dueño', 'dueno@tienda.com', hash, 'dueno');
  console.log('✅ Usuario dueño creado: dueno@tienda.com / dueno123');
}

// MIDDLEWARE AUTH
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
}

function solodueno(req, res, next) {
  if (req.user.rol !== 'dueno') return res.status(403).json({ error: 'Solo el dueño puede hacer esto' });
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
app.get('/api/usuarios', authMiddleware, solodueno, (req, res) => {
  const users = db.prepare('SELECT id, nombre, email, rol, activo, creado_en FROM usuarios').all();
  res.json(users);
});

app.post('/api/usuarios', authMiddleware, solodueno, (req, res) => {
  const { nombre, email, password, rol } = req.body;
  const hash = bcrypt.hashSync(password, 10);
  try {
    const result = db.prepare('INSERT INTO usuarios (nombre, email, password, rol) VALUES (?, ?, ?, ?)').run(nombre, email, hash, rol || 'admin');
    res.json({ id: result.lastInsertRowid, mensaje: 'Usuario creado' });
  } catch {
    res.status(400).json({ error: 'Email ya existe' });
  }
});

app.patch('/api/usuarios/:id/toggle', authMiddleware, solodueno, (req, res) => {
  const user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (user.rol === 'dueno') return res.status(400).json({ error: 'No puedes desactivar al dueño' });
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
  const { codigo, nombre, categoria, precio_compra, precio_venta, stock, stock_minimo, unidad } = req.body;
  try {
    const result = db.prepare('INSERT INTO productos (codigo, nombre, categoria, precio_compra, precio_venta, stock, stock_minimo, unidad) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(codigo, nombre, categoria || 'General', precio_compra || 0, precio_venta, stock || 0, stock_minimo || 5, unidad || 'pza');
    res.json({ id: result.lastInsertRowid, mensaje: 'Producto creado' });
  } catch {
    res.status(400).json({ error: 'Código ya existe' });
  }
});

app.put('/api/productos/:id', authMiddleware, (req, res) => {
  const { nombre, categoria, precio_compra, precio_venta, stock_minimo, unidad } = req.body;
  db.prepare('UPDATE productos SET nombre=?, categoria=?, precio_compra=?, precio_venta=?, stock_minimo=?, unidad=?, actualizado_en=CURRENT_TIMESTAMP WHERE id=?').run(nombre, categoria, precio_compra, precio_venta, stock_minimo, unidad, req.params.id);
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

// ===== VENTAS =====
app.post('/api/ventas', authMiddleware, (req, res) => {
  const { items, metodo_pago, descuento, notas } = req.body;
  if (!items?.length) return res.status(400).json({ error: 'Sin productos' });
  const folio = 'V' + Date.now();
  let total = 0;
  const insertVenta = db.transaction(() => {
    for (const item of items) {
      const prod = db.prepare('SELECT * FROM productos WHERE id = ? AND activo = 1').get(item.producto_id);
      if (!prod) throw new Error(`Producto ${item.producto_id} no encontrado`);
      if (prod.stock < item.cantidad) throw new Error(`Stock insuficiente: ${prod.nombre}`);
      total += prod.precio_venta * item.cantidad;
    }
    total -= (descuento || 0);
    const venta = db.prepare('INSERT INTO ventas (folio, usuario_id, total, descuento, metodo_pago, notas) VALUES (?, ?, ?, ?, ?, ?)').run(folio, req.user.id, total, descuento || 0, metodo_pago || 'efectivo', notas || '');
    for (const item of items) {
      const prod = db.prepare('SELECT * FROM productos WHERE id = ?').get(item.producto_id);
      db.prepare('INSERT INTO venta_items (venta_id, producto_id, cantidad, precio_unitario, subtotal) VALUES (?, ?, ?, ?, ?)').run(venta.lastInsertRowid, item.producto_id, item.cantidad, prod.precio_venta, prod.precio_venta * item.cantidad);
      db.prepare('UPDATE productos SET stock = stock - ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?').run(item.cantidad, item.producto_id);
      db.prepare('INSERT INTO movimientos (producto_id, tipo, cantidad, stock_anterior, stock_nuevo, nota, usuario_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(item.producto_id, 'venta', item.cantidad, prod.stock, prod.stock - item.cantidad, `Venta ${folio}`, req.user.id);
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
  if (desde) { query += ' AND v.creado_en >= ?'; params.push(desde); }
  if (hasta) { query += ' AND v.creado_en <= ?'; params.push(hasta); }
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

// ===== CORTE DE CAJA =====
app.post('/api/cortes', authMiddleware, (req, res) => {
  const { fecha_inicio, notas } = req.body;
  const desde = fecha_inicio || new Date().toISOString().split('T')[0] + 'T00:00:00.000Z';
  const ventas = db.prepare('SELECT * FROM ventas WHERE creado_en >= ? AND creado_en <= CURRENT_TIMESTAMP').all(desde);
  const total = ventas.reduce((s, v) => s + v.total, 0);
  const efectivo = ventas.filter(v => v.metodo_pago === 'efectivo').reduce((s, v) => s + v.total, 0);
  const tarjeta = ventas.filter(v => v.metodo_pago === 'tarjeta').reduce((s, v) => s + v.total, 0);
  const transferencia = ventas.filter(v => v.metodo_pago === 'transferencia').reduce((s, v) => s + v.total, 0);
  const result = db.prepare('INSERT INTO cortes (usuario_id, fecha_inicio, total_ventas, num_ventas, efectivo, tarjeta, transferencia, notas) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(req.user.id, desde, total, ventas.length, efectivo, tarjeta, transferencia, notas || '');
  res.json({ id: result.lastInsertRowid, total_ventas: total, num_ventas: ventas.length, efectivo, tarjeta, transferencia });
});

app.get('/api/cortes', authMiddleware, (req, res) => {
  const cortes = db.prepare('SELECT c.*, u.nombre as cajero FROM cortes c LEFT JOIN usuarios u ON c.usuario_id = u.id ORDER BY c.creado_en DESC LIMIT 50').all();
  res.json(cortes);
});

// ===== DASHBOARD =====
app.get('/api/dashboard', authMiddleware, (req, res) => {
  const hoy = new Date().toISOString().split('T')[0];
  const ventas_hoy = db.prepare(`SELECT COUNT(*) as num, COALESCE(SUM(total),0) as total FROM ventas WHERE date(creado_en) = ?`).get(hoy);
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
    LEFT JOIN ventas v ON v.usuario_id = u.id AND date(v.creado_en) = ?
    WHERE u.rol != 'dueno'
    GROUP BY u.id
    ORDER BY total_vendido DESC
  `).all(hoy);

  const alertas_actividad = [];
  const ventas_fuera_horario = db.prepare(`
    SELECT COUNT(*) as num FROM ventas
    WHERE date(creado_en) = ?
    AND (CAST(strftime('%H', creado_en) AS INTEGER) < 7
      OR CAST(strftime('%H', creado_en) AS INTEGER) >= 22)
  `).get(hoy);
  if (ventas_fuera_horario.num > 0) {
    alertas_actividad.push({ tipo: 'warning', mensaje: `${ventas_fuera_horario.num} venta(s) fuera de horario normal` });
  }
  const descuentos_sospechosos = db.prepare(`
    SELECT u.nombre, COUNT(v.id) as num_descuentos
    FROM ventas v LEFT JOIN usuarios u ON v.usuario_id = u.id
    WHERE date(v.creado_en) = ? AND v.descuento > 0
    GROUP BY v.usuario_id HAVING num_descuentos >= 3
  `).all(hoy);
  descuentos_sospechosos.forEach(d => {
    alertas_actividad.push({ tipo: 'danger', mensaje: `${d.nombre} aplicó descuentos en ${d.num_descuentos} ventas hoy` });
  });

  res.json({ ventas_hoy, productos_total, bajo_stock, ultimas_ventas, alertas, actividad_cajeros, alertas_actividad });
});

// ===== MONITOREO DE CAJEROS =====
app.get('/api/cajeros/actividad', authMiddleware, solodueno, (req, res) => {
  const { fecha } = req.query;
  const dia = fecha || new Date().toISOString().split('T')[0];
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
    LEFT JOIN ventas v ON v.usuario_id = u.id AND date(v.creado_en) = ?
    WHERE u.rol != 'dueno'
    GROUP BY u.id ORDER BY total_vendido DESC
  `).all(dia);
  res.json({ fecha: dia, cajeros: actividad });
});

// ===== EXPORTAR A EXCEL (CSV descargable) =====

// Exportar ventas
app.get('/api/exportar/ventas', authMiddleware, solodueno, (req, res) => {
  const { desde, hasta } = req.query;
  let query = `SELECT v.folio, v.creado_en as fecha, u.nombre as cajero, v.metodo_pago, v.descuento, v.total, v.notas
    FROM ventas v LEFT JOIN usuarios u ON v.usuario_id = u.id WHERE 1=1`;
  const params = [];
  if (desde) { query += ' AND v.creado_en >= ?'; params.push(desde); }
  if (hasta) { query += ' AND v.creado_en <= ?'; params.push(hasta); }
  query += ' ORDER BY v.creado_en DESC';
  const ventas = db.prepare(query).all(...params);

  let csv = 'Folio,Fecha,Cajero,Método de Pago,Descuento,Total,Notas\n';
  ventas.forEach(v => {
    csv += `"${v.folio}","${v.fecha}","${v.cajero||''}","${v.metodo_pago}","${v.descuento}","${v.total}","${v.notas||''}"\n`;
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="ventas_${new Date().toISOString().split('T')[0]}.csv"`);
  res.send('\uFEFF' + csv); // BOM para que Excel abra bien el UTF-8
});

// Exportar detalle de productos vendidos
app.get('/api/exportar/detalle-ventas', authMiddleware, solodueno, (req, res) => {
  const { desde, hasta } = req.query;
  let query = `SELECT v.folio, v.creado_en as fecha, u.nombre as cajero,
    p.codigo, p.nombre as producto, vi.cantidad, vi.precio_unitario, vi.subtotal
    FROM venta_items vi
    LEFT JOIN ventas v ON vi.venta_id = v.id
    LEFT JOIN productos p ON vi.producto_id = p.id
    LEFT JOIN usuarios u ON v.usuario_id = u.id
    WHERE 1=1`;
  const params = [];
  if (desde) { query += ' AND v.creado_en >= ?'; params.push(desde); }
  if (hasta) { query += ' AND v.creado_en <= ?'; params.push(hasta); }
  query += ' ORDER BY v.creado_en DESC';
  const items = db.prepare(query).all(...params);

  let csv = 'Folio,Fecha,Cajero,Código,Producto,Cantidad,Precio Unitario,Subtotal\n';
  items.forEach(i => {
    csv += `"${i.folio}","${i.fecha}","${i.cajero||''}","${i.codigo||''}","${i.producto||''}","${i.cantidad}","${i.precio_unitario}","${i.subtotal}"\n`;
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="detalle_ventas_${new Date().toISOString().split('T')[0]}.csv"`);
  res.send('\uFEFF' + csv);
});

// Exportar inventario
app.get('/api/exportar/inventario', authMiddleware, solodueno, (req, res) => {
  const productos = db.prepare('SELECT codigo, nombre, categoria, precio_compra, precio_venta, stock, stock_minimo, unidad FROM productos WHERE activo = 1 ORDER BY nombre').all();

  let csv = 'Código,Nombre,Categoría,Precio Compra,Precio Venta,Stock Actual,Stock Mínimo,Unidad\n';
  productos.forEach(p => {
    csv += `"${p.codigo}","${p.nombre}","${p.categoria}","${p.precio_compra}","${p.precio_venta}","${p.stock}","${p.stock_minimo}","${p.unidad}"\n`;
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="inventario_${new Date().toISOString().split('T')[0]}.csv"`);
  res.send('\uFEFF' + csv);
});

// Exportar cortes de caja
app.get('/api/exportar/cortes', authMiddleware, solodueno, (req, res) => {
  const cortes = db.prepare(`SELECT c.creado_en as fecha, u.nombre as cajero, c.num_ventas,
    c.efectivo, c.tarjeta, c.transferencia, c.total_ventas, c.notas
    FROM cortes c LEFT JOIN usuarios u ON c.usuario_id = u.id ORDER BY c.creado_en DESC`).all();

  let csv = 'Fecha,Cajero,Num Ventas,Efectivo,Tarjeta,Transferencia,Total,Notas\n';
  cortes.forEach(c => {
    csv += `"${c.fecha}","${c.cajero||''}","${c.num_ventas}","${c.efectivo}","${c.tarjeta}","${c.transferencia}","${c.total_ventas}","${c.notas||''}"\n`;
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="cortes_${new Date().toISOString().split('T')[0]}.csv"`);
  res.send('\uFEFF' + csv);
});

// ===== BACKUP =====
app.get('/api/backup', authMiddleware, solodueno, (req, res) => {
  try {
    if (!fs.existsSync(DB_PATH)) return res.status(404).json({ error: 'Base de datos no encontrada' });
    const fecha = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="tienda_backup_${fecha}.db"`);
    res.send(fs.readFileSync(DB_PATH));
  } catch(e) {
    res.status(500).json({ error: 'Error al generar backup: ' + e.message });
  }
});

app.listen(PORT, () => console.log(`✅ Servidor corriendo en puerto ${PORT}`));
