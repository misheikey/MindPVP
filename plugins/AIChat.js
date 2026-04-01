// plugins/ai-chat.js
/**
 * AI 聊天插件（最终稳定版）
 * - 严格过滤所有非 ASCII 可打印字符（包括控制字符、中文、emoji 等）
 * - 限制消息长度 ≤ 100 字符
 * - 内置模拟回复，可选接入真实 AI API
 */
class AIChatPlugin {
  constructor(bot, pluginManager) {
    this.name = 'AIChat';
    this.bot = bot;
    this.pm = pluginManager;
    this.interval = null;
    this.hasGreeted = false;
    
    // ========== AI API 配置（可选） ==========
    this.apiUrl = 'https://platform.aitools.cfd/api/v1/chat/completions';
    this.apiKey = 'sk-a82aecf7e1374a8ab4545f4fab2b2f6a';   // 替换为真实 Key
    this.model = 'qwen/qwen2.5-7b';
    // ========================================
  }

  async onLoad() {
    console.log('🤖 AI 聊天插件已加载');
    this.bot.on('chat', (username, message) => {
      this.onChat(username, message);
    });
    this.interval = setInterval(() => {
      this.sendStatusMessage();
    }, 60 * 1000);
    setTimeout(() => {
      if (!this.hasGreeted) {
        this.sendGreeting();
        this.hasGreeted = true;
      }
    }, 5000);
  }

  async onUnload() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    console.log('🤖 AI 聊天插件已卸载');
  }

  /**
   * 严格消息净化：只保留 ASCII 可打印字符（32-126），移除所有控制字符、中文、emoji 等
   */
  sanitizeMessage(msg) {
    // 移除所有非可打印 ASCII（包括换行、制表等控制字符）
    let cleaned = msg.replace(/[^\x20-\x7E]/g, '');
    // 限制长度（Minecraft 聊天消息通常 ≤100 字符）
    if (cleaned.length > 100) cleaned = cleaned.slice(0, 100);
    return cleaned.trim();
  }

  /**
   * 安全发送消息
   */
  safeChat(message) {
    const clean = this.sanitizeMessage(message);
    if (!clean) return;
    try {
      this.bot.chat(clean);
    } catch (err) {
      console.log(`❌ 发送消息失败: ${err.message}`);
    }
  }

  /**
   * 获取 AI 回复（模拟或真实 API）
   */
  async getAIResponse(prompt) {
    // 若未配置真实 API，使用模拟回复
    if (!this.apiKey || this.apiKey === 'YOUR_API_KEY') {
      return this.fallbackResponse(prompt);
    }

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 100,
          temperature: 0.7
        })
      });
      const data = await response.json();
      if (data.error) {
        console.log('API 错误:', data.error.message);
        return this.fallbackResponse(prompt);
      }
      let reply = data.choices[0].message.content;
      return this.sanitizeMessage(reply);
    } catch (err) {
      console.log('API 调用失败:', err.message);
      return this.fallbackResponse(prompt);
    }
  }

  /**
   * 模拟回复（纯英文 ASCII）
   */
  fallbackResponse(prompt) {
    const p = prompt.toLowerCase();
    if (p.includes('greeting') || p.includes('hello')) {
      return `Hello everyone, I'm ${this.bot.username}!`;
    }
    if (p.includes('status')) {
      const health = this.bot.health.toFixed(1);
      const food = this.bot.food;
      return `Health: ${health}/20, Hunger: ${food}/20. ${health < 8 ? 'Need help!' : 'Doing fine.'}`;
    }
    if (p.includes('reply')) {
      return "I hear you.";
    }
    return "I hear you.";
  }

  async sendGreeting() {
    const prompt = `Generate a short Minecraft greeting. I am ${this.bot.username}.`;
    const message = await this.getAIResponse(prompt);
    this.safeChat(message);
    console.log(`[AI] Greeting: ${message}`);
  }

  async sendStatusMessage() {
    const nearby = this.getNearbyEntitiesInfo();
    const prompt = `Current health ${this.bot.health.toFixed(1)}/20, hunger ${this.bot.food}/20, nearby: ${nearby}. Describe my state humorously.`;
    const message = await this.getAIResponse(prompt);
    this.safeChat(message);
    console.log(`[AI] Status: ${message}`);
  }

  getNearbyEntitiesInfo() {
    const entities = [];
    for (const id in this.bot.entities) {
      const e = this.bot.entities[id];
      if (e && e.type === 'mob' && e.name) {
        const dist = e.position.distanceTo(this.bot.entity.position);
        if (dist < 20) {
          entities.push(`${e.name}(${Math.round(dist)}m)`);
        }
      }
    }
    if (entities.length === 0) return "no mobs";
    return entities.slice(0, 3).join(', ');
  }

  async onChat(username, message) {
    if (username === this.bot.username) return;
    const mention = `@${this.bot.username}`;
    if (message.includes(mention)) {
      console.log(`[AI] Mentioned by ${username}, replying...`);
      let userMsg = message.replace(mention, '').trim();
      if (!userMsg) userMsg = "what are you doing?";
      const prompt = `Player ${username} says to you: ${userMsg}. Reply shortly and friendly.`;
      let reply = await this.getAIResponse(prompt);
      this.safeChat(reply);
      console.log(`[AI] Reply to ${username}: ${reply}`);
    }
  }
}

module.exports = AIChatPlugin;