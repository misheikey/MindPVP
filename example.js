const { Vec3 } = require('vec3');

class ExamplePlugin {
  constructor(bot, pluginManager) {
    this.name = 'ExamplePlugin';
    this.bot = bot;
    this.pm = pluginManager;
  }

  async onLoad() {
    console.log('🎯 示例插件已加载');
    this.pm.registerHook('beforeAttack', this.onBeforeAttack.bind(this));
    this.pm.registerHook('onChat', this.onChat.bind(this));
    this.pm.registerHook('onHealthChange', this.onHealthChange.bind(this));
  }

  onBeforeAttack(target) {
    console.log(`[插件] 准备攻击 ${target.name || target.username || '实体'}`);
    return true;
  }

  onChat(username, message) {
    console.log(`[插件] 聊天: ${username}: ${message}`);
    if (message === '!come') {
      const player = this.bot.players[username];
      if (player && player.entity) {
        this.bot.navigate.to(player.entity.position);
      }
    }
  }

  onHealthChange(health, oldHealth) {
    if (health < 5) {
      console.log(`[插件] 警告！血量过低: ${health}`);
    }
  }
}

module.exports = ExamplePlugin;