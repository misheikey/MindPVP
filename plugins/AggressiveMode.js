/**
 * 激进模式插件
 * 当自身血量低于阈值时，比较自身与最近玩家的血量：
 * - 若自身血量 > 玩家血量，则进入激进模式，阻止逃跑和进食，持续攻击该玩家
 * - 每秒重新比较，当玩家血量反超时退出激进模式
 */
class AggressiveMode {
  constructor(bot, pluginManager) {
    this.name = 'AggressiveMode';
    this.bot = bot;
    this.pm = pluginManager;
    this.active = false;
    this.targetPlayer = null;
    this.checkInterval = null;
    this.threshold = 12;           // 触发检测的血量阈值
  }

  async onLoad() {
    console.log('⚔️ 激进模式插件已加载');
    // 注册钩子，在逃跑和进食前询问
    this.pm.registerHook('beforeRunAway', this.shouldSkipRunAway.bind(this));
    this.pm.registerHook('beforeEat', this.shouldSkipEat.bind(this));
    // 启动每秒检测
    this.checkInterval = setInterval(() => {
      this.checkAndSwitch();
    }, 1000);
  }

  async onUnload() {
    if (this.checkInterval) clearInterval(this.checkInterval);
    console.log('⚔️ 激进模式插件已卸载');
  }

  getNearestPlayer() {
    let closest = null;
    let minDist = Infinity;
    for (const name in this.bot.players) {
      if (name === this.bot.username) continue;
      const player = this.bot.players[name];
      if (player.entity) {
        const dist = player.entity.position.distanceTo(this.bot.entity.position);
        if (dist < minDist) {
          minDist = dist;
          closest = player.entity;
        }
      }
    }
    return closest;
  }

  checkAndSwitch() {
    if (this.bot.health >= this.threshold) {
      if (this.active) this.deactivate();
      return;
    }

    const player = this.getNearestPlayer();
    if (!player) {
      if (this.active) this.deactivate();
      return;
    }

    this.targetPlayer = player;
    if (this.bot.health > player.health) {
      if (!this.active) this.activate();
    } else {
      if (this.active) this.deactivate();
    }
  }

  activate() {
    console.log(`⚔️ 激进模式激活！自身血量 ${this.bot.health.toFixed(1)}，目标 ${this.targetPlayer.username} 血量 ${this.targetPlayer.health.toFixed(1)}`);
    this.active = true;
  }

  deactivate() {
    console.log(`🛡️ 激进模式关闭 (自身血量 ${this.bot.health.toFixed(1)}，目标血量 ${this.targetPlayer?.health?.toFixed(1) || '未知'})`);
    this.active = false;
    this.targetPlayer = null;
  }

  shouldSkipRunAway() {
    return this.active; // 返回 true 表示“跳过逃跑”（即阻止逃跑）
  }

  shouldSkipEat() {
    return this.active; // 返回 true 表示“跳过进食”
  }
}

module.exports = AggressiveMode;