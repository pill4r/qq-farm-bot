/**
 * WebSocket 网络层 - 连接/消息编解码/登录/心跳
 * 支持独立实例模式（按需调用）和全局模式（持续在线）
 */

const WebSocket = require('ws');
const EventEmitter = require('events');
const { CONFIG } = require('./config');
const { types } = require('./proto');
const { toLong, toNum, syncServerTime, log, logWarn } = require('./utils');

function createNetworkInstance() {
    const instance = {
        ws: null,
        clientSeq: 1,
        serverSeq: 0,
        heartbeatTimer: null,
        pendingCallbacks: new Map(),
        userState: {
            gid: 0,
            name: '',
            level: 0,
            gold: 0,
            exp: 0,
        },
        connected: false,
        events: new EventEmitter(),
    };

    instance.encodeMsg = function(serviceName, methodName, bodyBytes) {
        const msg = types.GateMessage.create({
            meta: {
                service_name: serviceName,
                method_name: methodName,
                message_type: 1,
                client_seq: toLong(instance.clientSeq),
                server_seq: toLong(instance.serverSeq),
            },
            body: bodyBytes || Buffer.alloc(0),
        });
        const encoded = types.GateMessage.encode(msg).finish();
        instance.clientSeq++;
        return encoded;
    };

    instance.sendMsg = function(serviceName, methodName, bodyBytes, callback) {
        if (!instance.ws || instance.ws.readyState !== WebSocket.OPEN) {
            log('WS', '连接未打开');
            return false;
        }
        const seq = instance.clientSeq;
        const encoded = instance.encodeMsg(serviceName, methodName, bodyBytes);
        if (callback) instance.pendingCallbacks.set(seq, callback);
        instance.ws.send(encoded);
        return true;
    };

    instance.sendMsgAsync = function(serviceName, methodName, bodyBytes, timeout = 10000) {
        return new Promise((resolve, reject) => {
            if (!instance.ws || instance.ws.readyState !== WebSocket.OPEN) {
                reject(new Error(`连接未打开: ${methodName}`));
                return;
            }
            
            const seq = instance.clientSeq;
            const timer = setTimeout(() => {
                instance.pendingCallbacks.delete(seq);
                reject(new Error(`请求超时: ${methodName} (seq=${seq})`));
            }, timeout);

            const sent = instance.sendMsg(serviceName, methodName, bodyBytes, (err, body, meta) => {
                clearTimeout(timer);
                if (err) reject(err);
                else resolve({ body, meta });
            });
            
            if (!sent) {
                clearTimeout(timer);
                reject(new Error(`发送失败: ${methodName}`));
            }
        });
    };

    instance.handleMessage = function(data) {
        try {
            const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
            const msg = types.GateMessage.decode(buf);
            const meta = msg.meta;
            if (!meta) return;

            if (meta.server_seq) {
                const seq = toNum(meta.server_seq);
                if (seq > instance.serverSeq) instance.serverSeq = seq;
            }

            const msgType = meta.message_type;

            if (msgType === 3) {
                instance.handleNotify(msg);
                return;
            }

            if (msgType === 2) {
                const errorCode = toNum(meta.error_code);
                const clientSeqVal = toNum(meta.client_seq);

                const cb = instance.pendingCallbacks.get(clientSeqVal);
                if (cb) {
                    instance.pendingCallbacks.delete(clientSeqVal);
                    if (errorCode !== 0) {
                        cb(new Error(`${meta.service_name}.${meta.method_name} 错误: code=${errorCode} ${meta.error_message || ''}`));
                    } else {
                        cb(null, msg.body, meta);
                    }
                    return;
                }

                if (errorCode !== 0) {
                    logWarn('错误', `${meta.service_name}.${meta.method_name} code=${errorCode} ${meta.error_message || ''}`);
                }
            }
        } catch (err) {
            logWarn('解码', err.message);
        }
    };

    instance.handleNotify = function(msg) {
        if (!msg.body || msg.body.length === 0) return;
        try {
            const event = types.EventMessage.decode(msg.body);
            const type = event.message_type || '';
            
            if (type.includes('Kickout')) {
                log('推送', `被踢下线! ${type}`);
                instance.events.emit('kickout', type);
                return;
            }

            if (type.includes('BasicNotify')) {
                try {
                    const notify = types.BasicNotify.decode(event.body);
                    if (notify.basic) {
                        instance.userState.level = toNum(notify.basic.level) || instance.userState.level;
                        instance.userState.gold = toNum(notify.basic.gold) || instance.userState.gold;
                        const exp = toNum(notify.basic.exp);
                        if (exp > 0) {
                            instance.userState.exp = exp;
                        }
                        instance.events.emit('statsUpdate', {
                            level: instance.userState.level,
                            gold: instance.userState.gold,
                            exp: instance.userState.exp,
                        });
                    }
                } catch (e) { }
                return;
            }

            if (type.includes('ItemNotify')) {
                try {
                    const notify = types.ItemNotify.decode(event.body);
                    const items = notify.items || [];
                    for (const chg of items) {
                        if (!chg.item) continue;
                        const id = toNum(chg.item.id);
                        const count = toNum(chg.item.count);
                        if (id === 1 || id === 1001) {
                            instance.userState.gold = count;
                        }
                    }
                } catch (e) { }
                return;
            }
        } catch (e) {
            logWarn('推送', `解码失败: ${e.message}`);
        }
    };

    instance.sendLogin = function() {
        return new Promise(async (resolve, reject) => {
            const body = types.LoginRequest.encode(types.LoginRequest.create({
                sharer_id: toLong(0),
                sharer_open_id: '',
                device_info: CONFIG.device_info,
                share_cfg_id: toLong(0),
                scene_id: '1256',
                report_data: {
                    callback: '', cd_extend_info: '', click_id: '', clue_token: '',
                    minigame_channel: 'other', minigame_platid: 2, req_id: '', trackid: '',
                },
            })).finish();

            instance.sendMsg('gamepb.userpb.UserService', 'Login', body, (err, bodyBytes, meta) => {
                if (err) {
                    reject(err);
                    return;
                }
                try {
                    const reply = types.LoginReply.decode(bodyBytes);
                    if (reply.basic) {
                        instance.userState.gid = toNum(reply.basic.gid);
                        instance.userState.name = reply.basic.name || '未知';
                        instance.userState.level = toNum(reply.basic.level);
                        instance.userState.gold = toNum(reply.basic.gold);
                        instance.userState.exp = toNum(reply.basic.exp);

                        if (reply.time_now_millis) {
                            syncServerTime(toNum(reply.time_now_millis));
                        }
                    }
                    instance.connected = true;
                    instance.events.emit('loginSuccess', instance.userState);
                    resolve(instance.userState);
                } catch (e) {
                    reject(new Error(`解码失败: ${e.message}`));
                }
            });
        });
    };

    instance.startHeartbeat = function() {
        if (instance.heartbeatTimer) clearInterval(instance.heartbeatTimer);
        
        instance.heartbeatTimer = setInterval(() => {
            if (!instance.userState.gid) return;
            
            const body = types.HeartbeatRequest.encode(types.HeartbeatRequest.create({
                gid: toLong(instance.userState.gid),
                client_version: CONFIG.clientVersion,
            })).finish();
            
            instance.sendMsg('gamepb.userpb.UserService', 'Heartbeat', body, (err, replyBody) => {
                if (err || !replyBody) return;
                try {
                    const reply = types.HeartbeatReply.decode(replyBody);
                    if (reply.server_time) syncServerTime(toNum(reply.server_time));
                } catch (e) { }
            });
        }, CONFIG.heartbeatInterval);
    };

    instance.connect = function(code) {
        return new Promise((resolve, reject) => {
            const url = `${CONFIG.serverUrl}?platform=${CONFIG.platform}&os=${CONFIG.os}&ver=${CONFIG.clientVersion}&code=${code}&openID=`;

            instance.ws = new WebSocket(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13)',
                    'Origin': 'https://gate-obt.nqf.qq.com',
                },
            });

            instance.ws.binaryType = 'arraybuffer';

            instance.ws.on('open', async () => {
                try {
                    await instance.sendLogin();
                    instance.startHeartbeat();
                    resolve(instance.userState);
                } catch (e) {
                    reject(e);
                }
            });

            instance.ws.on('message', (data) => {
                instance.handleMessage(Buffer.isBuffer(data) ? data : Buffer.from(data));
            });

            instance.ws.on('close', (code, reason) => {
                instance.connected = false;
                instance.cleanup();
            });

            instance.ws.on('error', (err) => {
                reject(err);
            });
        });
    };

    instance.cleanup = function() {
        if (instance.heartbeatTimer) {
            clearInterval(instance.heartbeatTimer);
            instance.heartbeatTimer = null;
        }
        instance.pendingCallbacks.clear();
    };

    instance.disconnect = function() {
        if (instance.ws) {
            instance.ws.close();
            instance.ws = null;
        }
        instance.cleanup();
        instance.connected = false;
    };

    instance.getUserState = function() {
        return instance.userState;
    };

    return instance;
}

// ============ 全局实例（向后兼容） ============
const globalNetworkEvents = new EventEmitter();
let globalWs = null;
let globalClientSeq = 1;
let globalServerSeq = 0;
let globalHeartbeatTimer = null;
let globalPendingCallbacks = new Map();

const globalUserState = {
    gid: 0,
    name: '',
    level: 0,
    gold: 0,
    exp: 0,
};

function getUserState() { return globalUserState; }

function encodeMsg(serviceName, methodName, bodyBytes) {
    const msg = types.GateMessage.create({
        meta: {
            service_name: serviceName,
            method_name: methodName,
            message_type: 1,
            client_seq: toLong(globalClientSeq),
            server_seq: toLong(globalServerSeq),
        },
        body: bodyBytes || Buffer.alloc(0),
    });
    const encoded = types.GateMessage.encode(msg).finish();
    globalClientSeq++;
    return encoded;
}

function sendMsg(serviceName, methodName, bodyBytes, callback) {
    if (!globalWs || globalWs.readyState !== WebSocket.OPEN) {
        log('WS', '连接未打开');
        return false;
    }
    const seq = globalClientSeq;
    const encoded = encodeMsg(serviceName, methodName, bodyBytes);
    if (callback) globalPendingCallbacks.set(seq, callback);
    globalWs.send(encoded);
    return true;
}

function sendMsgAsync(serviceName, methodName, bodyBytes, timeout = 10000) {
    return new Promise((resolve, reject) => {
        if (!globalWs || globalWs.readyState !== WebSocket.OPEN) {
            reject(new Error(`连接未打开: ${methodName}`));
            return;
        }
        
        const seq = globalClientSeq;
        const timer = setTimeout(() => {
            globalPendingCallbacks.delete(seq);
            reject(new Error(`请求超时: ${methodName} (seq=${seq})`));
        }, timeout);

        const sent = sendMsg(serviceName, methodName, bodyBytes, (err, body, meta) => {
            clearTimeout(timer);
            if (err) reject(err);
            else resolve({ body, meta });
        });
        
        if (!sent) {
            clearTimeout(timer);
            reject(new Error(`发送失败: ${methodName}`));
        }
    });
}

function handleMessage(data) {
    try {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        const msg = types.GateMessage.decode(buf);
        const meta = msg.meta;
        if (!meta) return;

        if (meta.server_seq) {
            const seq = toNum(meta.server_seq);
            if (seq > globalServerSeq) globalServerSeq = seq;
        }

        const msgType = meta.message_type;

        if (msgType === 3) {
            globalHandleNotify(msg);
            return;
        }

        if (msgType === 2) {
            const errorCode = toNum(meta.error_code);
            const clientSeqVal = toNum(meta.client_seq);

            const cb = globalPendingCallbacks.get(clientSeqVal);
            if (cb) {
                globalPendingCallbacks.delete(clientSeqVal);
                if (errorCode !== 0) {
                    cb(new Error(`${meta.service_name}.${meta.method_name} 错误: code=${errorCode} ${meta.error_message || ''}`));
                } else {
                    cb(null, msg.body, meta);
                }
                return;
            }

            if (errorCode !== 0) {
                logWarn('错误', `${meta.service_name}.${meta.method_name} code=${errorCode} ${meta.error_message || ''}`);
            }
        }
    } catch (err) {
        logWarn('解码', err.message);
    }
}

const { updateStatusFromLogin, updateStatusGold, updateStatusLevel } = require('./status');

function globalHandleNotify(msg) {
    if (!msg.body || msg.body.length === 0) return;
    try {
        const event = types.EventMessage.decode(msg.body);
        const type = event.message_type || '';

        if (type.includes('Kickout')) {
            log('推送', `被踢下线! ${type}`);
            return;
        }

        if (type.includes('LandsNotify')) {
            try {
                const notify = types.LandsNotify.decode(msg.body);
                const hostGid = toNum(notify.host_gid);
                const lands = notify.lands || [];
                if (lands.length > 0) {
                    if (hostGid === globalUserState.gid || hostGid === 0) {
                        globalNetworkEvents.emit('landsChanged', lands);
                    }
                }
            } catch (e) { }
            return;
        }

        if (type.includes('ItemNotify')) {
            try {
                const notify = types.ItemNotify.decode(msg.body);
                const items = notify.items || [];
                for (const itemChg of items) {
                    const item = itemChg.item;
                    if (!item) continue;
                    const id = toNum(item.id);
                    const count = toNum(item.count);
                    
                    if (id === 1101 || id === 2) {
                        globalUserState.exp = count;
                        updateStatusLevel(globalUserState.level, count);
                    } else if (id === 1 || id === 1001) {
                        globalUserState.gold = count;
                        updateStatusGold(count);
                    }
                }
            } catch (e) { }
            return;
        }

        if (type.includes('BasicNotify')) {
            try {
                const notify = types.BasicNotify.decode(msg.body);
                if (notify.basic) {
                    const oldLevel = globalUserState.level;
                    globalUserState.level = toNum(notify.basic.level) || globalUserState.level;
                    globalUserState.gold = toNum(notify.basic.gold) || globalUserState.gold;
                    const exp = toNum(notify.basic.exp);
                    if (exp > 0) {
                        globalUserState.exp = exp;
                        updateStatusLevel(globalUserState.level, exp);
                    }
                    updateStatusGold(globalUserState.gold);
                    if (globalUserState.level !== oldLevel) {
                        log('系统', `升级! Lv${oldLevel} → Lv${globalUserState.level}`);
                    }
                }
            } catch (e) { }
            return;
        }

        if (type.includes('FriendApplicationReceivedNotify')) {
            try {
                const notify = types.FriendApplicationReceivedNotify.decode(msg.body);
                const applications = notify.applications || [];
                if (applications.length > 0) {
                    globalNetworkEvents.emit('friendApplicationReceived', applications);
                }
            } catch (e) { }
            return;
        }

        if (type.includes('FriendAddedNotify')) {
            try {
                const notify = types.FriendAddedNotify.decode(msg.body);
                const friends = notify.friends || [];
                if (friends.length > 0) {
                    const names = friends.map(f => f.name || f.remark || `GID:${toNum(f.gid)}`).join(', ');
                    log('好友', `新好友: ${names}`);
                }
            } catch (e) { }
            return;
        }

        if (type.includes('GoodsUnlockNotify')) {
            try {
                const notify = types.GoodsUnlockNotify.decode(msg.body);
                const goods = notify.goods_list || [];
                if (goods.length > 0) {
                    log('商店', `解锁 ${goods.length} 个新商品!`);
                }
            } catch (e) { }
            return;
        }

        if (type.includes('TaskInfoNotify')) {
            try {
                const notify = types.TaskInfoNotify.decode(msg.body);
                if (notify.task_info) {
                    globalNetworkEvents.emit('taskInfoNotify', notify.task_info);
                }
            } catch (e) { }
            return;
        }
    } catch (e) {
        logWarn('推送', `解码失败: ${e.message}`);
    }
}

function sendLogin(onLoginSuccess) {
    const body = types.LoginRequest.encode(types.LoginRequest.create({
        sharer_id: toLong(0),
        sharer_open_id: '',
        device_info: CONFIG.device_info,
        share_cfg_id: toLong(0),
        scene_id: '1256',
        report_data: {
            callback: '', cd_extend_info: '', click_id: '', clue_token: '',
            minigame_channel: 'other', minigame_platid: 2, req_id: '', trackid: '',
        },
    })).finish();

    sendMsg('gamepb.userpb.UserService', 'Login', body, (err, bodyBytes, meta) => {
        if (err) {
            log('登录', `失败: ${err.message}`);
            return;
        }
        try {
            const reply = types.LoginReply.decode(bodyBytes);
            if (reply.basic) {
                globalUserState.gid = toNum(reply.basic.gid);
                globalUserState.name = reply.basic.name || '未知';
                globalUserState.level = toNum(reply.basic.level);
                globalUserState.gold = toNum(reply.basic.gold);
                globalUserState.exp = toNum(reply.basic.exp);

                updateStatusFromLogin({
                    name: globalUserState.name,
                    level: globalUserState.level,
                    gold: globalUserState.gold,
                    exp: globalUserState.exp,
                });

                console.log('');
                console.log('========== 登录成功 ==========');
                console.log(`  GID:    ${globalUserState.gid}`);
                console.log(`  昵称:   ${globalUserState.name}`);
                console.log(`  等级:   ${globalUserState.level}`);
                console.log(`  金币:   ${globalUserState.gold}`);
                if (reply.time_now_millis) {
                    syncServerTime(toNum(reply.time_now_millis));
                    console.log(`  时间:   ${new Date(toNum(reply.time_now_millis)).toLocaleString()}`);
                }
                console.log('===============================');
                console.log('');
            }

            startHeartbeat();
            if (onLoginSuccess) onLoginSuccess();
        } catch (e) {
            log('登录', `解码失败: ${e.message}`);
        }
    });
}

let lastHeartbeatResponse = Date.now();
let heartbeatMissCount = 0;

function startHeartbeat() {
    if (globalHeartbeatTimer) clearInterval(globalHeartbeatTimer);
    lastHeartbeatResponse = Date.now();
    heartbeatMissCount = 0;
    
    globalHeartbeatTimer = setInterval(() => {
        if (!globalUserState.gid) return;
        
        const timeSinceLastResponse = Date.now() - lastHeartbeatResponse;
        if (timeSinceLastResponse > 60000) {
            heartbeatMissCount++;
            logWarn('心跳', `连接可能已断开 (${Math.round(timeSinceLastResponse/1000)}s 无响应)`);
            if (heartbeatMissCount >= 2) {
                globalPendingCallbacks.forEach((cb) => {
                    try { cb(new Error('连接超时，已清理')); } catch (e) {}
                });
                globalPendingCallbacks.clear();
            }
        }
        
        const body = types.HeartbeatRequest.encode(types.HeartbeatRequest.create({
            gid: toLong(globalUserState.gid),
            client_version: CONFIG.clientVersion,
        })).finish();
        sendMsg('gamepb.userpb.UserService', 'Heartbeat', body, (err, replyBody) => {
            if (err || !replyBody) return;
            lastHeartbeatResponse = Date.now();
            heartbeatMissCount = 0;
            try {
                const reply = types.HeartbeatReply.decode(replyBody);
                if (reply.server_time) syncServerTime(toNum(reply.server_time));
            } catch (e) { }
        });
    }, CONFIG.heartbeatInterval);
}

function connect(code, onLoginSuccess) {
    const url = `${CONFIG.serverUrl}?platform=${CONFIG.platform}&os=${CONFIG.os}&ver=${CONFIG.clientVersion}&code=${code}&openID=`;

    globalWs = new WebSocket(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13)',
            'Origin': 'https://gate-obt.nqf.qq.com',
        },
    });

    globalWs.binaryType = 'arraybuffer';

    globalWs.on('open', () => {
        sendLogin(onLoginSuccess);
    });

    globalWs.on('message', (data) => {
        handleMessage(Buffer.isBuffer(data) ? data : Buffer.from(data));
    });

    globalWs.on('close', (code, reason) => {
        console.log(`[WS] 连接关闭 (code=${code})`);
        cleanup();
    });

    globalWs.on('error', (err) => {
        logWarn('WS', `错误: ${err.message}`);
    });
}

function cleanup() {
    if (globalHeartbeatTimer) { clearInterval(globalHeartbeatTimer); globalHeartbeatTimer = null; }
    globalPendingCallbacks.clear();
}

function getWs() { return globalWs; }

module.exports = {
    createNetworkInstance,
    connect,
    cleanup,
    getWs,
    sendMsg,
    sendMsgAsync,
    getUserState,
    networkEvents: globalNetworkEvents,
};
