/**
 * 定时调度器
 * 根据数据库中最近成熟时间安排 Worker 唤醒时间
 */

const UserWorker = require('../worker/userWorker');
const dbUser = require('../db/user');
const dbMyLand = require('../db/myLand');
const dbFriendLand = require('../db/friendLand');

const timers = new Map();
let running = false;

const MIN_INTERVAL = 30 * 60 * 1000;  // 最小间隔 30 分钟
const MAX_INTERVAL = 90 * 90 * 1000;  // 最大间隔 90 分钟  
const WAKE_JITTER_MIN = 15 * 1000;    // 唤醒扰动最小 15 秒
const WAKE_JITTER_MAX = 35 * 1000;    // 唤醒扰动最大 35 秒

function getRandomJitter(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getNextWakeTime(userId) {
    const now = Math.floor(Date.now() / 1000);

    const myNextMature = dbMyLand.getAllNextMatureTime(userId);
    const friendNextMature = dbFriendLand.getNextMatureTime(userId);

    let nearestMature = null;
    if (myNextMature && friendNextMature) {
        nearestMature = Math.min(myNextMature, friendNextMature);
    } else if (myNextMature) {
        nearestMature = myNextMature;
    } else if (friendNextMature) {
        nearestMature = friendNextMature;
    }

    if (!nearestMature || nearestMature <= now) {
        return null;
    }

    return nearestMature;
}

function scheduleUser(userId) {
    if (!running) return;

    const user = dbUser.getUser(userId);
    if (!user || user.status !== 'active') return;

    const nextMatureTime = getNextWakeTime(userId);
    const nowSec = Math.floor(Date.now() / 1000);

    let delay;
    if (!nextMatureTime) {
        delay = getRandomJitter(MIN_INTERVAL, MAX_INTERVAL);
    } else {
        const secondsUntilMature = nextMatureTime - nowSec;
        const jitter = getRandomJitter(WAKE_JITTER_MIN, WAKE_JITTER_MAX);
        delay = Math.max(0, secondsUntilMature * 1000 + jitter);
        
        if (delay < MIN_INTERVAL) {
            delay = getRandomJitter(MIN_INTERVAL, MAX_INTERVAL);
        }
    }

    console.log(`[Scheduler] 用户 ${userId} 下次运行: ${Math.round(delay / 1000 / 60)} 分钟后`);

    if (timers.has(userId)) {
        clearTimeout(timers.get(userId));
    }

    const timer = setTimeout(async () => {
        if (!running) return;

        const worker = new UserWorker(userId);
        try {
            await worker.run();
        } catch (err) {
            console.error(`[Scheduler] Worker 错误:`, err.message);
        }

        scheduleUser(userId);
    }, delay);

    timers.set(userId, timer);
}

function startScheduler() {
    if (running) {
        console.log('[Scheduler] 调度器已在运行');
        return;
    }

    running = true;
    console.log('[Scheduler] 调度器启动');

    const users = dbUser.getActiveUsers();
    if (users.length === 0) {
        console.log('[Scheduler] 没有活跃用户');
        return;
    }

    for (const user of users) {
        scheduleUser(user.id);
    }
}

function stopScheduler() {
    running = false;
    console.log('[Scheduler] 调度器停止');

    for (const [userId, timer] of timers) {
        clearTimeout(timer);
    }
    timers.clear();
}

function addUser(userId) {
    if (running) {
        scheduleUser(userId);
    }
}

function removeUser(userId) {
    if (timers.has(userId)) {
        clearTimeout(timers.get(userId));
        timers.delete(userId);
    }
}

function getStatus() {
    return {
        running,
        userCount: timers.size,
        users: Array.from(timers.keys()),
    };
}

module.exports = {
    startScheduler,
    stopScheduler,
    addUser,
    removeUser,
    getStatus,
    scheduleUser,
};
