/**
 * 用户 CRUD
 */

const { queryAll, queryOne, run, saveDb } = require('./index');

function addUser(code, platform = 'qq', name = '') {
    const result = run(
        `INSERT INTO users (code, platform, name) VALUES (?, ?, ?)`,
        [code, platform, name]
    );
    return result.lastInsertRowid;
}

function getUser(id) {
    return queryOne('SELECT * FROM users WHERE id = ?', [id]);
}

function getUserByGid(gid) {
    return queryOne('SELECT * FROM users WHERE gid = ?', [gid]);
}

function getAllUsers() {
    return queryAll('SELECT * FROM users WHERE status = ? ORDER BY id', ['active']);
}

function getActiveUsers() {
    return getAllUsers();
}

function updateUser(id, data) {
    const fields = [];
    const values = [];

    for (const [key, value] of Object.entries(data)) {
        if (['gid', 'name', 'code', 'platform', 'level', 'gold', 'exp', 'status'].includes(key)) {
            fields.push(`${key} = ?`);
            values.push(value);
        }
    }

    if (fields.length === 0) return;

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
}

function updateUserCode(id, code) {
    run('UPDATE users SET code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [code, id]);
}

function updateUserStats(id, level, gold, exp) {
    run(
        `UPDATE users SET level = ?, gold = ?, exp = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [level, gold, exp, id]
    );
}

function deleteUser(id) {
    run('DELETE FROM users WHERE id = ?', [id]);
}

function getUserCount() {
    const result = queryOne('SELECT COUNT(*) as count FROM users WHERE status = ?', ['active']);
    return result ? result.count : 0;
}

module.exports = {
    addUser,
    getUser,
    getUserByGid,
    getAllUsers,
    getActiveUsers,
    updateUser,
    updateUserCode,
    updateUserStats,
    deleteUser,
    getUserCount,
};
