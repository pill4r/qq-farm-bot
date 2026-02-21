/**
 * 单用户 Worker
 * 负责: 连接 → 操作 → 退出
 */

const { createNetworkInstance } = require('../network');
const { checkAndOperateFarm } = require('../farm');
const { scanAndSteal } = require('../friend');
const { claimTasks } = require('../task');
const { sellFruits } = require('../warehouse');
const dbUser = require('../db/user');
const dbMyLand = require('../db/myLand');
const dbFriendLand = require('../db/friendLand');
const { toNum } = require('../utils');

let currentNetwork = null;

function cleanupWorker() {
    if (currentNetwork) {
        try { currentNetwork.disconnect(); } catch (e) { }
        currentNetwork = null;
    }
}

async function runWorker(userId) {
    console.log(`[Worker] 用户 ${userId} 开始运行`);
    
    try {
        // 1. 加载用户信息
        const user = dbUser.getUser(userId);
        if (!user) {
            console.error(`[Worker] 用户 ${userId} 不存在`);
            return;
        }

        // 2. 随机等待 2-5 秒（防检测）
        const waitTime = 2000 + Math.random() * 3000;
        console.log(`[Worker] 等待 ${Math.round(waitTime/1000)}s...`);
        
        // 使用 setImmediate + 循环代替 setTimeout
        await new Promise(resolve => setTimeout(resolve, waitTime));
        
        console.log(`[Worker] 等待完成，开始连接...`);
        console.log(`[Worker] user.code = ${user.code ? 'exists' : 'MISSING'}`);

        // 3. 创建网络连接并登录
        const network = createNetworkInstance();
        currentNetwork = network;
        console.log(`[Worker] 正在连接...`);
        
        try {
            await network.connect(user.code);
            console.log(`[Worker] 登录成功: ${network.getUserState().name}`);
        } catch (e) {
            console.error(`[Worker] 连接失败: ${e.message}`);
            return;
        }

        // 4. 更新用户信息
        const state = network.getUserState();
        dbUser.updateUserStats(userId, state.level, state.gold, state.exp);

        // 5. 检查自己农场
        console.log(`[Worker] 检查自己农场...`);
        await checkAndOperateFarm(network, userId);

        // 6. 扫描好友并偷菜
        console.log(`[Worker] 扫描好友...`);
        await scanAndSteal(network, userId);

        // 7. 领取任务奖励
        console.log(`[Worker] 领取任务...`);
        await claimTasks(network);

        // 8. 出售果实
        console.log(`[Worker] 出售果实...`);
        await sellFruits(network);

        // 9. 更新最终用户信息
        const finalState = network.getUserState();
        dbUser.updateUserStats(userId, finalState.level, finalState.gold, finalState.exp);

        console.log(`[Worker] 用户 ${userId} 运行完成`);

    } catch (err) {
        console.error(`[Worker] 用户 ${userId} 运行失败:`, err.message);
    } finally {
        cleanupWorker();
    }
}

module.exports = { runWorker, cleanupWorker };
