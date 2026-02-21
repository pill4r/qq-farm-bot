/**
 * 好友 CRUD
 */

const { queryAll, queryOne, run, saveDb } = require('./index');

function upsertFriend(userId, gid, name, level) {
    const existing = queryOne('SELECT id FROM friends WHERE user_id = ? AND gid = ?', [userId, gid]);
    const now = Math.floor(Date.now() / 1000);
    
    if (existing) {
        run('UPDATE friends SET name = ?, level = ?, last_visit = ? WHERE user_id = ? AND gid = ?', 
            [name, level, now, userId, gid]);
    } else {
        run('INSERT INTO friends (user_id, gid, name, level, last_visit) VALUES (?, ?, ?, ?, ?)',
            [userId, gid, name, level, now]);
    }
}

function getFriend(userId, gid) {
    return queryOne('SELECT * FROM friends WHERE user_id = ? AND gid = ?', [userId, gid]);
}

function getFriendById(id) {
    return queryOne('SELECT * FROM friends WHERE id = ?', [id]);
}

function getFriendsByUserId(userId) {
    return queryAll('SELECT * FROM friends WHERE user_id = ? ORDER BY gid', [userId]);
}

function updateFriend(id, data) {
    const fields = [];
    const values = [];

    for (const [key, value] of Object.entries(data)) {
        if (['name', 'level', 'last_visit'].includes(key)) {
            fields.push(`${key} = ?`);
            values.push(value);
        }
    }

    if (fields.length === 0) return;

    values.push(id);
    run(`UPDATE friends SET ${fields.join(', ')} WHERE id = ?`, values);
}

function deleteFriend(id) {
    run('DELETE FROM friends WHERE id = ?', [id]);
}

function deleteFriendsByUserId(userId) {
    run('DELETE FROM friends WHERE user_id = ?', [userId]);
}

function getFriendCount(userId) {
    const result = queryOne('SELECT COUNT(*) as count FROM friends WHERE user_id = ?', [userId]);
    return result ? result.count : 0;
}

module.exports = {
    addFriend: upsertFriend,
    getFriend,
    getFriendById,
    getFriendsByUserId,
    updateFriend,
    deleteFriend,
    deleteFriendsByUserId,
    getFriendCount,
    upsertFriend,
};
