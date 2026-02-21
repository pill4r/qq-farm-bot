/**
 * 好友土地 CRUD
 */

const { queryAll, queryOne, run, saveDb } = require('./index');

function upsertFriendLand(friendId, landId, plantId, plantName, matureTime) {
    const existing = queryOne('SELECT id FROM friend_lands WHERE friend_id = ? AND land_id = ?', [friendId, landId]);
    const now = Math.floor(Date.now() / 1000);
    
    if (existing) {
        run(`UPDATE friend_lands SET plant_id = ?, plant_name = ?, mature_time = ?, updated_at = ? WHERE friend_id = ? AND land_id = ?`,
            [plantId, plantName, matureTime, now, friendId, landId]);
    } else {
        run(`INSERT INTO friend_lands (friend_id, land_id, plant_id, plant_name, mature_time, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
            [friendId, landId, plantId, plantName, matureTime, now]);
    }
}

function getFriendLand(friendId, landId) {
    return queryOne('SELECT * FROM friend_lands WHERE friend_id = ? AND land_id = ?', [friendId, landId]);
}

function getFriendLands(friendId) {
    return queryAll('SELECT * FROM friend_lands WHERE friend_id = ? ORDER BY land_id', [friendId]);
}

function getFriendLandsByUserId(userId) {
    return queryAll(`
        SELECT fl.* FROM friend_lands fl
        JOIN friends f ON fl.friend_id = f.id
        WHERE f.user_id = ?
        ORDER BY fl.mature_time
    `, [userId]);
}

function getMatureLands(userId, currentTime) {
    return queryAll(`
        SELECT fl.*, f.gid as friend_gid, f.name as friend_name
        FROM friend_lands fl
        JOIN friends f ON fl.friend_id = f.id
        WHERE f.user_id = ? AND fl.mature_time > 0 AND fl.mature_time <= ?
        ORDER BY fl.mature_time
    `, [userId, currentTime]);
}

function getNextMatureTime(userId) {
    const now = Math.floor(Date.now() / 1000);
    const result = queryOne(`
        SELECT MIN(fl.mature_time) as next_mature
        FROM friend_lands fl
        JOIN friends f ON fl.friend_id = f.id
        WHERE f.user_id = ? AND fl.mature_time > ?
    `, [userId, now]);
    return result ? result.next_mature : null;
}

function updateLastStealTime(friendId, landId) {
    const now = Math.floor(Date.now() / 1000);
    run('UPDATE friend_lands SET last_steal_time = ?, updated_at = ? WHERE friend_id = ? AND land_id = ?',
        [now, now, friendId, landId]);
}

function deleteFriendLands(friendId) {
    run('DELETE FROM friend_lands WHERE friend_id = ?', [friendId]);
}

function clearAllFriendLands(userId) {
    run(`
        DELETE FROM friend_lands 
        WHERE friend_id IN (SELECT id FROM friends WHERE user_id = ?)
    `, [userId]);
}

module.exports = {
    upsertFriendLand,
    getFriendLand,
    getFriendLands,
    getFriendLandsByUserId,
    getMatureLands,
    getNextMatureTime,
    updateLastStealTime,
    deleteFriendLands,
    clearAllFriendLands,
};
