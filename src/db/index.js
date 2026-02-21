/**
 * SQLite 数据库初始化 (使用 sql.js)
 */

const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

let db = null;
let SQL = null;
let dbPath = null;

async function initDb() {
    const dataDir = path.join(__dirname, '../../data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    dbPath = path.join(dataDir, 'farm.db');
    
    SQL = await initSqlJs();
    
    let data = null;
    if (fs.existsSync(dbPath)) {
        data = fs.readFileSync(dbPath);
    }
    
    db = new SQL.Database(data);
    createTables();
    saveDb();
    return db;
}

function saveDb() {
    if (db && dbPath) {
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(dbPath, buffer);
    }
}

function createTables() {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            gid INTEGER UNIQUE,
            name TEXT,
            code TEXT NOT NULL,
            platform TEXT DEFAULT 'qq',
            level INTEGER DEFAULT 0,
            gold INTEGER DEFAULT 0,
            exp INTEGER DEFAULT 0,
            status TEXT DEFAULT 'active',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    db.run(`
        CREATE TABLE IF NOT EXISTS friends (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            gid INTEGER NOT NULL,
            name TEXT,
            level INTEGER DEFAULT 0,
            last_visit INTEGER DEFAULT 0,
            UNIQUE(user_id, gid),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);
    
    db.run(`
        CREATE TABLE IF NOT EXISTS friend_lands (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            friend_id INTEGER NOT NULL,
            land_id INTEGER NOT NULL,
            plant_id INTEGER,
            plant_name TEXT,
            mature_time INTEGER,
            last_steal_time INTEGER DEFAULT 0,
            updated_at INTEGER DEFAULT (strftime('%s', 'now')),
            UNIQUE(friend_id, land_id),
            FOREIGN KEY (friend_id) REFERENCES friends(id) ON DELETE CASCADE
        )
    `);
    
    db.run(`
        CREATE TABLE IF NOT EXISTS my_lands (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            land_id INTEGER NOT NULL,
            plant_id INTEGER,
            plant_name TEXT,
            mature_time INTEGER,
            phase INTEGER DEFAULT 0,
            need_water INTEGER DEFAULT 0,
            need_weed INTEGER DEFAULT 0,
            need_bug INTEGER DEFAULT 0,
            updated_at INTEGER DEFAULT (strftime('%s', 'now')),
            UNIQUE(user_id, land_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);
    
    db.run(`CREATE INDEX IF NOT EXISTS idx_friend_lands_mature ON friend_lands(mature_time)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_my_lands_mature ON my_lands(mature_time)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_friends_user ON friends(user_id)`);
}

function getDb() {
    return db;
}

function closeDb() {
    if (db) {
        saveDb();
        db.close();
        db = null;
    }
}

// 辅助函数：将 sql.js 结果转为对象数组
function queryAll(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const results = [];
    while (stmt.step()) {
        results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
}

function queryOne(sql, params = []) {
    const results = queryAll(sql, params);
    return results.length > 0 ? results[0] : null;
}

function run(sql, params = []) {
    db.run(sql, params);
    saveDb();
    return { lastInsertRowid: db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] || 0 };
}

module.exports = {
    initDb,
    getDb,
    closeDb,
    queryAll,
    queryOne,
    run,
    saveDb,
};
