const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');
const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { loader: autoEatLoader } = require('mineflayer-auto-eat');

// ========== 配置 ==========
const CONFIG = {
  // 基础行为
  safeHealth: 12,
  runAwayHealth: 10,
  stopRunAwayHealth: 15,
  attackRange: 3,
  followRange: 100,
  woodRange: 100,
  jumpCheckDist: 0.8,
  attackCooldown: 500,
  // 网络与重连
  reconnectDelay: 5000,
  heartbeatInterval: 15000,
  digTimeout: 10000,
  // 弓箭
  bowRange: 15,
  arrowSpeed: 1.5,
  gravity: 0.05,
  bowDrawTime: 600,
  // 逃跑
  runAwayJumpInterval: 300,
  // Web
  webPort: 3000,
};

// ========== 插件管理器 ==========
class PluginManager {
  constructor(bot) {
    this.bot = bot;
    this.plugins = new Map();
    this.hooks = {
      beforeAttack: [],
      afterAttack: [],
      beforeCombat: [],
      afterCombat: [],
      onChat: [],
      onEntitySpawn: [],
      onEntityDeath: [],
      onHealthChange: [],
      onFoodChange: [],
      onTick: [],
      onBotSpawn: [],
      onBotError: [],
      onBotEnd: [],
    };
  }

  async loadPlugins() {
    // 这里不再从文件加载，而是直接注册内置插件
    // 你可以在这里添加其他内置插件
    console.log('📦 使用内置插件系统');
    // 如果希望从 plugins 目录加载外部插件，可取消注释以下代码
    /*
    if (!fs.existsSync(CONFIG.pluginsDir)) {
      fs.mkdirSync(CONFIG.pluginsDir, { recursive: true });
      console.log(`📁 创建插件目录: ${CONFIG.pluginsDir}`);
      return;
    }
    const files = fs.readdirSync(CONFIG.pluginsDir);
    for (const file of files) {
      if (file.endsWith('.js')) {
        try {
          const pluginPath = path.resolve(CONFIG.pluginsDir, file);
          const PluginClass = require(pluginPath);
          const plugin = new PluginClass(this.bot, this);
          await plugin.onLoad();
          this.plugins.set(plugin.name || file, plugin);
          console.log(`🔌 加载插件: ${plugin.name || file}`);
        } catch (err) {
          console.log(`❌ 加载插件失败 ${file}:`, err.message);
        }
      }
    }
    */
  }

  registerHook(hookName, callback) {
    if (this.hooks[hookName]) this.hooks[hookName].push(callback);
  }

  async executeHook(hookName, ...args) {
    if (!this.hooks[hookName]) return true;
    for (const callback of this.hooks[hookName]) {
      try {
        const result = await callback(...args);
        if (result === false) return false;
      } catch (err) {
        console.log(`❌ 插件钩子 ${hookName} 执行错误:`, err.message);
      }
    }
    return true;
  }

  async unloadPlugins() {
    for (const [name, plugin] of this.plugins) {
      try {
        if (plugin.onUnload) await plugin.onUnload();
        console.log(`🔌 卸载插件: ${name}`);
      } catch (err) {
        console.log(`❌ 卸载插件失败 ${name}:`, err.message);
      }
    }
    this.plugins.clear();
  }
}

// ========== AutoEat 内置插件 ==========
class AutoEatPlugin {
  constructor(bot, pluginManager) {
    this.name = 'AutoEat';
    this.bot = bot;
    this.pm = pluginManager;
    this.enabled = false;
  }

  async onLoad() {
    // 加载 auto-eat 插件到 bot 实例
    this.bot.loadPlugin(autoEatLoader);

    // 配置自动进食选项
    this.bot.autoEat.setOpts({
      priority: "foodPoints",           // 食物选择优先级
      minHunger: 18,                    // 饥饿值 ≤18 时开始吃
      minHealth: 12,                    // 血量 ≤12 时优先吃高饱和度食物
      returnToLastItem: true,           // 吃完后恢复之前手持的物品
      offhand: false,                   // 是否用副手吃
      eatingTimeout: 5000,              // 进食超时（毫秒）
      bannedFood: [                     // 禁止吃的食物
        "rotten_flesh",
        "pufferfish",
        "chorus_fruit",
        "poisonous_potato",
        "spider_eye"
      ],
      // 自定义食物优先级（按食物名称）
      foodPriority: [
        "golden_apple",
        "cooked_beef",
        "cooked_chicken",
        "cooked_porkchop",
        "bread",
        "apple",
        "baked_potato",
        "carrot"
      ]
    });

    // 启用自动进食
    this.bot.autoEat.enableAuto();
    this.enabled = true;

    // 监听事件（可选）
    this.bot.autoEat.on('eatStart', (data) => {
      console.log(`🍽️ 开始吃 ${data.food.name} (饥饿:${data.foodLevel} 血量:${data.health})`);
    });

    this.bot.autoEat.on('eatFinish', (data) => {
      console.log(`✅ 吃完 ${data.food.name} (饥饿:${data.foodLevel} 血量:${data.health})`);
    });

    this.bot.autoEat.on('eatFail', (error) => {
      console.log(`❌ 进食失败: ${error}`);
    });

    console.log('🍽️ AutoEat 插件已加载');
  }

  async onUnload() {
    if (this.enabled && this.bot.autoEat) {
      this.bot.autoEat.disableAuto();
      this.bot.autoEat.removeAllListeners();
    }
    console.log('🍽️ AutoEat 插件已卸载');
  }
}

// ========== 机器人类 ==========
class BotPlayer {
  constructor(username, host, port, version = '1.21.8') {
    this.username = username;
    this.host = host;
    this.port = port;
    this.version = version;
    this.bot = null;
    this.pluginManager = null;
    this.isDigging = false;
    this.isShooting = false;
    this.isRunningAway = false;
    this.lastAttackTime = 0;
    this.runAwayStartTime = null;
    this.lastHealth = 20;
    this.lastFood = 20;
    this.digTimeoutId = null;
    this.heartbeatInterval = null;
    this.reconnectTimer = null;
    this.mainLoopInterval = null;
    this.armorInterval = null;
    this.runAwayJumpTimer = null;
    this.shouldReconnect = true;

    this.createBot();
  }

  createBot() {
    if (this.bot) this.cleanup();
    this.bot = mineflayer.createBot({
      host: this.host,
      port: this.port,
      username: this.username,
      version: this.version,
      auth: 'offline',
      connectTimeout: 30000,
      checkTimeoutInterval: 60000,
    });
    this.initEvents();
  }

  cleanup() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.mainLoopInterval) clearInterval(this.mainLoopInterval);
    if (this.armorInterval) clearInterval(this.armorInterval);
    if (this.digTimeoutId) clearTimeout(this.digTimeoutId);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.runAwayJumpTimer) clearInterval(this.runAwayJumpTimer);
    if (this.pluginManager) this.pluginManager.unloadPlugins();
    if (this.bot) this.bot.removeAllListeners();
  }

  async initPlugins() {
    this.pluginManager = new PluginManager(this.bot);
    await this.pluginManager.loadPlugins();

    // 注册内置 AutoEat 插件
    const autoEatPlugin = new AutoEatPlugin(this.bot, this.pluginManager);
    await autoEatPlugin.onLoad();
    this.pluginManager.plugins.set('AutoEat', autoEatPlugin);

    // 绑定内置钩子
    this.bot.on('chat', (username, message) => {
      this.pluginManager.executeHook('onChat', username, message);
    });
    this.bot.on('entitySpawn', (entity) => {
      this.pluginManager.executeHook('onEntitySpawn', entity);
    });
    this.bot.on('entityDeath', (entity) => {
      this.pluginManager.executeHook('onEntityDeath', entity);
    });
    setInterval(() => {
      if (this.bot.health !== this.lastHealth) {
        const old = this.lastHealth;
        this.lastHealth = this.bot.health;
        this.pluginManager.executeHook('onHealthChange', this.bot.health, old);
      }
      if (this.bot.food !== this.lastFood) {
        const old = this.lastFood;
        this.lastFood = this.bot.food;
        this.pluginManager.executeHook('onFoodChange', this.bot.food, old);
      }
    }, 200);
  }

  initEvents() {
    const bot = this.bot;
    bot.once('spawn', async () => {
      console.log(`✅ ${this.username} 已连接`);
      await this.initPlugins();
      this.pluginManager.executeHook('onBotSpawn');
      setTimeout(() => {
        if (this.bot && this.bot.entity) {
          this.bot.clearControlStates();
          this.startMainLoop();
          this.startHeartbeat();
          this.startPeriodicTasks();
        }
      }, 1000);
    });
    bot.on('error', (err) => {
      console.log(`⚠️ ${this.username} 连接错误:`, err.message);
      this.pluginManager.executeHook('onBotError', err);
    });
    bot.on('end', (reason) => {
      console.log(`🔌 ${this.username} 断开连接: ${reason || '未知原因'}`);
      this.pluginManager.executeHook('onBotEnd', reason);
      this.cleanup();
      if (this.shouldReconnect) {
        console.log(`🔄 ${this.username} 将在 ${CONFIG.reconnectDelay / 1000} 秒后重连...`);
        this.reconnectTimer = setTimeout(() => this.createBot(), CONFIG.reconnectDelay);
      }
    });
    bot.on('kicked', (reason) => {
      console.log(`👢 ${this.username} 被踢出: ${reason}`);
      this.pluginManager.executeHook('onBotEnd', `kicked: ${reason}`);
      this.cleanup();
      if (this.shouldReconnect) {
        console.log(`🔄 ${this.username} 将在 ${CONFIG.reconnectDelay / 1000} 秒后重连...`);
        this.reconnectTimer = setTimeout(() => this.createBot(), CONFIG.reconnectDelay);
      }
    });
  }

  startPeriodicTasks() {
    this.armorInterval = setInterval(() => {
      if (this.bot && this.bot.entity && this.bot.inventory) {
        this.autoEquipArmor();
        this.autoEquipTotem();
      }
    }, 1500);
  }

  startHeartbeat() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = setInterval(() => {
      this.pluginManager.executeHook('onTick');
    }, CONFIG.heartbeatInterval);
  }

  startMainLoop() {
    if (this.mainLoopInterval) clearInterval(this.mainLoopInterval);
    this.mainLoopInterval = setInterval(() => {
      if (!this.bot || !this.bot.entity || !this.bot.inventory) return;
      const hasTotem = this.hasTotemInOffhand();
      if (!hasTotem && this.bot.health < CONFIG.runAwayHealth) {
        if (!this.isRunningAway) this.startRunAway();
        if (this.isRunningAway) {
          this.runAwayTick();
          return;
        }
      } else if (this.isRunningAway && this.bot.health >= CONFIG.stopRunAwayHealth) {
        this.stopRunAway();
      }
      this.executeCombatLogic();
    }, 200);
  }

  async executeCombatLogic() {
    const enemy = this.getNearestHostileEntity();
    if (!enemy) {
      const player = this.getNearestPlayer();
      if (player) this.follow(player);
      else {
        const wood = this.getNearestWood();
        if (wood) this.digWood(wood);
        else this.stopAll();
      }
      return;
    }
    const canAttack = await this.pluginManager.executeHook('beforeAttack', enemy);
    if (canAttack === false) return;
    const dist = enemy.position.distanceTo(this.bot.entity.position);
    if (dist > CONFIG.bowRange && this.hasBow() && this.hasArrow() && !this.isShooting) {
      this.shootAt(enemy);
      await this.pluginManager.executeHook('afterAttack', enemy, 'ranged');
    } else if (dist <= CONFIG.attackRange) {
      this.autoEquipSword();
      this.attack(enemy);
      await this.pluginManager.executeHook('afterAttack', enemy, 'melee');
    } else {
      this.autoEquipSword();
      this.bot.lookAt(enemy.position.offset(0, 1.2, 0), true);
      this.bot.setControlState('forward', true);
      this.autoJump();
    }
  }

  startRunAway() {
    console.log(`🏃 开始逃跑 (血量 ${this.bot.health})`);
    this.isRunningAway = true;
    this.runAwayStartTime = Date.now();
    this.bot.setControlState('sprint', true);
    this.runAwayJumpTimer = setInterval(() => {
      if (this.isRunningAway) {
        this.bot.setControlState('jump', true);
        setTimeout(() => this.bot.setControlState('jump', false), 100);
      }
    }, CONFIG.runAwayJumpInterval);
  }

  stopRunAway() {
    console.log(`🏃 停止逃跑 (血量 ${this.bot.health})`);
    this.isRunningAway = false;
    this.runAwayStartTime = null;
    if (this.runAwayJumpTimer) {
      clearInterval(this.runAwayJumpTimer);
      this.runAwayJumpTimer = null;
    }
    this.bot.setControlState('sprint', false);
    this.bot.setControlState('forward', false);
    this.bot.setControlState('jump', false);
  }

  runAwayTick() {
    const enemy = this.getNearestHostileEntity();
    if (enemy) {
      const dir = this.bot.entity.position.minus(enemy.position).normalize();
      const yaw = Math.atan2(dir.z, dir.x);
      this.bot.look(yaw, 0, true);
    }
    this.bot.setControlState('forward', true);
  }

  // ---------- 攻击相关 ----------
  getNearestHostileEntity() {
    const mob = this.getNearestHostileMob();
    const player = this.getNearestHostilePlayer();
    const candidates = [];
    if (mob) candidates.push(mob);
    if (player) candidates.push(player);
    if (candidates.length === 0) return null;
    return candidates.sort((a, b) => a.position.distanceTo(this.bot.entity.position) - b.position.distanceTo(this.bot.entity.position))[0];
  }

  getNearestHostileMob() {
    const hostile = ['zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'drowned', 'witch', 'blaze'];
    let closest = null, minDist = Infinity;
    for (const id in this.bot.entities) {
      const e = this.bot.entities[id];
      if (e && e.name && hostile.includes(e.name.toLowerCase())) {
        const dist = e.position.distanceTo(this.bot.entity.position);
        if (dist < minDist) { minDist = dist; closest = e; }
      }
    }
    return closest;
  }

  getNearestHostilePlayer() {
    let closest = null, minDist = Infinity;
    for (const name in this.bot.players) {
      if (name === this.username) continue;
      const player = this.bot.players[name];
      if (player.entity) {
        const dist = player.entity.position.distanceTo(this.bot.entity.position);
        if (dist < minDist) { minDist = dist; closest = player.entity; }
      }
    }
    return closest;
  }

  attack(entity) {
    const now = Date.now();
    if (now - this.lastAttackTime < CONFIG.attackCooldown) return;
    this.lastAttackTime = now;
    const dist = entity.position.distanceTo(this.bot.entity.position);
    this.bot.lookAt(entity.position.offset(0, 1.2, 0), true);
    if (dist < CONFIG.attackRange) this.bot.attack(entity);
    else { this.bot.setControlState('forward', true); this.autoJump(); }
  }

  // ---------- 弓箭相关 ----------
  hasBow() {
    if (!this.bot.inventory) return false;
    const bows = ['bow', 'crossbow'];
    return this.bot.inventory.items().some(item => bows.includes(item.name));
  }

  hasArrow() {
    if (!this.bot.inventory) return false;
    const arrows = ['arrow', 'tipped_arrow', 'spectral_arrow'];
    return this.bot.inventory.items().some(item => arrows.includes(item.name));
  }

  calculateAngle(targetPos) {
    const pos = this.bot.entity.position;
    const dx = targetPos.x - pos.x, dz = targetPos.z - pos.z;
    const dy = targetPos.y - (pos.y + 1.6);
    const d = Math.sqrt(dx*dx + dz*dz);
    const v = CONFIG.arrowSpeed, g = CONFIG.gravity, v2 = v*v, gd = g*d;
    const inside = v2*v2 - g*(g*d*d + 2*v2*dy);
    if (inside < 0) return null;
    const sqrtInside = Math.sqrt(inside);
    const tan1 = (v2 + sqrtInside) / gd;
    const tan2 = (v2 - sqrtInside) / gd;
    let tan = Math.min(tan1, tan2);
    if (tan < 0) tan = Math.max(tan1, tan2);
    if (tan <= 0) return null;
    return Math.atan(tan);
  }

  shootAt(entity) {
    if (this.isShooting) return;
    if (!this.hasBow() || !this.hasArrow()) return;
    console.log(`🏹 尝试远程射击 ${entity.name || '玩家'}`);
    this.isShooting = true;
    this.stopAll();
    const bowItem = this.bot.inventory.items().find(item => item.name === 'bow' || item.name === 'crossbow');
    if (!bowItem) { this.isShooting = false; return; }
    const targetPos = entity.position.offset(0, 1.2, 0);
    const angle = this.calculateAngle(targetPos);
    if (angle === null) {
      console.log(`⚠️ 无法计算射击角度`);
      this.isShooting = false;
      return;
    }
    const dx = targetPos.x - this.bot.entity.position.x;
    const dz = targetPos.z - this.bot.entity.position.z;
    const yaw = Math.atan2(dz, dx);
    const pitch = angle;
    this.bot.look(yaw, pitch, true, () => {
      this.bot.equip(bowItem, 'hand', (err) => {
        if (err) { console.log(`❌ 装备弓失败`, err.message); this.isShooting = false; return; }
        this.bot.activateItem();
        setTimeout(() => {
          this.bot.deactivateItem();
          console.log(`🏹 射箭完成`);
          setTimeout(() => { this.isShooting = false; }, 500);
        }, CONFIG.bowDrawTime);
      });
    });
  }

  // ---------- 自动装备 ----------
  autoEquipArmor() {
    if (!this.bot.inventory) return;
    const armorMap = {
      helmet: { slot: 'head', index: 5 },
      chestplate: { slot: 'torso', index: 6 },
      leggings: { slot: 'legs', index: 7 },
      boots: { slot: 'feet', index: 8 }
    };
    for (const [type, info] of Object.entries(armorMap)) {
      if (this.bot.inventory.slots[info.index]) continue;
      const armorItem = this.bot.inventory.items().find(i => i.name.includes(type));
      if (armorItem) try { this.bot.equip(armorItem, info.slot, () => {}); } catch(e) {}
    }
  }

  autoEquipSword() {
    if (!this.bot.inventory) return;
    const swords = ['wooden_sword', 'stone_sword', 'iron_sword', 'golden_sword', 'diamond_sword', 'netherite_sword'];
    const sword = this.bot.inventory.items().find(i => swords.includes(i.name));
    if (sword) {
      const heldItem = this.bot.heldItem;
      if (!heldItem || !swords.includes(heldItem.name)) {
        try { this.bot.equip(sword, 'hand', () => {}); console.log(`⚔️ 切换至剑`); } catch(e) {}
      }
    }
  }

  autoEquipTotem() {
    if (!this.bot.inventory) return;
    const offHandSlot = this.bot.inventory.slots[45];
    if (offHandSlot && offHandSlot.name === 'totem_of_undying') return;
    const totem = this.bot.inventory.items().find(item => item.name === 'totem_of_undying');
    if (totem) {
      try { this.bot.equip(totem, 'off-hand', () => {}); console.log(`🛡️ 装备不死图腾到副手`); } catch(e) {}
    }
  }

  // ---------- 其他功能 ----------
  digWood(block) {
    if (this.isDigging) return;
    const dist = block.position.distanceTo(this.bot.entity.position);
    if (dist > 3.2) {
      this.bot.lookAt(block.position, true);
      this.bot.setControlState('forward', true);
      this.autoJump();
      return;
    }
    this.stopAll();
    this.isDigging = true;
    this.bot.lookAt(block.position, true);
    this.digTimeoutId = setTimeout(() => {
      if (this.isDigging) { console.log(`⚠️ 挖掘超时`); this.isDigging = false; this.bot.clearControlStates(); }
    }, CONFIG.digTimeout);
    try {
      this.bot.dig(block, (err) => {
        clearTimeout(this.digTimeoutId);
        this.isDigging = false;
        if (err) console.log(`❌ 挖掘失败:`, err.message);
      });
    } catch(err) { clearTimeout(this.digTimeoutId); this.isDigging = false; console.log(`❌ 挖掘异常:`, err.message); }
  }

  follow(player) {
    const dist = player.position.distanceTo(this.bot.entity.position);
    this.bot.lookAt(player.position.offset(0, 1.2, 0), true);
    if (dist > 2) { this.bot.setControlState('forward', true); this.autoJump(); }
    else this.bot.setControlState('forward', false);
  }

  getNearestPlayer() {
    let closest = null, minDist = Infinity;
    for (const name in this.bot.players) {
      if (name === this.username) continue;
      const player = this.bot.players[name];
      if (player.entity) {
        const dist = player.entity.position.distanceTo(this.bot.entity.position);
        if (dist < minDist && dist < CONFIG.followRange) { minDist = dist; closest = player.entity; }
      }
    }
    return closest;
  }

  hasTotemInOffhand() {
    if (!this.bot.inventory) return false;
    const offHandSlot = this.bot.inventory.slots[45];
    return offHandSlot && offHandSlot.name === 'totem_of_undying';
  }

  autoJump() {
    const yaw = this.bot.entity.yaw;
    const dx = Math.sin(yaw) * CONFIG.jumpCheckDist;
    const dz = -Math.cos(yaw) * CONFIG.jumpCheckDist;
    const checkPos = this.bot.entity.position.offset(dx, 0, dz);
    const block = this.bot.blockAt(checkPos);
    if (!block || block.boundingBox !== 'block') return;
    const height = block.position.y - Math.floor(this.bot.entity.position.y);
    if (height >= 0.9 && height <= 1.1) {
      this.bot.setControlState('jump', true);
      setTimeout(() => this.bot.setControlState('jump', false), 350);
    }
  }

  getNearestWood() {
    const woods = ['oak_log','birch_log','spruce_log','jungle_log','acacia_log','dark_oak_log'];
    return this.bot.findBlock({ matching: b => woods.includes(b.name), maxDistance: CONFIG.woodRange });
  }

  stopAll() {
    this.bot.clearControlStates();
  }

  getStatus() {
    const pos = this.bot.entity ? this.bot.entity.position : { x: 0, y: 0, z: 0 };
    return {
      username: this.username,
      health: Math.round(this.bot.health),
      food: Math.round(this.bot.food),
      position: { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) },
      hasTotem: this.hasTotemInOffhand(),
      isRunningAway: this.isRunningAway,
      isShooting: this.isShooting,
      isDigging: this.isDigging,
      plugins: Array.from(this.pluginManager.plugins.keys()),
    };
  }
}

// ========== 启动机器人 ==========
const HOST = '127.0.0.1';
const PORT = 25565;
const VERSION = '1.21.8';
const bot = new BotPlayer('AIBot', HOST, PORT, VERSION);

// ========== Web 管理后台 ==========
const app = express();
const server = http.createServer(app);

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Minecraft Bot 监控</title>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f0f0f0; }
        .container { max-width: 600px; margin: auto; background: white; padding: 20px; border-radius: 8px; }
        h1 { color: #333; text-align: center; }
        .status { margin: 15px 0; padding: 10px; background: #f9f9f9; border-radius: 4px; }
        .label { font-weight: bold; display: inline-block; width: 140px; }
        .health { color: #d9534f; }
        .food { color: #5bc0de; }
        .running { color: #f0ad4e; }
        hr { margin: 20px 0; }
        button { margin: 10px 0; padding: 5px 10px; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🤖 Minecraft Bot 状态</h1>
        <div id="data">加载中...</div>
        <hr>
        <div style="text-align: center;">
          <button onclick="fetchStatus()">🔄 手动刷新</button>
          <span style="margin-left: 10px;">自动更新 (1秒)</span>
        </div>
        <small>最后更新: <span id="time"></span></small>
      </div>
      <script>
        async function fetchStatus() {
          try {
            const resp = await fetch('/status');
            const data = await resp.json();
            document.getElementById('data').innerHTML = \`
              <div class="status"><span class="label">用户名:</span> <span class="value">\${data.username}</span></div>
              <div class="status"><span class="label">❤️ 血量:</span> <span class="value health">\${data.health} / 20</span></div>
              <div class="status"><span class="label">🍗 饥饿值:</span> <span class="value food">\${data.food} / 20</span></div>
              <div class="status"><span class="label">📍 位置:</span> <span class="value">\${data.position.x}, \${data.position.y}, \${data.position.z}</span></div>
              <div class="status"><span class="label">🛡️ 副手图腾:</span> <span class="value">\${data.hasTotem ? '✅ 有' : '❌ 无'}</span></div>
              <div class="status"><span class="label">🏃 逃跑状态:</span> <span class="value running">\${data.isRunningAway ? '🏃‍♂️ 正在逃跑' : '🚶 正常'}</span></div>
              <div class="status"><span class="label">🏹 射击状态:</span> <span class="value">\${data.isShooting ? '✅ 是' : '❌ 否'}</span></div>
              <div class="status"><span class="label">⛏️ 挖掘状态:</span> <span class="value">\${data.isDigging ? '✅ 是' : '❌ 否'}</span></div>
              <div class="status"><span class="label">🔌 插件:</span> <span class="value">\${data.plugins.join(', ') || '无'}</span></div>
            \`;
            document.getElementById('time').innerText = new Date().toLocaleTimeString();
          } catch(e) {
            document.getElementById('data').innerHTML = '<div class="status">加载失败</div>';
          }
        }
        fetchStatus();
        setInterval(fetchStatus, 1000);
      </script>
    </body>
    </html>
  `);
});

app.get('/status', (req, res) => {
  res.json(bot.getStatus());
});

server.listen(CONFIG.webPort, () => {
  console.log(`🌐 Web 后台: http://localhost:${CONFIG.webPort}`);
});

process.on('SIGINT', () => {
  console.log('\n🛑 关闭...');
  server.close();
  bot.cleanup();
  process.exit();
});

console.log('🤖 机器人启动，已集成 AutoEat 插件（官方 consume 方法）');