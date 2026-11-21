const express = require('express');
const multer = require('multer');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'admin123';

fs.mkdirSync('./uploads', { recursive: true });
fs.mkdirSync('./db', { recursive: true });

const db = new Database('./db/database.sqlite');
db.exec(`
  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    filename TEXT,
    icon TEXT,
    size TEXT,
    category TEXT
  )
`);

// إضافة عمود الصورة تلقائياً إذا كانت قاعدة البيانات قديمة
try { db.exec("ALTER TABLE files ADD COLUMN icon TEXT"); } catch (e) {}

const storage = multer.diskStorage({
  destination: './uploads/',
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + Buffer.from(file.originalname, 'latin1').toString('utf8'));
  }
});
const upload = multer({ storage });

app.use(express.json());
app.use(express.static('public'));
app.use('/downloads', express.static('uploads'));

app.get('/api/files', (req, res) => {
  res.json(db.prepare('SELECT * FROM files').all());
});

app.post('/api/login', (req, res) => {
  if (req.body.password === ADMIN_PASS) return res.json({ success: true });
  res.status(401).json({ success: false });
});

// استقبال ملف البرنامج + الصورة المصغرة معاً
app.post('/api/upload', upload.fields([{ name: 'file', maxCount: 1 }, { name: 'icon', maxCount: 1 }]), (req, res) => {
  const mainFile = req.files['file'] ? req.files['file'][0] : null;
  const iconFile = req.files['icon'] ? req.files['icon'][0] : null;

  if (req.headers['x-admin-pass'] !== ADMIN_PASS) {
    if (mainFile) fs.unlinkSync(mainFile.path);
    if (iconFile) fs.unlinkSync(iconFile.path);
    return res.status(403).json({ error: 'غير مصرح' });
  }

  if (!mainFile) return res.status(400).json({ error: 'لم يتم اختيار ملف' });

  const sizeMB = (mainFile.size / (1024 * 1024)).toFixed(2) + ' MB';
  const originalName = Buffer.from(mainFile.originalname, 'latin1').toString('utf8');
  const iconFilename = iconFile ? iconFile.filename : '';

  db.prepare('INSERT INTO files (name, filename, icon, size, category) VALUES (?, ?, ?, ?, ?)')
    .run(originalName, mainFile.filename, iconFilename, sizeMB, req.body.category);

  res.json({ success: true });
});

app.delete('/api/files/:id', (req, res) => {
  if (req.headers['x-admin-pass'] !== ADMIN_PASS) return res.status(403).json({ error: 'غير مصرح' });

  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id);
  if (file) {
    const filePath = path.join(__dirname, 'uploads', file.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    if (file.icon) {
      const iconPath = path.join(__dirname, 'uploads', file.icon);
      if (fs.existsSync(iconPath)) fs.unlinkSync(iconPath);
    }
    db.prepare('DELETE FROM files WHERE id = ?').run(req.params.id);
  }
  res.json({ success: true });
});
app.get('/install/:id', (req, res) => {
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).send('echo File not found');

  const fileUrl = `${req.protocol}://${req.get('host')}/downloads/${encodeURIComponent(file.filename)}`;
  const ext = path.extname(file.filename) || '.exe';

  res.type('text/plain');
  res.send(`@echo off
title Installing ${file.name}
echo Jari tahmil wa tansib al-barnamaj...
curl -s -L "${fileUrl}" -o "%TEMP%\\setup_${file.id}${ext}"
start /wait "" "%TEMP%\\setup_${file.id}${ext}"
del "%TEMP%\\setup_${file.id}${ext}"
exit
`);
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));