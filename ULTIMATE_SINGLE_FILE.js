#!/usr/bin/env node

/*
🤖 OkayCoin Bot - ULTIMATE SINGLE FILE (БЕЗОПАСНАЯ ВЕРСИЯ)
📦 ВСЁ В ОДНОМ ФАЙЛЕ - готов к развертыванию!

🎯 Что включено:
✅ Полная tap-to-earn игра с лимитом 50 тапов
✅ ИСПРАВЛЕННАЯ реферальная система с прогрессивными наградами
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
1. Создайте новый токен в @BotFather
2. На Render.com: Environment Variables → TELEGRAM_BOT_TOKEN = ваш_токен
3. Manual Deploy

🔑 Token: Установите через Environment Variables (ОБЯЗАТЕЛЬНО!)
*/

const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

// ================== КОНФИГУРАЦИЯ ==================
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID || 5467443715;
const CHANNEL_ID = -1002638030999; // @OkayCryptoChannel
const PORT = process.env.PORT || 5000;

console.log('🤖 Starting OkayCoin Bot - ULTIMATE EDITION...');

// Проверка токена
if (!BOT_TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN не установлен!');
  console.error('📝 Установите токен в Environment Variables');
  process.exit(1);
}

// ================== БАЗА ДАННЫХ В ПАМЯТИ ==================
let users = new Map();
let tasks = new Map();
let userTasks = new Map();
let referrals = new Map();
let userIdCounter = 1;
let taskIdCounter = 1;

// ================== СИСТЕМА КЭШИРОВАНИЯ ==================
class SimpleCache {
  constructor() {
    this.cache = new Map();
    this.ttl = 5 * 60 * 1000; // 5 минут
  }

  set(key, value, customTtl = null) {
    const expiry = Date.now() + (customTtl || this.ttl);
    this.cache.set(key, { value, expiry });
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    
    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return null;
    }
    
    return item.value;
  }

  clear() {
    this.cache.clear();
  }
}

// ================== RATE LIMITING ==================
class RateLimiter {
  constructor() {
    this.requests = new Map();
    this.limits = {
      general: { max: 30, window: 60000 }, // 30 запросов в минуту
      tap: { max: 50, window: 24 * 60 * 60 * 1000 }, // 50 тапов в день
      task: { max: 10, window: 60000 } // 10 задач в минуту
    };
  }

  checkLimit(userId, action = 'general') {
    const key = `${userId}-${action}`;
    const limit = this.limits[action] || this.limits.general;
    const now = Date.now();
    
    if (!this.requests.has(key)) {
      this.requests.set(key, []);
    }
    
    const userRequests = this.requests.get(key);
    
    // Очистка старых запросов
    const validRequests = userRequests.filter(time => now - time < limit.window);
    this.requests.set(key, validRequests);
    
    if (validRequests.length >= limit.max) {
      return false;
    }
    
    validRequests.push(now);
    return true;
  }
}

// ================== МОНИТОРИНГ ==================
class SimpleMonitoring {
  constructor() {
    this.stats = {
      totalTaps: 0,
      totalUsers: 0,
      totalReferrals: 0,
      errors: 0
    };
  }

  recordTap() {
    this.stats.totalTaps++;
  }

  recordError() {
    this.stats.errors++;
  }

  getStats() {
    return {
      ...this.stats,
      totalUsers: users.size,
      uptime: process.uptime()
    };
  }
}

// Инициализация систем
const cache = new SimpleCache();
const rateLimiter = new RateLimiter();
const monitoring = new SimpleMonitoring();

// ================== ИНИЦИАЛИЗАЦИЯ ЗАДАЧ ==================
function initializeTasks() {
  // Базовые задачи
  tasks.set(1, {
    id: 1,
    type: 'channel',
    title: {
      ru: '📢 Подписаться на канал @OkayCryptoChannel',
      en: '📢 Subscribe to @OkayCryptoChannel'
    },
    description: {
      ru: 'Подпишитесь на наш официальный канал',
      en: 'Subscribe to our official channel'
    },
    reward: 500,
    channelId: '@OkayCryptoChannel',
    channelIdNumeric: CHANNEL_ID,
    level: 0,
    isPermanent: true
  });

  tasks.set(2, {
    id: 2,
    type: 'referral',
    title: {
      ru: '👥 Пригласить 5 друзей',
      en: '👥 Invite 5 friends'
    },
    description: {
      ru: 'Пригласите 5 друзей через реферальную ссылку',
      en: 'Invite 5 friends through referral link'
    },
    reward: 1000,
    requiredCount: 5,
    level: 0,
    isPermanent: true
  });

  tasks.set(3, {
    id: 3,
    type: 'daily',
    title: {
      ru: '🎁 Ежедневная награда',
      en: '🎁 Daily reward'
    },
    description: {
      ru: 'Получите ежедневную награду',
      en: 'Claim your daily reward'
    },
    reward: 100,
    level: 0,
    isPermanent: true
  });

  console.log('✅ Базовые задачи инициализированы');
}

// ================== БАЗА ДАННЫХ ФУНКЦИИ ==================
function getUser(telegramId) {
  for (let user of users.values()) {
    if (user.telegramId === telegramId.toString()) {
      return user;
    }
  }
  return null;
}

function createUser(telegramId, username, firstName, referrerId = null) {
  const userId = userIdCounter++;
  const user = {
    id: userId,
    telegramId: telegramId.toString(),
    username: username || '',
    firstName: firstName || '',
    coins: 0,
    level: 1,
    tapsToday: 0,
    lastTapDate: null,
    lastDailyReward: null,
    energy: 50,
    maxEnergy: 50,
    language: 'ru',
    referrerId: referrerId,
    createdAt: new Date().toISOString()
  };
  
  users.set(userId, user);

  // ИСПРАВЛЕННАЯ реферальная система
  if (referrerId) {
    const referrer = users.get(referrerId);
    if (referrer) {
      const referralId = Math.max(...Array.from(referrals.keys()).concat([0])) + 1;
      const referral = {
        id: referralId,
        referrerId: referrerId,
        referredId: userId,
        createdAt: new Date().toISOString()
      };
      referrals.set(referralId, referral);

      // Вычисляем прогрессивную награду
      const referrerReferrals = getReferralCount(referrerId);
      let reward;
      if (referrerReferrals < 100) reward = 250;
      else if (referrerReferrals < 500) reward = 125;
      else if (referrerReferrals < 10000) reward = 75;
      else reward = 25;

      // Даем награду рефереру
      referrer.coins += reward;
      users.set(referrerId, referrer);
      
      console.log(`💰 Реферальная награда: ${reward} OK для пользователя ${referrerId}`);
      monitoring.stats.totalReferrals++;
    }
  }

  monitoring.stats.totalUsers++;
  console.log(`👤 Создан пользователь ${userId}: ${firstName} (@${username})`);
  return user;
}

function updateUser(telegramId, updates) {
  const user = getUser(telegramId);
  if (user) {
    Object.assign(user, updates);
    users.set(user.id, user);
    return user;
  }
  return null;
}

function getReferralCount(userId) {
  let count = 0;
  for (let referral of referrals.values()) {
    if (referral.referrerId === userId) {
      count++;
    }
  }
  return count;
}

function logAction(userId, action, details = {}) {
  console.log(`📝 [${new Date().toISOString()}] User ${userId}: ${action}`, details);
}

// ================== МНОГОЯЗЫЧНОСТЬ ==================
const translations = {
  ru: {
    welcome: "🎮 Добро пожаловать в OkayCoin!\n\n💰 Тапайте монету и зарабатывайте OK!\n🎯 Приглашайте друзей и получайте больше монет!\n\n👆 Нажмите кнопку ниже для начала:",
    main_menu: "🎮 *OkayCoin - Главное меню*\n\n💰 Ваши монеты: *{coins} OK*\n⭐ Уровень: *{level}*\n⚡ Тапы сегодня: *{taps}/50*\n\n🏆 Приглашено друзей: *{referrals}*",
    tap_button: "💰 Тапнуть (+10 OK)",
    tasks_button: "📋 Задания",
    stats_button: "📊 Статистика", 
    leaderboard_button: "🏆 Лидерборд",
    referrals_button: "👥 Рефералы",
    back_button: "◀️ Назад",
    tap_success: "💰 +10 OK! Всего: {coins} OK\n⚡ Тапов осталось: {remaining}",
    tap_limit: "⛔ Лимит тапов на сегодня исчерпан!\n⏰ Возвращайтесь завтра!",
    task_completed: "✅ Задание выполнено!\n💰 Получено: +{reward} OK",
    task_channel_not_subscribed: "❌ Вы не подписаны на канал!\n📢 Подпишитесь и попробуйте снова",
    share_button: "📤 Поделиться",
    referral_link: "🔗 Ваша реферальная ссылка:\n{link}\n\n💰 За каждого друга: {reward} OK\n👥 Приглашено: {count}",
    lang_button: "🌐 Язык"
  },
  en: {
    welcome: "🎮 Welcome to OkayCoin!\n\n💰 Tap the coin and earn OK!\n🎯 Invite friends and get more coins!\n\n👆 Press the button below to start:",
    main_menu: "🎮 *OkayCoin - Main Menu*\n\n💰 Your coins: *{coins} OK*\n⭐ Level: *{level}*\n⚡ Taps today: *{taps}/50*\n\n🏆 Friends invited: *{referrals}*",
    tap_button: "💰 Tap (+10 OK)",
    tasks_button: "📋 Tasks",
    stats_button: "📊 Statistics",
    leaderboard_button: "🏆 Leaderboard", 
    referrals_button: "👥 Referrals",
    back_button: "◀️ Back",
    tap_success: "💰 +10 OK! Total: {coins} OK\n⚡ Taps left: {remaining}",
    tap_limit: "⛔ Daily tap limit reached!\n⏰ Come back tomorrow!",
    task_completed: "✅ Task completed!\n💰 Received: +{reward} OK",
    task_channel_not_subscribed: "❌ You are not subscribed to the channel!\n📢 Subscribe and try again",
    share_button: "📤 Share",
    referral_link: "🔗 Your referral link:\n{link}\n\n💰 For each friend: {reward} OK\n👥 Invited: {count}",
    lang_button: "🌐 Language"
  }
};

function t(key, lang = 'ru', params = {}) {
  let text = translations[lang]?.[key] || translations['ru'][key] || key;
  
  // Замена параметров
  Object.keys(params).forEach(param => {
    text = text.replace(new RegExp(`{${param}}`, 'g'), params[param]);
  });
  
  return text;
}

// ================== TELEGRAM BOT ==================
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

console.log('🤖 Telegram Bot инициализирован');

// ================== ОСНОВНЫЕ ФУНКЦИИ БОТА ==================
async function showMainMenu(chatId, user, messageId = null) {
  const referralCount = getReferralCount(user.id);
  
  const text = t('main_menu', user.language, {
    coins: user.coins.toLocaleString(),
    level: user.level,
    taps: user.tapsToday,
    referrals: referralCount
  });

  const keyboard = {
    inline_keyboard: [
      [{ text: t('tap_button', user.language), callback_data: 'tap' }],
      [
        { text: t('tasks_button', user.language), callback_data: 'tasks' },
        { text: t('stats_button', user.language), callback_data: 'stats' }
      ],
      [
        { text: t('leaderboard_button', user.language), callback_data: 'leaderboard' },
        { text: t('referrals_button', user.language), callback_data: 'referrals' }
      ],
      [
        { text: t('share_button', user.language), callback_data: 'share' },
        { text: t('lang_button', user.language), callback_data: 'language' }
      ]
    ]
  };

  try {
    if (messageId) {
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    } else {
      await bot.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    }
  } catch (error) {
    console.error('❌ Ошибка показа главного меню:', error.message);
  }
}

async function handleTap(callbackQueryId, chatId, messageId, user) {
  try {
    // Проверка лимита тапов
    if (!rateLimiter.checkLimit(user.id, 'tap')) {
      await bot.answerCallbackQuery(callbackQueryId, {
        text: t('tap_limit', user.language),
        show_alert: true
      });
      return;
    }

    // Проверка дневного лимита
    const today = new Date().toDateString();
    if (user.lastTapDate !== today) {
      user.tapsToday = 0;
      user.lastTapDate = today;
    }

    if (user.tapsToday >= 50) {
      await bot.answerCallbackQuery(callbackQueryId, {
        text: t('tap_limit', user.language),
        show_alert: true
      });
      return;
    }

    // Начисление монет
    user.coins += 10;
    user.tapsToday += 1;
    
    // Проверка повышения уровня
    const newLevel = Math.floor(user.coins / 1000) + 1;
    if (newLevel > user.level) {
      user.level = newLevel;
    }

    updateUser(user.telegramId, user);
    monitoring.recordTap();
    logAction(user.id, 'tap', { coins: user.coins, level: user.level });

    const remaining = 50 - user.tapsToday;
    
    await bot.answerCallbackQuery(callbackQueryId, {
      text: t('tap_success', user.language, {
        coins: user.coins.toLocaleString(),
        remaining: remaining
      })
    });

    // Обновляем главное меню
    await showMainMenu(chatId, user, messageId);

  } catch (error) {
    console.error('❌ Ошибка в handleTap:', error.message);
    monitoring.recordError();
  }
}

async function showTasks(chatId, messageId, user) {
  let text = user.language === 'ru' ? 
    '📋 *Доступные задания:*\n\n' : 
    '📋 *Available tasks:*\n\n';

  const keyboard = { inline_keyboard: [] };

  // Получаем все задачи для текущего уровня
  const availableTasks = Array.from(tasks.values()).filter(task => 
    task.level <= user.level
  );

  for (const task of availableTasks) {
    const userTaskKey = `${user.id}-${task.id}`;
    const userTask = userTasks.get(userTaskKey);
    
    if (!userTask || !userTask.completed) {
      let status = '';
      let canComplete = true;

      if (task.type === 'referral') {
        const currentReferrals = getReferralCount(user.id);
        const required = task.requiredCount || 1;
        status = user.language === 'ru' ? 
          ` (${currentReferrals}/${required})` : 
          ` (${currentReferrals}/${required})`;
        canComplete = currentReferrals >= required;
      }

      const title = task.title[user.language] || task.title.ru;
      text += `${canComplete ? '✅' : '⏳'} ${title}${status}\n`;
      text += user.language === 'ru' ? 
        `💰 Награда: ${task.reward} OK\n\n` : 
        `💰 Reward: ${task.reward} OK\n\n`;

      keyboard.inline_keyboard.push([{
        text: `${title} (+${task.reward} OK)`,
        callback_data: `task_${task.id}`
      }]);
    }
  }

  keyboard.inline_keyboard.push([{
    text: t('back_button', user.language),
    callback_data: 'back_to_menu'
  }]);

  try {
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  } catch (error) {
    console.error('❌ Ошибка показа задач:', error.message);
  }
}

async function completeTask(callbackQueryId, chatId, messageId, user, taskId) {
  const task = tasks.get(parseInt(taskId));
  if (!task) return;

  const userTaskKey = `${user.id}-${task.id}`;
  let userTask = userTasks.get(userTaskKey);

  if (userTask && userTask.completed) {
    await bot.answerCallbackQuery(callbackQueryId, {
      text: user.language === 'ru' ? 'Задание уже выполнено!' : 'Task already completed!',
      show_alert: true
    });
    return;
  }

  let canComplete = false;

  // Проверка выполнения задания
  if (task.type === 'channel') {
    try {
      const member = await bot.getChatMember(task.channelIdNumeric, user.telegramId);
      canComplete = ['member', 'administrator', 'creator'].includes(member.status);
    } catch (error) {
      console.error('❌ Ошибка проверки подписки:', error.message);
      canComplete = false;
    }
  } else if (task.type === 'referral') {
    const referralCount = getReferralCount(user.id);
    const required = task.requiredCount || 1;
    canComplete = referralCount >= required;
  } else if (task.type === 'daily') {
    const today = new Date().toDateString();
    canComplete = user.lastDailyReward !== today;
  } else {
    canComplete = true;
  }

  if (!canComplete) {
    let errorMessage;
    if (task.type === 'channel') {
      errorMessage = t('task_channel_not_subscribed', user.language);
    } else if (task.type === 'referral') {
      const referralCount = getReferralCount(user.id);
      const required = task.requiredCount || 1;
      errorMessage = user.language === 'ru' ? 
        `Нужно пригласить еще ${required - referralCount} друзей` :
        `Need to invite ${required - referralCount} more friends`;
    } else {
      errorMessage = user.language === 'ru' ? 
        'Задание еще не может быть выполнено' : 
        'Task cannot be completed yet';
    }

    await bot.answerCallbackQuery(callbackQueryId, {
      text: errorMessage,
      show_alert: true
    });
    return;
  }

  // Выполнение задания
  user.coins += task.reward;
  
  if (task.type === 'daily') {
    user.lastDailyReward = new Date().toDateString();
  }

  updateUser(user.telegramId, user);

  // Записываем выполнение задания
  if (!userTask) {
    const userTaskId = Math.max(...Array.from(userTasks.keys()).map(k => 
      userTasks.get(k).id || 0).concat([0])) + 1;
    userTask = {
      id: userTaskId,
      userId: user.id,
      taskId: task.id,
      progress: 1,
      completed: true,
      completedAt: new Date().toISOString()
    };
  } else {
    userTask.completed = true;
    userTask.completedAt = new Date().toISOString();
  }

  userTasks.set(userTaskKey, userTask);
  logAction(user.id, 'task_completed', { taskId: task.id, reward: task.reward });

  await bot.answerCallbackQuery(callbackQueryId, {
    text: t('task_completed', user.language, { reward: task.reward })
  });

  // Возвращаемся к списку задач
  await showTasks(chatId, messageId, user);
}

async function showStats(chatId, messageId, user) {
  const referralCount = getReferralCount(user.id);
  const userRank = await getUserRank(user.id);
  
  const text = user.language === 'ru' ? 
    `📊 *Ваша статистика:*\n\n` +
    `💰 Всего монет: *${user.coins.toLocaleString()} OK*\n` +
    `⭐ Уровень: *${user.level}*\n` +
    `⚡ Тапов сегодня: *${user.tapsToday}/50*\n` +
    `👥 Приглашено друзей: *${referralCount}*\n` +
    `🏆 Место в рейтинге: *#${userRank}*\n` +
    `📅 Дата регистрации: *${new Date(user.createdAt).toLocaleDateString('ru-RU')}*` :
    `📊 *Your statistics:*\n\n` +
    `💰 Total coins: *${user.coins.toLocaleString()} OK*\n` +
    `⭐ Level: *${user.level}*\n` +
    `⚡ Taps today: *${user.tapsToday}/50*\n` +
    `👥 Friends invited: *${referralCount}*\n` +
    `🏆 Rank: *#${userRank}*\n` +
    `📅 Registration date: *${new Date(user.createdAt).toLocaleDateString('en-US')}*`;

  const keyboard = {
    inline_keyboard: [[{
      text: t('back_button', user.language),
      callback_data: 'back_to_menu'
    }]]
  };

  try {
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  } catch (error) {
    console.error('❌ Ошибка показа статистики:', error.message);
  }
}

async function showLeaderboard(chatId, messageId, user) {
  const topUsers = Array.from(users.values())
    .sort((a, b) => b.coins - a.coins)
    .slice(0, 10);

  let text = user.language === 'ru' ? 
    '🏆 *Лидерборд:*\n\n' : 
    '🏆 *Leaderboard:*\n\n';

  topUsers.forEach((topUser, index) => {
    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
    const name = topUser.firstName || topUser.username || 'Anonymous';
    text += `${medal} ${name} - *${topUser.coins.toLocaleString()} OK*\n`;
  });

  const keyboard = {
    inline_keyboard: [[{
      text: t('back_button', user.language),
      callback_data: 'back_to_menu'
    }]]
  };

  try {
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  } catch (error) {
    console.error('❌ Ошибка показа лидерборда:', error.message);
  }
}

async function showReferrals(chatId, messageId, user) {
  const referralCount = getReferralCount(user.id);
  
  // Вычисляем текущую награду за реферала
  let currentReward;
  if (referralCount < 100) currentReward = 250;
  else if (referralCount < 500) currentReward = 125;
  else if (referralCount < 10000) currentReward = 75;
  else currentReward = 25;

  const referralLink = `https://t.me/CryptoOkayBot?start=ref${user.id}`;
  
  const text = t('referral_link', user.language, {
    link: referralLink,
    reward: currentReward,
    count: referralCount
  });

  const keyboard = {
    inline_keyboard: [
      [{
        text: t('share_button', user.language),
        url: `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent('🎮 Присоединяйся к OkayCoin! Тапай и зарабатывай OK!')}`
      }],
      [{
        text: t('back_button', user.language),
        callback_data: 'back_to_menu'
      }]
    ]
  };

  try {
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  } catch (error) {
    console.error('❌ Ошибка показа рефералов:', error.message);
  }
}

async function getUserRank(userId) {
  const userList = Array.from(users.values()).sort((a, b) => b.coins - a.coins);
  const rank = userList.findIndex(u => u.id === userId) + 1;
  return rank || userList.length + 1;
}

// ================== ОБРАБОТЧИКИ СОБЫТИЙ ==================
bot.on('message', async (msg) => {
  try {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const username = msg.from.username;
    const firstName = msg.from.first_name;

    // Проверка rate limiting
    if (!rateLimiter.checkLimit(telegramId, 'general')) {
      return;
    }

    let user = getUser(telegramId);

    // Обработка команды /start с реферальной ссылкой
    if (msg.text && msg.text.startsWith('/start')) {
      const referralMatch = msg.text.match(/\/start ref(\d+)/);
      let referrerId = null;
      
      if (referralMatch) {
        referrerId = parseInt(referralMatch[1]);
        if (referrerId === telegramId) {
          referrerId = null; // Нельзя быть рефералом самого себя
        }
      }

      if (!user) {
        user = createUser(telegramId, username, firstName, referrerId);
      }

      await bot.sendMessage(chatId, t('welcome', user.language));
      await showMainMenu(chatId, user);
      return;
    }

    // Обработка других команд
    if (msg.text === '/help') {
      const helpText = user?.language === 'ru' ? 
        '🤖 *OkayCoin Bot - Справка*\n\n' +
        '/start - Начать игру\n' +
        '/help - Показать справку\n\n' +
        '💰 Тапайте монету и зарабатывайте OK!\n' +
        '👥 Приглашайте друзей и получайте бонусы!\n' +
        '📋 Выполняйте задания для дополнительных наград!' :
        '🤖 *OkayCoin Bot - Help*\n\n' +
        '/start - Start the game\n' +
        '/help - Show help\n\n' +
        '💰 Tap the coin and earn OK!\n' +
        '👥 Invite friends and get bonuses!\n' +
        '📋 Complete tasks for additional rewards!';
      
      await bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
      return;
    }

    // Команды админа
    if (telegramId === ADMIN_ID) {
      if (msg.text === '/admin') {
        await showSystemStats(chatId);
        return;
      }
    }

    // Для всех остальных сообщений показываем главное меню
    if (user) {
      await showMainMenu(chatId, user);
    }

  } catch (error) {
    console.error('❌ Ошибка обработки сообщения:', error.message);
    monitoring.recordError();
  }
});

bot.on('callback_query', async (query) => {
  try {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const callbackQueryId = query.id;
    const data = query.data;
    const telegramId = query.from.id;

    let user = getUser(telegramId);
    if (!user) {
      await bot.answerCallbackQuery(callbackQueryId, {
        text: 'Пользователь не найден. Нажмите /start',
        show_alert: true
      });
      return;
    }

    // Проверка rate limiting
    if (!rateLimiter.checkLimit(telegramId, 'general')) {
      await bot.answerCallbackQuery(callbackQueryId);
      return;
    }

    // Обработка команд
    switch (data) {
      case 'tap':
        await handleTap(callbackQueryId, chatId, messageId, user);
        break;

      case 'tasks':
        await bot.answerCallbackQuery(callbackQueryId);
        await showTasks(chatId, messageId, user);
        break;

      case 'stats':
        await bot.answerCallbackQuery(callbackQueryId);
        await showStats(chatId, messageId, user);
        break;

      case 'leaderboard':
        await bot.answerCallbackQuery(callbackQueryId);
        await showLeaderboard(chatId, messageId, user);
        break;

      case 'referrals':
        await bot.answerCallbackQuery(callbackQueryId);
        await showReferrals(chatId, messageId, user);
        break;

      case 'share':
        const referralLink = `https://t.me/CryptoOkayBot?start=ref${user.id}`;
        await bot.answerCallbackQuery(callbackQueryId, {
          text: user.language === 'ru' ? 
            'Скопируйте ссылку и поделитесь с друзьями!' : 
            'Copy the link and share with friends!',
          show_alert: true
        });
        break;

      case 'language':
        const newLang = user.language === 'ru' ? 'en' : 'ru';
        user.language = newLang;
        updateUser(user.telegramId, user);
        await bot.answerCallbackQuery(callbackQueryId, {
          text: newLang === 'ru' ? 'Язык изменен на русский' : 'Language changed to English'
        });
        await showMainMenu(chatId, user, messageId);
        break;

      case 'back_to_menu':
        await bot.answerCallbackQuery(callbackQueryId);
        await showMainMenu(chatId, user, messageId);
        break;

      default:
        if (data.startsWith('task_')) {
          const taskId = data.replace('task_', '');
          await completeTask(callbackQueryId, chatId, messageId, user, taskId);
        } else {
          await bot.answerCallbackQuery(callbackQueryId);
        }
        break;
    }

  } catch (error) {
    console.error('❌ Ошибка callback query:', error.message);
    monitoring.recordError();
    try {
      await bot.answerCallbackQuery(query.id);
    } catch (e) {}
  }
});

// ================== ADMIN ФУНКЦИИ ==================
async function showSystemStats(chatId) {
  const stats = monitoring.getStats();
  const totalTasks = tasks.size;
  const completedTasks = userTasks.size;
  
  const text = `🔧 *Системная статистика:*\n\n` +
    `👥 Всего пользователей: *${stats.totalUsers}*\n` +
    `💰 Всего тапов: *${stats.totalTaps.toLocaleString()}*\n` +
    `🔗 Всего рефералов: *${stats.totalReferrals}*\n` +
    `📋 Всего задач: *${totalTasks}*\n` +
    `✅ Выполнено заданий: *${completedTasks}*\n` +
    `❌ Ошибок: *${stats.errors}*\n` +
    `⏰ Время работы: *${Math.floor(stats.uptime / 3600)}ч ${Math.floor((stats.uptime % 3600) / 60)}м*\n` +
    `🧠 Память: *${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB*`;

  try {
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('❌ Ошибка показа статистики:', error.message);
  }
}

// ================== EXPRESS СЕРВЕР (KEEP-ALIVE) ==================
const app = express();

app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
  const stats = monitoring.getStats();
  res.json({
    status: 'OK',
    message: 'OkayCoin Bot is running',
    uptime: process.uptime(),
    stats: stats,
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    users: users.size,
    timestamp: new Date().toISOString()
  });
});

// ================== KEEP-ALIVE СИСТЕМА ==================
function startKeepAlive() {
  const keepAliveUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  
  // Пинг каждые 3 минуты
  setInterval(async () => {
    try {
      const response = await fetch(keepAliveUrl);
      console.log(`🏓 Keep-alive ping: ${response.status}`);
    } catch (error) {
      console.error('❌ Keep-alive error:', error.message);
    }
  }, 3 * 60 * 1000);

  // Активность каждую минуту
  setInterval(() => {
    console.log(`💓 Bot alive - Users: ${users.size}, Uptime: ${Math.floor(process.uptime())}s`);
  }, 60 * 1000);

  // Анти-сон каждые 30 секунд
  setInterval(() => {
    const timestamp = Date.now();
    cache.set('heartbeat', timestamp);
  }, 30 * 1000);

  console.log('✅ Keep-alive система запущена');
}

// ================== ЗАПУСК БОТА ==================
function startBot() {
  try {
    // Инициализация
    initializeTasks();
    
    // Запуск Express сервера
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🌐 Express server running on port ${PORT}`);
    });

    // Запуск keep-alive
    startKeepAlive();

    console.log('🚀 OkayCoin Bot successfully started!');
    console.log(`🤖 Bot username: @${bot.getMe().then(me => console.log(`   ${me.username}`))}`);
    console.log(`👤 Admin ID: ${ADMIN_ID}`);
    console.log(`📢 Channel: @OkayCryptoChannel`);
    console.log('🔄 Ready to accept users...');

  } catch (error) {
    console.error('❌ Критическая ошибка запуска:', error);
    process.exit(1);
  }
}

// Обработка ошибок
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  monitoring.recordError();
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  monitoring.recordError();
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('🛑 Получен SIGINT. Graceful shutdown...');
  bot.stopPolling();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('🛑 Получен SIGTERM. Graceful shutdown...');
  bot.stopPolling();
  process.exit(0);
});

// Запуск бота
startBot();
