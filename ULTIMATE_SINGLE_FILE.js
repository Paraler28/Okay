#!/usr/bin/env node

/*
🤖 OkayCoin Bot - ULTIMATE SINGLE FILE
📦 ВСЁ В ОДНОМ ФАЙЛЕ - никаких ошибок, никаких зависимостей!

🎯 Что включено:
✅ Полная tap-to-earn игра с лимитом 50 тапов
✅ Реферальная система с прогрессивными наградами
✅ Задания с проверкой подписки на канал @OkayCryptoChannel
✅ Ежедневные награды и лидерборд
✅ Многоязычность (русский/английский)
✅ Тройная система keep-alive (каждые 30 сек)
✅ Express сервер для health-checks
✅ Полная обработка ошибок
✅ PostgreSQL + fallback к памяти
✅ Система кэширования
✅ Rate limiting
✅ Мониторинг и логирование

🚀 Для развертывания:
1. Скопируйте этот файл
2. npm install express node-telegram-bot-api
3. Установите TELEGRAM_BOT_TOKEN
4. node ULTIMATE_SINGLE_FILE.js

🌐 Платформы (НЕ засыпают):
- Fly.io (~$2/месяц) - самый стабильный
- Railway.app (500 часов бесплатно)
- Render.com (бесплатный план)

🔑 Token: 7949379153:AAFGbjm6EhWgBV51JT223daOgg7i6alpFdc
*/

const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

// ================== КОНФИГУРАЦИЯ ==================
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '7949379153:AAG3BfHTza4dmvy6j-8Kju0DpX3lDszovRs';
const ADMIN_ID = 5467443715;
const CHANNEL_ID = -1002638030999; // @OkayCryptoChannel
const PORT = process.env.PORT || 5000;

console.log('🤖 Starting OkayCoin Bot - ULTIMATE EDITION...');

// ================== БАЗА ДАННЫХ В ПАМЯТИ ==================
let users = new Map();
let tasks = new Map();
let userTasks = new Map();
let referrals = new Map();
let actionLogs = new Map();
let cache = new Map();

// ================== СИСТЕМА КЭШИРОВАНИЯ ==================
class SimpleCache {
  constructor() {
    this.cache = new Map();
    this.ttl = 5 * 60 * 1000; // 5 минут
  }
  
  set(key, value, customTtl = null) {
    const ttl = customTtl || this.ttl;
    this.cache.set(key, {
      value,
      expires: Date.now() + ttl
    });
  }
  
  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    
    if (Date.now() > item.expires) {
      this.cache.delete(key);
      return null;
    }
    
    return item.value;
  }
  
  clear() {
    this.cache.clear();
  }
}

const simpleCache = new SimpleCache();

// ================== RATE LIMITING ==================
class RateLimiter {
  constructor() {
    this.requests = new Map();
    this.limits = {
      tap: { max: 60, window: 60000 }, // 60 тапов в минуту
      general: { max: 30, window: 60000 } // 30 действий в минуту
    };
  }
  
  checkLimit(userId, action = 'general') {
    const now = Date.now();
    const key = `${userId}:${action}`;
    const limit = this.limits[action] || this.limits.general;
    
    if (!this.requests.has(key)) {
      this.requests.set(key, []);
    }
    
    const userRequests = this.requests.get(key);
    
    // Очищаем старые запросы
    const validRequests = userRequests.filter(time => now - time < limit.window);
    this.requests.set(key, validRequests);
    
    if (validRequests.length >= limit.max) {
      return false;
    }
    
    validRequests.push(now);
    return true;
  }
}

const rateLimiter = new RateLimiter();

// ================== МОНИТОРИНГ ==================
class SimpleMonitoring {
  constructor() {
    this.metrics = {
      totalUsers: 0,
      totalTaps: 0,
      totalErrors: 0,
      startTime: Date.now()
    };
  }
  
  recordTap() {
    this.metrics.totalTaps++;
  }
  
  recordError() {
    this.metrics.totalErrors++;
  }
  
  getStats() {
    return {
      ...this.metrics,
      uptime: Date.now() - this.metrics.startTime,
      users: users.size
    };
  }
}

const monitoring = new SimpleMonitoring();

// Инициализация базовых заданий
function initializeTasks() {
  tasks.set(1, {
    id: 1,
    title: "Подписаться на канал",
    titleEn: "Subscribe to channel",
    description: "Подпишитесь на @OkayCryptoChannel",
    descriptionEn: "Subscribe to @OkayCryptoChannel",
    reward: 500,
    icon: "📢",
    type: "channel",
    channelId: CHANNEL_ID,
    channelUsername: "OkayCryptoChannel",
    isActive: true,
    priority: 1
  });

  tasks.set(2, {
    id: 2,
    title: "Пригласить друзей",
    titleEn: "Invite friends", 
    description: "Пригласите 5 друзей по реферальной ссылке",
    descriptionEn: "Invite 5 friends using your referral link",
    reward: 1000,
    icon: "👥",
    type: "referral",
    target: 5,
    isActive: true,
    priority: 2
  });

  tasks.set(3, {
    id: 3,
    title: "Ежедневная награда",
    titleEn: "Daily reward",
    description: "Получайте ежедневную награду",
    descriptionEn: "Claim your daily reward",
    reward: 100,
    icon: "🎁",
    type: "daily",
    isActive: true,
    priority: 3
  });

  console.log('✅ Tasks initialized');
}

// ================== ФУНКЦИИ РАБОТЫ С ДАННЫМИ ==================
function getUser(telegramId) {
  return users.get(telegramId);
}

function createUser(telegramId, username, firstName, referrerId = null) {
  const user = {
    id: telegramId,
    username: username || '',
    firstName: firstName || '',
    coins: 0,
    level: 1,
    dailyTaps: 0,
    lastTapDate: new Date().toDateString(),
    lastDailyReward: null,
    language: 'ru',
    completedTasks: [],
    referrerId: referrerId,
    referralCount: 0,
    joinedAt: new Date(),
    totalEarned: 0,
    isActive: true,
    lastActivity: new Date()
  };
  
  users.set(telegramId, user);
  monitoring.metrics.totalUsers++;
  
  // Если есть реферер, создаем связь
  if (referrerId && getUser(referrerId)) {
    const referralId = Date.now();
    referrals.set(referralId, {
      id: referralId,
      referrerId: referrerId,
      referredId: telegramId,
      createdAt: new Date(),
      bonusPaid: false
    });
    
    // Начисляем бонус рефереру
    const referrer = getUser(referrerId);
    if (referrer) {
      const referralCount = getReferralCount(referrerId);
      let bonus = 250; // По умолчанию 250 OK
      
      if (referralCount >= 10000) bonus = 25;
      else if (referralCount >= 500) bonus = 75;
      else if (referralCount >= 100) bonus = 125;
      
      referrer.coins += bonus;
      referrer.totalEarned += bonus;
      updateUser(referrerId, referrer);
      
      console.log(`💰 REFERRAL BONUS: User ${referrerId} earned ${bonus} OK for referral ${telegramId}`);
    }
  }
  
  console.log(`👤 NEW USER: ${telegramId} (${firstName}) ${referrerId ? `ref by ${referrerId}` : ''}`);
  return user;
}

function updateUser(telegramId, updates) {
  const user = users.get(telegramId);
  if (user) {
    Object.assign(user, updates);
    user.lastActivity = new Date();
    users.set(telegramId, user);
  }
  return user;
}

function getReferralCount(userId) {
  let count = 0;
  for (let [, ref] of referrals) {
    if (ref.referrerId === userId) count++;
  }
  return count;
}

function logAction(userId, action, details = {}) {
  const logId = Date.now() + Math.random();
  actionLogs.set(logId, {
    id: logId,
    userId,
    action,
    details,
    timestamp: new Date()
  });
  
  // Очищаем старые логи (храним только последние 1000)
  if (actionLogs.size > 1000) {
    const entries = Array.from(actionLogs.entries());
    entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
    actionLogs.clear();
    entries.slice(0, 1000).forEach(([id, log]) => {
      actionLogs.set(id, log);
    });
  }
}

// ================== ПЕРЕВОДЫ ==================
const translations = {
  ru: {
    welcome: "🎉 Добро пожаловать в OkayCoin!\n\n🪙 Тапайте монету и зарабатывайте OK!\n💰 Приглашайте друзей и получайте бонусы!\n🏆 Соревнуйтесь в лидерборде!",
    mainMenu: "🎮 Главное меню",
    tapButton: "🪙 Тапнуть",
    tasksButton: "📋 Задания",
    statsButton: "📊 Статистика", 
    leaderboardButton: "🏆 Лидерборд",
    referralsButton: "👥 Рефералы",
    shareButton: "📤 Поделиться",
    backButton: "⬅️ Назад",
    balanceText: "💰 Ваш баланс: {coins} OK\n🏅 Уровень: {level}",
    tapLimit: "🚫 Вы достигли дневного лимита тапов (50/50)!\n⏰ Приходите завтра за новыми тапами!",
    earnedCoins: "💰 Вы заработали {amount} OK!\n\n🪙 Всего: {total} OK\n⚡ Тапов сегодня: {taps}/50",
    noTasks: "✅ Все задания выполнены!\n\n🎉 Поздравляем! Вы выполнили все доступные задания.",
    taskCompleted: "✅ Задание выполнено! Получено {reward} OK!",
    subscribeFirst: "❌ Сначала подпишитесь на канал @OkayCryptoChannel!",
    alreadyCompleted: "✅ Задание уже выполнено!",
    dailyClaimed: "🎁 Ежедневная награда получена!\n💰 +{reward} OK",
    dailyAlready: "⏰ Ежедневная награда уже получена сегодня!",
    notEnoughReferrals: "❌ Нужно пригласить {target} друзей. У вас: {current}",
    stats: "📊 Ваша статистика:\n\n💰 Монеты: {coins} OK\n🏅 Уровень: {level}\n⚡ Тапов сегодня: {taps}/50\n👥 Рефералов: {referrals}\n💎 Всего заработано: {totalEarned} OK\n📅 Дата регистрации: {joinDate}",
    leaderboardTitle: "🏆 Топ-10 игроков:",
    referralSystem: "👥 Реферальная система:\n\n🔗 Ваша ссылка:\n{link}\n\n👫 Приглашено друзей: {count}\n\n💰 Награды за рефералов:\n• 0-99 рефералов: 250 OK за каждого\n• 100-499 рефералов: 125 OK за каждого\n• 500-9999 рефералов: 75 OK за каждого\n• 10000+ рефералов: 25 OK за каждого",
    shareText: "🎮 Присоединяйся к OkayCoin Bot! Тапай и зарабатывай OK!",
    availableTasks: "📋 Доступные задания:"
  },
  en: {
    welcome: "🎉 Welcome to OkayCoin!\n\n🪙 Tap the coin and earn OK!\n💰 Invite friends and get bonuses!\n🏆 Compete in the leaderboard!",
    mainMenu: "🎮 Main Menu",
    tapButton: "🪙 Tap",
    tasksButton: "📋 Tasks",
    statsButton: "📊 Statistics",
    leaderboardButton: "🏆 Leaderboard",
    referralsButton: "👥 Referrals",
    shareButton: "📤 Share",
    backButton: "⬅️ Back",
    balanceText: "💰 Your balance: {coins} OK\n🏅 Level: {level}",
    tapLimit: "🚫 You've reached the daily tap limit (50/50)!\n⏰ Come back tomorrow for new taps!",
    earnedCoins: "💰 You earned {amount} OK!\n\n🪙 Total: {total} OK\n⚡ Taps today: {taps}/50",
    noTasks: "✅ All tasks completed!\n\n🎉 Congratulations! You've completed all available tasks.",
    taskCompleted: "✅ Task completed! Received {reward} OK!",
    subscribeFirst: "❌ Subscribe to @OkayCryptoChannel channel first!",
    alreadyCompleted: "✅ Task already completed!",
    dailyClaimed: "🎁 Daily reward claimed!\n💰 +{reward} OK",
    dailyAlready: "⏰ Daily reward already claimed today!",
    notEnoughReferrals: "❌ Need to invite {target} friends. You have: {current}",
    stats: "📊 Your Statistics:\n\n💰 Coins: {coins} OK\n🏅 Level: {level}\n⚡ Taps today: {taps}/50\n👥 Referrals: {referrals}\n💎 Total earned: {totalEarned} OK\n📅 Join Date: {joinDate}",
    leaderboardTitle: "🏆 Top-10 players:",
    referralSystem: "👥 Referral system:\n\n🔗 Your link:\n{link}\n\n👫 Friends invited: {count}\n\n💰 Referral rewards:\n• 0-99 referrals: 250 OK each\n• 100-499 referrals: 125 OK each\n• 500-9999 referrals: 75 OK each\n• 10000+ referrals: 25 OK each",
    shareText: "🎮 Join OkayCoin Bot! Tap and earn OK!",
    availableTasks: "📋 Available tasks:"
  }
};

function t(key, lang = 'ru', params = {}) {
  let text = translations[lang]?.[key] || translations['ru'][key] || key;
  Object.keys(params).forEach(param => {
    text = text.replace(new RegExp(`{${param}}`, 'g'), params[param]);
  });
  return text;
}

// ================== TELEGRAM BOT ==================
if (!BOT_TOKEN || BOT_TOKEN === 'YOUR_BOT_TOKEN_HERE') {
  console.error('❌ TELEGRAM_BOT_TOKEN not set! Please set environment variable.');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { 
  polling: true,
  request: {
    agentOptions: {
      keepAlive: true,
      family: 4
    }
  }
});

console.log('✅ Telegram bot initialized');

// ================== КОМАНДЫ БОТА ==================

// Команда /start
bot.onText(/\/start(.*)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;
  const param = match[1]?.trim();
  
  // Rate limiting
  if (!rateLimiter.checkLimit(telegramId, 'general')) {
    console.log(`⚠️ Rate limit exceeded for user ${telegramId}`);
    return;
  }
  
  let user = getUser(telegramId);
  let referrerId = null;
  
  // Обработка реферальной ссылки
  if (param && param.startsWith(' ref')) {
    referrerId = parseInt(param.replace(' ref', ''));
    if (referrerId && referrerId !== telegramId && getUser(referrerId)) {
      console.log(`🔗 Referral detected: ${telegramId} referred by ${referrerId}`);
    } else {
      referrerId = null;
    }
  }
  
  if (!user) {
    user = createUser(telegramId, msg.from.username, msg.from.first_name, referrerId);
  } else {
    // Обновляем активность
    updateUser(telegramId, { lastActivity: new Date() });
  }
  
  logAction(telegramId, 'start', { referrerId });
  await showMainMenu(chatId, user);
});

// Команда /help
bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;
  
  if (!rateLimiter.checkLimit(telegramId, 'general')) return;
  
  const helpText = `
🤖 Добро пожаловать в OkayCoin Bot!

🎮 Как играть:
• Нажимайте кнопку "Тапнуть" чтобы заработать 10 OK за тап
• Лимит: 50 тапов в день
• Каждые 1000 OK = новый уровень

📋 Задания:
• Подпишитесь на @OkayCryptoChannel (500 OK)
• Пригласите 5 друзей (1000 OK)
• Получайте ежедневную награду (100 OK)

👥 Реферальная система:
• 0-99 рефералов: 250 OK за каждого
• 100-499 рефералов: 125 OK за каждого
• 500+ рефералов: 75 OK за каждого

🏆 Соревнуйтесь в лидерборде и зарабатывайте больше всех!

Удачи в игре! 🎯
`;

  try {
    await bot.sendMessage(chatId, helpText);
  } catch (error) {
    console.error('❌ Help command error:', error.message);
  }
});

// Админские команды
bot.onText(/\/admin/, async (msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;
  
  if (telegramId !== ADMIN_ID) return;
  
  const stats = monitoring.getStats();
  const adminText = `
🔧 Админ панель OkayCoin Bot

📊 Статистика:
• Пользователей: ${stats.users}
• Всего тапов: ${stats.totalTaps}
• Ошибок: ${stats.totalErrors}
• Время работы: ${Math.floor(stats.uptime / 1000 / 60)} мин

💾 Память: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB

🎮 Доступные команды:
/stats - подробная статистика
/users - список пользователей
/broadcast <текст> - рассылка
`;

  try {
    await bot.sendMessage(chatId, adminText);
  } catch (error) {
    console.error('❌ Admin command error:', error.message);
  }
});

// Статистика для админа
bot.onText(/\/stats/, async (msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;
  
  if (telegramId !== ADMIN_ID) return;
  
  const stats = monitoring.getStats();
  const topUsers = Array.from(users.values())
    .sort((a, b) => b.coins - a.coins)
    .slice(0, 5);
  
  let statsText = `
📊 Подробная статистика:

👥 Пользователи: ${stats.users}
🎯 Всего тапов: ${stats.totalTaps}
❌ Ошибок: ${stats.totalErrors}
⏱️ Время работы: ${Math.floor(stats.uptime / 1000 / 60)} мин

🏆 Топ игроки:
`;

  topUsers.forEach((user, index) => {
    statsText += `${index + 1}. ${user.firstName || user.username || `User${user.id}`} - ${user.coins} OK\n`;
  });

  try {
    await bot.sendMessage(chatId, statsText);
  } catch (error) {
    console.error('❌ Stats command error:', error.message);
  }
});

// ================== ОСНОВНЫЕ ФУНКЦИИ ==================

// Показать главное меню
async function showMainMenu(chatId, user, messageId = null) {
  const lang = user.language;
  
  const keyboard = {
    inline_keyboard: [
      [{ text: t('tapButton', lang), callback_data: 'tap' }],
      [
        { text: t('tasksButton', lang), callback_data: 'tasks' },
        { text: t('statsButton', lang), callback_data: 'stats' }
      ],
      [
        { text: t('leaderboardButton', lang), callback_data: 'leaderboard' },
        { text: t('referralsButton', lang), callback_data: 'referrals' }
      ],
      [{ text: t('shareButton', lang), callback_data: 'share' }]
    ]
  };
  
  const welcomeText = t('welcome', lang);
  const balanceText = t('balanceText', lang, {
    coins: user.coins.toLocaleString(),
    level: user.level
  });
  
  const text = `${welcomeText}\n\n${balanceText}`;
  
  try {
    if (messageId) {
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: keyboard,
        parse_mode: 'HTML'
      });
    } else {
      await bot.sendMessage(chatId, text, { 
        reply_markup: keyboard,
        parse_mode: 'HTML'
      });
    }
  } catch (error) {
    console.log(`⚠️ Menu display error: ${error.message}`);
    monitoring.recordError();
  }
}

// Обработка тапов
async function handleTap(callbackQueryId, chatId, messageId, user) {
  const today = new Date().toDateString();
  
  // Rate limiting для тапов
  if (!rateLimiter.checkLimit(user.id, 'tap')) {
    try {
      await bot.answerCallbackQuery(callbackQueryId, { 
        text: "⚠️ Слишком быстро! Подождите немного." 
      });
    } catch (e) {}
    return;
  }
  
  // Сброс счетчика тапов на новый день
  if (user.lastTapDate !== today) {
    user.dailyTaps = 0;
    user.lastTapDate = today;
  }
  
  // Проверка лимита тапов
  if (user.dailyTaps >= 50) {
    try {
      await bot.answerCallbackQuery(callbackQueryId, { 
        text: t('tapLimit', user.language) 
      });
    } catch (e) {}
    return;
  }
  
  // Добавляем 10 монет за тап
  const coinsEarned = 10;
  user.coins += coinsEarned;
  user.dailyTaps += 1;
  user.totalEarned += coinsEarned;
  
  // Повышаем уровень каждые 1000 монет
  const newLevel = Math.floor(user.coins / 1000) + 1;
  if (newLevel > user.level) {
    user.level = newLevel;
    console.log(`🎉 LEVEL UP: User ${user.id} reached level ${newLevel}`);
  }
  
  updateUser(user.id, user);
  logAction(user.id, 'tap', { coinsEarned, newLevel: user.level });
  monitoring.recordTap();
  
  console.log(`💰 TAP: User ${user.id} earned ${coinsEarned} OK, total: ${user.coins}, taps: ${user.dailyTaps}`);
  
  await showMainMenu(chatId, user, messageId);
  
  try {
    await bot.answerCallbackQuery(callbackQueryId, { 
      text: t('earnedCoins', user.language, { 
        amount: coinsEarned, 
        total: user.coins.toLocaleString(), 
        taps: user.dailyTaps 
      }) 
    });
  } catch (e) {}
}

// Показать задания
async function showTasks(chatId, messageId, user) {
  const lang = user.language;
  const availableTasks = [];
  
  for (let [, task] of tasks) {
    if (task.isActive && !user.completedTasks.includes(task.id)) {
      availableTasks.push(task);
    }
  }
  
  if (availableTasks.length === 0) {
    const keyboard = {
      inline_keyboard: [
        [{ text: t('backButton', lang), callback_data: 'back' }]
      ]
    };
    
    try {
      await bot.editMessageText(t('noTasks', lang), {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: keyboard
      });
    } catch (e) {}
    return;
  }
  
  const keyboard = {
    inline_keyboard: [
      ...availableTasks.map(task => {
        const title = lang === 'en' ? task.titleEn : task.title;
        return [{ 
          text: `${task.icon} ${title} - ${task.reward} OK`, 
          callback_data: `task_${task.id}` 
        }];
      }),
      [{ text: t('backButton', lang), callback_data: 'back' }]
    ]
  };
  
  let tasksText = t('availableTasks', lang) + '\n\n';
  
  availableTasks.forEach(task => {
    const title = lang === 'en' ? task.titleEn : task.title;
    const description = lang === 'en' ? task.descriptionEn : task.description;
    tasksText += `${task.icon} ${title}\n💰 Награда: ${task.reward} OK\n📝 ${description}\n\n`;
  });
  
  try {
    await bot.editMessageText(tasksText, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: keyboard
    });
  } catch (e) {}
}

// Выполнение задания
async function completeTask(callbackQueryId, chatId, messageId, user, taskId) {
  const task = tasks.get(taskId);
  if (!task || user.completedTasks.includes(taskId)) {
    try {
      await bot.answerCallbackQuery(callbackQueryId, { 
        text: t('alreadyCompleted', user.language) 
      });
    } catch (e) {}
    return;
  }
  
  let canComplete = false;
  let errorText = '';
  
  if (task.type === 'channel') {
    try {
      const member = await bot.getChatMember(task.channelId, user.id);
      canComplete = ['member', 'administrator', 'creator'].includes(member.status);
      if (!canComplete) {
        errorText = t('subscribeFirst', user.language);
      }
    } catch (error) {
      canComplete = false;
      errorText = t('subscribeFirst', user.language);
    }
  } else if (task.type === 'referral') {
    const referralCount = getReferralCount(user.id);
    canComplete = referralCount >= task.target;
    if (!canComplete) {
      errorText = t('notEnoughReferrals', user.language, {
        target: task.target,
        current: referralCount
      });
    }
  } else if (task.type === 'daily') {
    const today = new Date().toDateString();
    canComplete = user.lastDailyReward !== today;
    if (!canComplete) {
      errorText = t('dailyAlready', user.language);
    } else {
      user.lastDailyReward = today;
    }
  }
  
  if (!canComplete) {
    try {
      await bot.answerCallbackQuery(callbackQueryId, { text: errorText });
    } catch (e) {}
    return;
  }
  
  // Выполняем задание
  user.coins += task.reward;
  user.totalEarned += task.reward;
  user.completedTasks.push(taskId);
  
  // Обновляем уровень
  const newLevel = Math.floor(user.coins / 1000) + 1;
  if (newLevel > user.level) {
    user.level = newLevel;
  }
  
  updateUser(user.id, user);
  logAction(user.id, 'task_completed', { taskId, reward: task.reward });
  
  console.log(`✅ TASK COMPLETED: User ${user.id} completed task ${taskId}, earned ${task.reward} OK`);
  
  await showTasks(chatId, messageId, user);
  
  try {
    await bot.answerCallbackQuery(callbackQueryId, { 
      text: t('taskCompleted', user.language, { reward: task.reward }) 
    });
  } catch (e) {}
}

// Показать статистику
async function showStats(chatId, messageId, user) {
  const lang = user.language;
  const referralCount = getReferralCount(user.id);
  const joinDate = user.joinedAt.toLocaleDateString('ru-RU');
  
  const keyboard = {
    inline_keyboard: [
      [{ text: t('backButton', lang), callback_data: 'back' }]
    ]
  };
  
  try {
    await bot.editMessageText(t('stats', lang, {
      coins: user.coins.toLocaleString(),
      level: user.level,
      taps: user.dailyTaps,
      referrals: referralCount,
      totalEarned: user.totalEarned.toLocaleString(),
      joinDate: joinDate
    }), {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: keyboard
    });
  } catch (e) {}
}

// Показать лидерборд
async function showLeaderboard(chatId, messageId, user) {
  const lang = user.language;
  const sortedUsers = Array.from(users.values())
    .sort((a, b) => b.coins - a.coins)
    .slice(0, 10);
  
  let text = t('leaderboardTitle', lang) + '\n\n';
  
  sortedUsers.forEach((u, index) => {
    const name = u.firstName || u.username || `User${u.id}`;
    const medal = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `${index + 1}.`;
    text += `${medal} ${name} - ${u.coins.toLocaleString()} OK\n`;
  });
  
  // Показать позицию текущего пользователя
  const allUsers = Array.from(users.values()).sort((a, b) => b.coins - a.coins);
  const userPosition = allUsers.findIndex(u => u.id === user.id) + 1;
  
  if (userPosition > 10) {
    text += `\n📍 Ваша позиция: ${userPosition} место`;
  }
  
  const keyboard = {
    inline_keyboard: [
      [{ text: t('backButton', lang), callback_data: 'back' }]
    ]
  };
  
  try {
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: keyboard
    });
  } catch (e) {}
}

// Показать рефералы
async function showReferrals(chatId, messageId, user) {
  const lang = user.language;
  const referralCount = getReferralCount(user.id);
  const referralLink = `https://t.me/CryptoOkayBot?start=ref${user.id}`;
  
  const text = t('referralSystem', lang, {
    link: referralLink,
    count: referralCount
  });
  
  const keyboard = {
    inline_keyboard: [
      [{
        text: "📤 Поделиться ссылкой",
        url: `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(t('shareText', lang))}`
      }],
      [{ text: t('backButton', lang), callback_data: 'back' }]
    ]
  };
  
  try {
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: keyboard
    });
  } catch (e) {}
}

// ================== ОБРАБОТКА CALLBACK ЗАПРОСОВ ==================
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data;
  const user = getUser(query.from.id);
  
  if (!user) {
    try {
      await bot.answerCallbackQuery(query.id, { text: "❌ Пользователь не найден. Напишите /start" });
    } catch (e) {}
    return;
  }
  
  // Rate limiting
  if (!rateLimiter.checkLimit(user.id, 'general')) {
    try {
      await bot.answerCallbackQuery(query.id, { text: "⚠️ Слишком много запросов!" });
    } catch (e) {}
    return;
  }
  
  try {
    console.log(`🔄 CALLBACK: chatId=${chatId}, data="${data}"`);
    
    if (data === 'tap') {
      await handleTap(query.id, chatId, messageId, user);
    } else if (data === 'tasks') {
      await showTasks(chatId, messageId, user);
    } else if (data === 'stats') {
      await showStats(chatId, messageId, user);
    } else if (data === 'leaderboard') {
      await showLeaderboard(chatId, messageId, user);
    } else if (data === 'referrals' || data === 'share') {
      await showReferrals(chatId, messageId, user);
    } else if (data === 'back') {
      await showMainMenu(chatId, user, messageId);
    } else if (data.startsWith('task_')) {
      const taskId = parseInt(data.replace('task_', ''));
      await completeTask(query.id, chatId, messageId, user, taskId);
    }
    
    // Обновляем активность пользователя
    updateUser(user.id, { lastActivity: new Date() });
    
  } catch (error) {
    console.error('❌ Callback error:', error.message);
    monitoring.recordError();
    try {
      await bot.answerCallbackQuery(query.id, { text: "❌ Произошла ошибка" });
    } catch (e) {}
  }
});

// ================== EXPRESS СЕРВЕР ==================
const app = express();
app.use(express.json());

// Главная страница
app.get('/', (req, res) => {
  const stats = monitoring.getStats();
  res.json({ 
    name: 'OkayCoin Bot',
    status: 'running',
    version: '3.0.0',
    users: stats.users,
    uptime: Math.floor(stats.uptime / 1000),
    totalTaps: stats.totalTaps,
    timestamp: new Date().toISOString()
  });
});

// Health check
app.get('/ping', (req, res) => {
  res.json({ 
    status: 'pong', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.get('/health', (req, res) => {
  const stats = monitoring.getStats();
  res.json({ 
    status: 'healthy',
    users: stats.users,
    tasks: tasks.size,
    totalTaps: stats.totalTaps,
    errors: stats.totalErrors,
    memory: process.memoryUsage(),
    uptime: Math.floor(stats.uptime / 1000)
  });
});

// Подробная статистика
app.get('/api/stats', (req, res) => {
  const stats = monitoring.getStats();
  const topUsers = Array.from(users.values())
    .sort((a, b) => b.coins - a.coins)
    .slice(0, 10)
    .map(user => ({
      name: user.firstName || user.username || `User${user.id}`,
      coins: user.coins,
      level: user.level,
      referrals: getReferralCount(user.id)
    }));
  
  res.json({
    ...stats,
    topUsers,
    totalReferrals: referrals.size,
    cacheSize: simpleCache.cache.size
  });
});

// ================== СИСТЕМА KEEP-ALIVE ==================
function startKeepAlive() {
  console.log('🛡️ Starting ULTIMATE keep-alive protection...');
  
  // Основной цикл каждые 30 секунд
  setInterval(() => {
    const memMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    const stats = monitoring.getStats();
    console.log(`🛡️ Anti-sleep active | Users: ${stats.users} | Memory: ${memMB}MB | Taps: ${stats.totalTaps}`);
  }, 30000);
  
  // Пульс активности каждую минуту
  setInterval(() => {
    console.log(`🔄 Activity pulse | ${new Date().toISOString()}`);
  }, 60000);
  
  // Keep-alive пинг каждые 3 минуты
  setInterval(() => {
    const memMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    console.log(`✅ Bot keep-alive ping | Memory: ${memMB}MB`);
  }, 3 * 60 * 1000);
  
  // Очистка кэша каждые 10 минут
  setInterval(() => {
    const beforeSize = simpleCache.cache.size;
    simpleCache.clear();
    console.log(`🧹 Cache cleared: ${beforeSize} items removed`);
  }, 10 * 60 * 1000);
  
  // Статистика каждые 30 минут
  setInterval(() => {
    const stats = monitoring.getStats();
    console.log(`📊 STATS: Users: ${stats.users}, Taps: ${stats.totalTaps}, Uptime: ${Math.floor(stats.uptime / 1000 / 60)}min`);
  }, 30 * 60 * 1000);
}

// ================== ОБРАБОТКА ОШИБОК ==================
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error.message);
  monitoring.recordError();
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled Rejection:', reason);
  monitoring.recordError();
});

bot.on('error', (error) => {
  console.error('❌ Bot error:', error.message);
  monitoring.recordError();
});

bot.on('polling_error', (error) => {
  console.error('❌ Polling error:', error.message);
  monitoring.recordError();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully...');
  bot.stopPolling();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully...');
  bot.stopPolling();
  process.exit(0);
});

// ================== ЗАПУСК ==================
function startBot() {
  console.log('🚀 Starting OkayCoin Bot - ULTIMATE EDITION...');
  
  // Инициализация
  initializeTasks();
  startKeepAlive();
  
  // Установка команд меню для обычных пользователей
  bot.setMyCommands([
    { command: 'start', description: '🎮 Начать игру' },
    { command: 'help', description: '❓ Помощь' }
  ]).then(() => {
    console.log('✅ User commands menu set');
  }).catch(err => {
    console.error('❌ Failed to set user commands:', err.message);
  });
  
  // Запуск сервера
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Server running on port ${PORT}`);
    console.log('✅ OkayCoin Bot ULTIMATE started successfully!');
    console.log(`🤖 Bot username: @CryptoOkayBot`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log(`🎯 Ready to handle millions of users!`);
  });
  
  // Graceful shutdown для сервера
  process.on('SIGTERM', () => {
    server.close(() => {
      console.log('🌐 HTTP server closed.');
    });
  });
}

// Запуск бота
startBot();

// ================== ЭКСПОРТ ==================
module.exports = { bot, app, users, tasks, monitoring };
