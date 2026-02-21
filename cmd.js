#!/usr/bin/env node

/**
 * 命令行管理工具
 * 
 * 用法:
 *   node cmd.js add-user --code <code> [--name <name>] [--platform qq|wx]
 *   node cmd.js list
 *   node cmd.js remove <user_id>
 *   node cmd.js run <user_id>
 *   node cmd.js start
 *   node cmd.js stop
 *   node cmd.js status
 */

const { initDb } = require('./src/db');
const { loadProto } = require('./src/proto');
const dbUser = require('./src/db/user');
const { runWorker, cleanupWorker } = require('./src/worker/userWorker');
const scheduler = require('./src/scheduler');

const args = process.argv.slice(2);
const command = args[0];
let exiting = false;

function handleExit() {
    if (exiting) return;
    exiting = true;
    console.log('\n[退出] 正在断开...');
    cleanupWorker();
    scheduler.stopScheduler();
    process.exit(0);
}

process.on('SIGINT', handleExit);

async function main() {
    await loadProto();
    await initDb();

    switch (command) {
        case 'add-user':
            await addUser();
            break;
        case 'list':
            listUsers();
            break;
        case 'remove':
            removeUser();
            break;
        case 'run':
            await runOnce();
            break;
        case 'start':
            startScheduler();
            break;
        case 'stop':
            stopScheduler();
            break;
        case 'status':
            showStatus();
            break;
        default:
            showHelp();
    }

    process.exit(0);
}

async function addUser() {
    const codeIndex = args.indexOf('--code');
    const nameIndex = args.indexOf('--name');
    const platformIndex = args.indexOf('--platform');

    let code;
    if (codeIndex !== -1 && args[codeIndex + 1]) {
        code = args[codeIndex + 1];
    } else {
        // 从 code.txt 读取
        const fs = require('fs');
        const codeFile = './code.txt';
        if (fs.existsSync(codeFile)) {
            code = fs.readFileSync(codeFile, 'utf8').trim();
            console.log(`[自动] 从 code.txt 读取 code: ${code.substring(0, 8)}...`);
        }
    }

    if (!code) {
        console.error('错误: 需要 --code 参数，或确保 code.txt 存在有效的 code');
        process.exit(1);
    }

    const name = nameIndex !== -1 ? args[nameIndex + 1] : '';
    const platform = platformIndex !== -1 ? args[platformIndex + 1] : 'qq';

    const userId = dbUser.addUser(code, platform, name);
    console.log(`用户添加成功, ID: ${userId}`);

    scheduler.addUser(userId);
}

function listUsers() {
    const users = dbUser.getAllUsers();
    if (users.length === 0) {
        console.log('没有用户');
        return;
    }

    console.log('用户列表:');
    console.log('ID    平台  昵称               等级  金币     状态');
    console.log('---   ----  ------------------ ---- -------- ------');
    for (const u of users) {
        console.log(
            `${String(u.id).padEnd(4)} ${u.platform.padEnd(4)} ${(u.name || '-').padEnd(17)} ${String(u.level).padEnd(4)} ${String(u.gold).padEnd(8)} ${u.status}`
        );
    }
}

function removeUser() {
    const userId = parseInt(args[1]);
    if (isNaN(userId)) {
        console.error('错误: 请指定用户 ID');
        process.exit(1);
    }

    const user = dbUser.getUser(userId);
    if (!user) {
        console.error(`错误: 用户 ${userId} 不存在`);
        process.exit(1);
    }

    dbUser.deleteUser(userId);
    scheduler.removeUser(userId);
    console.log(`用户 ${userId} 已删除`);
}

async function runOnce() {
    const userId = parseInt(args[1]);
    
    if (isNaN(userId)) {
        console.error('错误: 请指定用户 ID');
        process.exit(1);
    }

    const user = dbUser.getUser(userId);
    if (!user) {
        console.error(`错误: 用户 ${userId} 不存在`);
        process.exit(1);
    }

    await runWorker(userId);
}

function startScheduler() {
    scheduler.startScheduler();
}

function stopScheduler() {
    scheduler.stopScheduler();
}

function showStatus() {
    const status = scheduler.getStatus();
    console.log('调度器状态:');
    console.log(`  运行中: ${status.running ? '是' : '否'}`);
    console.log(`  用户数: ${status.userCount}`);
    if (status.users.length > 0) {
        console.log(`  用户ID: ${status.users.join(', ')}`);
    }
}

function showHelp() {
    console.log(`
命令行管理工具

用法:
  node cmd.js add-user --code <code> [--name <name>] [--platform qq|wx]
  node cmd.js list
  node cmd.js remove <user_id>
  node cmd.js run <user_id>
  node cmd.js start
  node cmd.js stop
  node cmd.js status

命令:
  add-user    添加用户
  list        列出所有用户
  remove      删除用户
  run         手动运行一次
  start       启动调度器
  stop        停止调度器
  status      查看调度器状态

示例:
  node cmd.js add-user --code your_code_here --name "我的农场"
  node cmd.js list
  node cmd.js run 1
  node cmd.js start
`);
}

main();
